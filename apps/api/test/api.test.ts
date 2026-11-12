import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readKiteEvents } from "@agentfico/adapters/kite-chain";
import {
  AgentReportSchema,
  AgentsResponseSchema,
  EventResponseSchema,
  HealthResponseSchema,
  KiteScoreResponseSchema,
  MethodologySchema,
  ScoreLogResponseSchema,
  ServLogResponseSchema,
} from "@agentfico/core/api-schemas";
import {
  events,
  migrateDb,
  openDb,
  replaceSimulatorEvents,
  storeEvents,
  verdicts,
} from "@agentfico/db";
import { generateSimulation } from "@agentfico/sim";
import { createApp } from "../src/app";

const asOf = "2026-11-05T00:00:00.000Z";

function seededDb(path = ":memory:") {
  const db = openDb(path);
  migrateDb(db);
  const generated = generateSimulation({ seed: 42, personas: "all" });
  replaceSimulatorEvents(db, generated);
  return { db, generated };
}

function appFor(
  db: ReturnType<typeof openDb>,
  options: { clientIp?: string } = {},
) {
  return createApp({
    db,
    env: { AFC_OFFLINE: "1", AFC_AS_OF: asOf },
    ...options,
  });
}

describe("M5 API contract", () => {
  test("streamed uploads are bounded before parsing", async () => {
    const { db } = seededDb();
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1_200_000));
          controller.close();
        },
      });
      const response = await appFor(db).request("/v1/score/log", {
        method: "POST",
        body,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("request_too_large");
    } finally {
      db.$client.close();
    }
  });

  test("saving a new subject cannot silently discard colliding event IDs", async () => {
    const { db, generated } = seededDb();
    try {
      const content = JSON.stringify({
        ...generated[0],
        subject: { afc_id: "afc:log:collision" },
      });
      const form = new FormData();
      form.set("file", new File([content], "collision.jsonl"));
      const response = await appFor(db).request("/v1/score/log?save=1", {
        method: "POST",
        body: form,
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("event_id_conflict");
      expect(db.select().from(events).all()).toHaveLength(generated.length);
    } finally {
      db.$client.close();
    }
  });
  test("score, agents, methodology, and health responses validate", async () => {
    const { db } = seededDb();
    try {
      const app = appFor(db);
      const scoreResponse = await app.request("/v1/score/afc:sim:atlas");
      expect(scoreResponse.status).toBe(200);
      const score = await scoreResponse.json();
      expect(score.afc_id).toBe("afc:sim:atlas");
      expect(score.simulated_share).toBe(1);

      const agentsResponse = await app.request("/v1/agents");
      expect(agentsResponse.status).toBe(200);
      const agents = AgentsResponseSchema.parse(await agentsResponse.json());
      expect(agents.agents).toHaveLength(5);
      expect(agents.agents.map(({ afc_id }) => afc_id)).toContain(
        "afc:sim:phoenix",
      );

      const methodologyResponse = await app.request("/v1/methodology");
      expect(
        MethodologySchema.parse(await methodologyResponse.json()).model_version,
      ).toBe("afc-0.2");

      const health = await app.request("/healthz");
      expect(HealthResponseSchema.parse(await health.json())).toEqual({
        ok: true,
        simulated_share: 0,
      });
      expect(
        HealthResponseSchema.safeParse({ ok: "true", simulated_share: 0 })
          .success,
      ).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  test("reports include history, trace IDs, and offline explanation without changing score", async () => {
    const { db } = seededDb();
    try {
      const app = appFor(db);
      const originalScore = await (
        await app.request("/v1/score/afc:sim:atlas")
      ).json();
      const reportResponse = await app.request("/v1/report/afc:sim:atlas");
      expect(reportResponse.status).toBe(200);
      const report = AgentReportSchema.parse(await reportResponse.json());
      expect(report.score.score).toBe(originalScore.score);
      expect(report.history.first_event_at).not.toBeNull();
      expect(report.history.last_event_at).not.toBeNull();
      expect(report.events.length).toBeLessThanOrEqual(50);
      expect(report.trust_memo).toEqual(expect.any(String));
      expect(report.serv_call_ids.length).toBeGreaterThan(0);
      expect(report.simulated_share).toBe(1);

      const log = ServLogResponseSchema.parse(
        await (await app.request("/v1/serv-log?afc_id=afc:sim:atlas")).json(),
      );
      expect(log.calls.some((call) => call.offline)).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  test("reports preserve current Reppo dimensions and legacy nested verdicts", async () => {
    const { db } = seededDb();
    try {
      const at = "2026-11-04T23:00:00.000Z";
      db.insert(verdicts)
        .values([
          {
            evalId: "eval-current-85",
            afcId: "afc:sim:atlas",
            status: "COMPLETED",
            score: 85,
            decision: "accept",
            confidence: "high",
            resultJson: JSON.stringify({
              score: 85,
              decision: "accept",
              confidence: "high",
              route: "review",
              reason: "The task evidence supports the result.",
              rubric_scores: { accuracy: 85, completeness: 90 },
            }),
            createdAt: at,
            updatedAt: at,
          },
          {
            evalId: "eval-legacy-92",
            afcId: "afc:sim:atlas",
            status: "SETTLED",
            score: 92,
            decision: "accept",
            confidence: "high",
            resultJson: JSON.stringify({
              result: {
                verdict: { score: 92, decision: "accept", confidence: "high" },
                verdicts: [
                  {
                    criterion: "accuracy",
                    score: 9,
                    critique: "Legacy critique.",
                  },
                ],
                action: { route: "review" },
              },
            }),
            createdAt: at,
            updatedAt: at,
          },
        ])
        .run();

      const app = appFor(db);
      const response = await app.request(
        "/v1/report/afc:sim:atlas?as_of=2026-11-05T00:00:00.000Z",
      );
      const report = AgentReportSchema.parse(await response.json());
      const current = report.verdicts.find(
        ({ eval_id }) => eval_id === "eval-current-85",
      );
      const legacy = report.verdicts.find(
        ({ eval_id }) => eval_id === "eval-legacy-92",
      );
      expect(current?.result).toMatchObject({
        score: 85,
        route: "review",
        reason: "The task evidence supports the result.",
        rubric_scores: { accuracy: 85, completeness: 90 },
      });
      expect(current?.result).not.toHaveProperty("manipulation");
      expect(legacy?.result).toMatchObject({
        verdict: { score: 92, decision: "accept" },
        verdicts: [{ score: 9, critique: "Legacy critique." }],
        action: { route: "review" },
      });
      expect(report.critique_summary).not.toBeNull();
    } finally {
      db.$client.close();
    }
  });

  test("event citations resolve to validated evidence and unknown IDs return 404", async () => {
    const { db, generated } = seededDb();
    try {
      const app = appFor(db);
      const cited = generated[0];
      if (!cited)
        throw new Error("simulation fixture did not produce an event");
      const response = await app.request(`/v1/events/${cited.event_id}`);
      expect(response.status).toBe(200);
      expect(
        EventResponseSchema.parse(await response.json()).event.event_id,
      ).toBe(cited.event_id);

      const secretEventId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
      storeEvents(db, [
        {
          event_id: secretEventId,
          subject: { afc_id: "afc:sim:atlas" },
          source: "assistant",
          simulated: true,
          attestation: "self_reported",
          type: "action.performed",
          occurred_at: asOf,
          attrs: { note: "Bearer dummy-reppo-key" },
        },
      ]);
      const redactedApp = createApp({
        db,
        env: {
          AFC_OFFLINE: "1",
          AFC_AS_OF: asOf,
          REPPO_API_KEY: "dummy-reppo-key",
        },
      });
      const redacted = EventResponseSchema.parse(
        await (await redactedApp.request(`/v1/events/${secretEventId}`)).json(),
      );
      expect(redacted.event.attrs?.note).toBe("Bearer [REDACTED]");

      const missing = await app.request("/v1/events/not-an-ulid");
      expect(missing.status).toBe(404);
      expect((await missing.json()).simulated_share).toBe(0);
      expect((await app.request("/v1/score/afc:sim:missing")).status).toBe(404);
    } finally {
      db.$client.close();
    }
  });

  test("multipart provisional scoring does not write unless requested and rejects atomically", async () => {
    const { db } = seededDb();
    try {
      const app = appFor(db);
      const content = await Bun.file(
        resolve(import.meta.dir, "../../../examples/my-agent.jsonl"),
      ).text();
      const before = db
        .select({ id: events.eventId })
        .from(events)
        .all().length;

      const provisionalForm = new FormData();
      provisionalForm.set(
        "file",
        new File([content], "agent.jsonl", { type: "application/jsonl" }),
      );
      const provisional = await app.request("/v1/score/log", {
        method: "POST",
        body: provisionalForm,
      });
      expect(provisional.status).toBe(200);
      expect(ScoreLogResponseSchema.parse(await provisional.json()).saved).toBe(
        false,
      );
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        before,
      );

      const saveForm = new FormData();
      saveForm.set(
        "file",
        new File([content], "agent.jsonl", { type: "application/jsonl" }),
      );
      const saved = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: saveForm,
      });
      expect(ScoreLogResponseSchema.parse(await saved.json()).saved).toBe(true);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        before + 3,
      );

      const afterSave = db
        .select({ id: events.eventId })
        .from(events)
        .all().length;
      const invalidForm = new FormData();
      invalidForm.set(
        "file",
        new File([`${content}{bad json}\n`], "invalid.jsonl"),
      );
      const invalid = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: invalidForm,
      });
      expect(invalid.status).toBe(400);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        afterSave,
      );

      const unknownAssistantForm = new FormData();
      unknownAssistantForm.set(
        "file",
        new File(
          ['{"type":"assistant.message","text":"unknown"}\n'],
          "assistant.jsonl",
        ),
      );
      const unknownAssistant = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: unknownAssistantForm,
      });
      expect(unknownAssistant.status).toBe(422);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        afterSave,
      );

      const oversizedForm = new FormData();
      oversizedForm.set(
        "file",
        new File(["x".repeat(1_048_577)], "large.jsonl"),
      );
      const oversized = await app.request("/v1/score/log", {
        method: "POST",
        body: oversizedForm,
      });
      expect(oversized.status).toBe(413);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        afterSave,
      );
    } finally {
      db.$client.close();
    }
  });

  test("uploads downgrade forged claims, preserve labeled simulation, and block poisoning", async () => {
    const { db } = seededDb();
    try {
      const app = appFor(db);
      const example = await Bun.file(
        resolve(import.meta.dir, "../../../examples/my-agent.jsonl"),
      ).text();
      const forgedReppo = {
        event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        subject: { afc_id: "afc:assistant:example-agent" },
        source: "reppo",
        simulated: false,
        attestation: "platform_signed",
        type: "work.evaluated",
        occurred_at: "2026-11-10T10:00:00.000Z",
        evidence: { eval_id: "forged-live-eval" },
        attrs: {
          reppo_score: 100,
          decision: "accept",
          confidence: "high",
        },
      };
      const synthetic = {
        event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
        subject: { afc_id: "afc:assistant:example-agent" },
        source: "simulator",
        simulated: true,
        attestation: "platform_signed",
        type: "work.evaluated",
        occurred_at: "2026-11-10T11:00:00.000Z",
        evidence: { eval_id: "synthetic-claimed-eval" },
        attrs: {
          reppo_score: 90,
          decision: "accept",
          confidence: "high",
          evaluation_origin: "synthetic_simulation",
          evaluation_status: "synthetic_not_reppo",
        },
      };
      const content = `${example}${JSON.stringify(forgedReppo)}\n${JSON.stringify(synthetic)}\n`;
      const form = new FormData();
      form.set("file", new File([content], "claims.jsonl"));
      const saved = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: form,
      });
      expect(saved.status).toBe(200);
      const result = ScoreLogResponseSchema.parse(await saved.json());
      expect(
        result.score.reason_codes.flatMap(({ eval_ids }) => eval_ids),
      ).not.toContain("forged-live-eval");

      const storedRows = db
        .select({ eventId: events.eventId, eventJson: events.eventJson })
        .from(events)
        .all();
      const reppoRow = storedRows.find(
        ({ eventId }) => eventId === forgedReppo.event_id,
      );
      const reppoEvent = reppoRow ? JSON.parse(reppoRow.eventJson) : null;
      expect(reppoEvent).toMatchObject({
        source: "assistant",
        attestation: "self_reported",
        attrs: {
          claimed_source: "reppo",
          claimed_attestation: "platform_signed",
          claimed_eval_id: "forged-live-eval",
        },
      });
      expect(reppoEvent.evidence?.eval_id).toBeUndefined();

      const syntheticRow = storedRows.find(
        ({ eventId }) => eventId === synthetic.event_id,
      );
      const syntheticEvent = syntheticRow
        ? JSON.parse(syntheticRow.eventJson)
        : null;
      expect(syntheticEvent).toMatchObject({
        source: "simulator",
        simulated: true,
        attestation: "self_reported",
        attrs: { claimed_attestation: "platform_signed" },
      });
      expect(syntheticEvent.evidence?.eval_id).toBeUndefined();

      const beforeRejectedSave = storedRows.length;
      const duplicateTargetForm = new FormData();
      duplicateTargetForm.set("file", new File([example], "agent.jsonl"));
      const duplicateTarget = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: duplicateTargetForm,
      });
      expect(duplicateTarget.status).toBe(409);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        beforeRejectedSave,
      );

      const beforeReserved = db
        .select({ id: events.eventId })
        .from(events)
        .all().length;
      const reservedContent = example.replaceAll(
        "afc:assistant:example-agent",
        "afc:sim:atlas",
      );
      const reservedProvisionalForm = new FormData();
      reservedProvisionalForm.set(
        "file",
        new File([reservedContent], "reserved.jsonl"),
      );
      const reservedProvisional = await app.request(
        "/v1/score/log?as_of=2026-11-11T00:00:00.000Z",
        {
          method: "POST",
          body: reservedProvisionalForm,
        },
      );
      expect(reservedProvisional.status).toBe(200);
      expect(
        ScoreLogResponseSchema.parse(await reservedProvisional.json()).saved,
      ).toBe(false);
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        beforeReserved,
      );
      for (const namespace of ["kite", "reppo"]) {
        const protectedContent = example.replaceAll(
          "afc:assistant:example-agent",
          `afc:${namespace}:reserved`,
        );
        const protectedForm = new FormData();
        protectedForm.set(
          "file",
          new File([protectedContent], "reserved.jsonl"),
        );
        const protectedResponse = await app.request("/v1/score/log?save=1", {
          method: "POST",
          body: protectedForm,
        });
        expect(protectedResponse.status).toBe(422);
        expect((await protectedResponse.json()).error.code).toBe(
          "reserved_upload_subject",
        );
        expect(
          db.select({ id: events.eventId }).from(events).all(),
        ).toHaveLength(beforeReserved);
      }

      const reservedForm = new FormData();
      reservedForm.set("file", new File([reservedContent], "reserved.jsonl"));
      const reserved = await app.request("/v1/score/log?save=1", {
        method: "POST",
        body: reservedForm,
      });
      expect(reserved.status).toBe(422);
      expect((await reserved.json()).error.code).toBe(
        "reserved_upload_subject",
      );
      expect(db.select({ id: events.eventId }).from(events).all()).toHaveLength(
        beforeReserved,
      );
    } finally {
      db.$client.close();
    }
  });

  test("evaluate queues locally through M4 and never calls a provider", async () => {
    const db = openDb(":memory:");
    migrateDb(db);
    try {
      const app = createApp({
        db,
        env: { AFC_OFFLINE: "1", REPPO_API_KEY: "test" },
      });
      const response = await app.request("/v1/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          afc_id: "afc:sample:local",
          samples: [
            { id: "s1", task: "task one", output: "output one" },
            { id: "s2", task: "task two", output: "output two" },
            { id: "s3", task: "task three", output: "output three" },
          ],
          criteria: [],
          simulated: true,
          category: "shopping",
        }),
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toMatchObject({
        afc_id: "afc:sample:local",
        status: "queued",
        eval_id: null,
        offline: true,
        simulated_share: 1,
      });
      expect(body.queue_id).toEqual(expect.any(Number));

      const hosted = createApp({
        db,
        env: {
          AFC_OFFLINE: "1",
          REPPO_API_KEY: "test",
          NODE_ENV: "production",
        },
      });
      const disabled = await hosted.request("/v1/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          afc_id: "afc:sample:hosted",
          samples: [
            { id: "h1", task: "task one", output: "output one" },
            { id: "h2", task: "task two", output: "output two" },
            { id: "h3", task: "task three", output: "output three" },
          ],
          criteria: [],
        }),
      });
      expect(disabled.status).toBe(503);
      expect((await disabled.json()).error.code).toBe("evaluation_disabled");
    } finally {
      db.$client.close();
    }
  });

  test("Kite API returns honest 503 while offline evidence is unavailable", async () => {
    const db = openDb(":memory:");
    migrateDb(db);
    try {
      const app = createApp({
        db,
        env: {
          AFC_OFFLINE: "1",
          KITE_USDC_ADDRESS: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
        },
      });
      const unavailable = await app.request("/v1/score/kite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0x0000000000000000000000000000000000000001",
        }),
      });
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({
        error: {
          code: "kite_fixture_unavailable",
          message: "No recorded Kite history for this address in offline mode",
        },
        simulated_share: 0,
      });

      const invalid = await app.request("/v1/score/kite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "not-an-address" }),
      });
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).simulated_share).toBe(0);

      const fixture = {
        simulated: true,
        pages: [
          {
            items: [
              {
                transaction_hash: `0x${"3".repeat(64)}`,
                log_index: 0,
                timestamp: "2026-11-04T12:00:00.000Z",
                from: { hash: "0x0000000000000000000000000000000000000001" },
                to: { hash: "0x0000000000000000000000000000000000000002" },
                token: {
                  address_hash: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
                  decimals: "6",
                },
                total: { value: "2500000", decimals: "6" },
              },
              {
                transaction_hash: `0x${"4".repeat(64)}`,
                log_index: 1,
                timestamp: "2026-11-04T13:00:00.000Z",
                from: { hash: "0x0000000000000000000000000000000000000003" },
                to: { hash: "0x0000000000000000000000000000000000000001" },
                token: {
                  address_hash: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
                  decimals: "6",
                },
                total: { value: "1750000", decimals: "6" },
              },
            ],
            next_page_params: null,
          },
        ],
      };
      const withFixture = createApp({
        db,
        env: {
          AFC_OFFLINE: "1",
          AFC_AS_OF: asOf,
          KITE_USDC_ADDRESS: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
        },
        kiteRead: (address, options) =>
          readKiteEvents(address, { ...options, fixture }),
      });
      const fixtureResponse = await withFixture.request("/v1/score/kite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0x0000000000000000000000000000000000000001",
        }),
      });
      expect(fixtureResponse.status).toBe(200);
      const kiteScore = KiteScoreResponseSchema.parse(
        await fixtureResponse.json(),
      );
      expect(kiteScore).toMatchObject({
        complete: true,
        pages: 1,
        offline: true,
        outcome: "OFFLINE_FIXTURE",
        simulated_share: 1,
      });
      expect(kiteScore.score.score).toEqual(expect.any(Number));
      expect(kiteScore.events).toHaveLength(3);
    } finally {
      db.$client.close();
    }
  });

  test("public endpoints enforce rate limits per client IP", async () => {
    const { db, generated } = seededDb();
    try {
      const eventId = generated[0]?.event_id;
      if (!eventId)
        throw new Error("simulation fixture did not produce an event");
      const app = appFor(db);
      for (let index = 0; index < 120; index += 1) {
        const response = await app.request(
          `/v1/events/${eventId}`,
          {},
          { clientIp: "192.0.2.10" },
        );
        expect(response.status).toBe(200);
      }
      const limited = await app.request(
        `/v1/events/${eventId}`,
        {},
        { clientIp: "192.0.2.10" },
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).not.toBeNull();
      expect((await limited.json()).error.code).toBe("rate_limited");

      const otherIp = await app.request(
        `/v1/events/${eventId}`,
        {},
        { clientIp: "192.0.2.11" },
      );
      expect(otherIp.status).toBe(200);
    } finally {
      db.$client.close();
    }
  });

  test("event history is included in the stable default as_of", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentfico-api-test-"));
    const db = openDb(join(directory, "api.sqlite"));
    migrateDb(db);
    try {
      const generated = generateSimulation({ seed: 42, personas: ["atlas"] });
      replaceSimulatorEvents(db, generated);
      const latest = new Date(Date.now() - 5_000).toISOString();
      storeEvents(db, [
        {
          event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
          subject: { afc_id: "afc:sim:atlas" },
          source: "assistant",
          simulated: true,
          attestation: "self_reported",
          type: "action.performed",
          occurred_at: latest,
        },
      ]);
      const app = createApp({ db, env: {} });
      const response = await app.request("/v1/score/afc:sim:atlas");
      const score = await response.json();
      expect(Date.parse(score.as_of)).toBeGreaterThanOrEqual(
        Date.parse(latest),
      );
    } finally {
      db.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("Nova-7 report cites detected transfers and logs descriptive SERV review without changing its score", async () => {
  const { db, generated } = seededDb();
  try {
    const app = appFor(db);
    const res = await app.request("/v1/report/afc:sim:nova-7");
    expect(res.status).toBe(200);
    const report = AgentReportSchema.parse(await res.json());
    expect(report.score.score).toBe(549);
    expect(report.fraud_transition?.score_before).toBe(642);
    expect(report.fraud_review?.offline).toBe(true);
    expect(report.fraud_review?.findings.map((item) => item.code)).toEqual([
      "F01",
      "F02",
    ]);
    const ids = new Set(generated.map((event) => event.event_id));
    for (const finding of report.fraud_review?.findings ?? []) {
      expect(finding.source_event_ids.every((id) => ids.has(id))).toBe(true);
    }
    const trace = ServLogResponseSchema.parse(
      await (await app.request("/v1/serv-log?job=5")).json(),
    );
    expect(trace.calls[0]?.id).toBe(
      report.fraud_review?.serv_call_id ?? "missing trace",
    );
    expect(
      (await (await app.request("/v1/score/afc:sim:nova-7")).json()).score,
    ).toBe(549);
  } finally {
    db.$client.close();
  }
});
