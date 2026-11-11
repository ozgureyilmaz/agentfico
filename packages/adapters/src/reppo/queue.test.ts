import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentFicoDb, migrateDb, openDb } from "@agentfico/db";
import { enqueueEvaluation, getReppoQueueStatus, runReppoTick } from "./queue";
import type { EnqueueEvaluationInput, ReppoFetch } from "./types";

const apiKey = crypto.randomUUID();
const creditToken = `x402ck_${crypto.randomUUID()}`;
const env = {
  REPPO_API_KEY: apiKey,
  REPPO_BASE_URL: "https://reppo.test/api/v1",
  REPPO_SETTLEMENT_MINUTES: "10",
};
const start = new Date("2026-11-10T10:00:00.000Z");

function input(
  afcId = "afc:test:worker",
  overrides: Partial<EnqueueEvaluationInput> = {},
): EnqueueEvaluationInput {
  return {
    afc_id: afcId,
    samples: [
      { id: "sample-1", task: "Compare two options", output: "Option A" },
      { id: "sample-2", task: "Summarize a source", output: "A short summary" },
      { id: "sample-3", task: "Check a calculation", output: "4" },
    ],
    criteria: ["Correctness", "Evidence"],
    context: "Synthetic test request",
    simulated: false,
    category: "research",
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function settled(evalId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: evalId,
    taskType: "response",
    status: "COMPLETED",
    score: 88,
    route: "review",
    completedAt: "2026-11-10T10:03:00.000Z",
    result: {
      score: 88,
      decision: "accept",
      confidence: "high",
      route: "review",
      reason: `Strong work; token ${apiKey}`,
      rubric_scores: { correctness: 90 },
      evidence: {
        evidenceBasis: "community-pods",
        peerAssessmentCount: 2,
        pods: [
          {
            id: "pod-secret",
            name: "private-pod",
            url: "https://private.test",
          },
        ],
      },
    },
    trace: {
      evaluators: [
        {
          model: "private-model",
          modelName: "private-model-name",
          evaluatorId: "private-evaluator-id",
          score: 88,
        },
      ],
    },
    walletAddress: "0xprivate-wallet",
    creditToken,
    peerAssessmentCount: 2,
    peerAssessmentContributors: [
      { agentName: "peer-name", modelName: "peer-model" },
    ],
    peerAssessments: [
      {
        id: "peer-review-id",
        agentName: "peer-name",
        modelName: "peer-model",
        score: 80,
        critique: "private peer critique",
      },
    ],
    humanContributors: 1,
    humanContributions: [
      {
        id: "human-id",
        reviewerId: "reviewer-secret",
        reviewerName: "reviewer-name",
      },
    ],
    ...overrides,
  };
}

describe("Reppo durable worker", () => {
  let db: AgentFicoDb;
  let fixtureDirectory: string;

  beforeEach(() => {
    db = openDb(":memory:");
    migrateDb(db);
    fixtureDirectory = mkdtempSync(join(tmpdir(), "agentfico-reppo-"));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  test("offline mode never dispatches previously queued or pending live work", async () => {
    const queued = enqueueEvaluation(db, input(), { env, now: start });
    let calls = 0;
    const fetcher: ReppoFetch = async () => {
      calls += 1;
      return response({ id: "paused-eval", status: "QUEUED" }, 201);
    };
    const offlineEnv = { ...env, AFC_OFFLINE: "1" };
    const paused = await runReppoTick(db, {
      env: offlineEnv,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(paused.reason).toBe("offline_mode");
    expect(calls).toBe(0);
    expect(getReppoQueueStatus(db, queued.queue_id)?.status).toBe("queued");
    await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(calls).toBe(1);
    const pending = await runReppoTick(db, {
      env: offlineEnv,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(pending.reason).toBe("offline_mode");
    expect(calls).toBe(1);
    expect(getReppoQueueStatus(db, queued.queue_id)?.status).toBe("pending");
  });

  test("concurrent ticks claim only one submission", async () => {
    enqueueEvaluation(db, input(), { env, now: start });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submissions = 0;
    const fetcher: ReppoFetch = async () => {
      submissions += 1;
      await gate;
      return response({ id: "concurrent-eval", status: "QUEUED" }, 201);
    };
    const first = runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    const second = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(second.status).toBe("submitting");
    expect(submissions).toBe(1);
    release();
    expect((await first).status).toBe("pending");
  });

  test("concurrent due ticks claim only one poll", async () => {
    enqueueEvaluation(db, input(), { env, now: start });
    await runReppoTick(db, {
      env,
      now: start,
      fixtureDirectory,
      fetch: async () =>
        response({ id: "concurrent-eval", status: "QUEUED" }, 201),
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let polls = 0;
    const fetcher: ReppoFetch = async () => {
      polls += 1;
      await gate;
      return response({ id: "concurrent-eval", status: "PROCESSING" });
    };
    const now = new Date(start.getTime() + 60_000);
    const first = runReppoTick(db, {
      env,
      now,
      fetch: fetcher,
      fixtureDirectory,
    });
    await runReppoTick(db, { env, now, fetch: fetcher, fixtureDirectory });
    expect(polls).toBe(1);
    release();
    expect((await first).status).toBe("pending");
  });

  test("submits the required trace string and stores a sanitized settled verdict atomically", async () => {
    const queued = enqueueEvaluation(
      db,
      input("afc:test:lifecycle", {
        samples: [
          { id: "one", task: "Task", output: `contains ${apiKey}` },
          { id: "two", task: "Task two", output: "Output two" },
          { id: "three", task: "Task three", output: "Output three" },
        ],
      }),
      { env, now: start },
    );
    expect(
      db.$client
        .query(
          "SELECT api_contract, settlement_minutes FROM reppo_queue WHERE id = ?",
        )
        .get(queued.queue_id),
    ).toEqual({ api_contract: "evals", settlement_minutes: 10 });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let pollCount = 0;
    const fetcher: ReppoFetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (init.method === "POST") {
        return response({ id: "eval-lifecycle", status: "QUEUED" }, 201);
      }
      pollCount += 1;
      if (pollCount === 1) {
        return response({ id: "eval-lifecycle", status: "PROCESSING" });
      }
      return response(settled("eval-lifecycle"));
    };

    const submitted = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(submitted.status).toBe("pending");
    expect(submitted.eval_id).toBe("eval-lifecycle");
    expect(submitted.next_poll_at).toBe("2026-11-10T10:01:00.000Z");
    expect(requests).toHaveLength(1);
    expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${apiKey}`,
    );
    expect(requests[0]?.url).toBe("https://reppo.test/api/v1/agents/evals");
    const submitBody = JSON.parse(String(requests[0]?.init.body)) as {
      taskType: string;
      input: string;
    };
    expect(Object.keys(submitBody).sort()).toEqual(["input", "taskType"]);
    expect(submitBody.taskType).toBe("response");
    expect(typeof submitBody.input).toBe("string");
    const evaluationInput = JSON.parse(submitBody.input) as {
      samples: Array<{ output: string }>;
      criteria: string[];
      context: string;
    };
    expect(evaluationInput.samples).toHaveLength(3);
    expect(evaluationInput.samples[0]?.output).not.toContain(apiKey);
    expect(evaluationInput.criteria).toEqual(["Correctness", "Evidence"]);
    expect(evaluationInput.context).toBe("Synthetic test request");
    expect(submitBody.input).not.toContain(apiKey);

    const tooEarly = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 59_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(tooEarly.status).toBe("pending");
    expect(requests).toHaveLength(1);

    const firstPoll = runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    const concurrentPoll = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    const polled = await firstPoll;
    expect(polled.status).toBe("pending");
    expect(concurrentPoll.status).toBe("pending");
    expect(
      requests.filter((request) => request.init.method === "GET"),
    ).toHaveLength(1);
    expect(requests[1]?.url).toBe(
      "https://reppo.test/api/v1/agents/evals/eval-lifecycle",
    );
    expect(polled.next_poll_at).toBe("2026-11-10T10:02:00.000Z");

    const final = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 120_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(final.status).toBe("settled");
    expect(final.eval_id).toBe("eval-lifecycle");

    const eventRow = db.$client
      .query(
        "SELECT event_id, event_json, source, simulated, attestation FROM events",
      )
      .get() as {
      event_id: string;
      event_json: string;
      source: string;
      simulated: number;
      attestation: string;
    };
    const event = JSON.parse(eventRow.event_json) as Record<string, unknown>;
    expect(eventRow.source).toBe("reppo");
    expect(eventRow.simulated).toBe(0);
    expect(eventRow.attestation).toBe("platform_signed");
    expect(event.evidence).toEqual({ eval_id: "eval-lifecycle" });
    expect(event.attrs).toMatchObject({ reppo_score: 88, manipulation: false });
    expect(eventRow.event_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(eventRow.event_json).not.toContain("critique");
    expect(eventRow.event_json).not.toContain("Strong work");
    expect(eventRow.event_json).not.toContain("trace");
    expect(eventRow.event_json).not.toContain(apiKey);

    const verdict = db.$client
      .query(
        "SELECT eval_id, status, score, decision, confidence, result_json FROM verdicts",
      )
      .get() as Record<string, unknown>;
    expect(verdict).toMatchObject({
      eval_id: "eval-lifecycle",
      status: "SETTLED",
      score: 88,
      decision: "accept",
      confidence: "high",
    });
    const safeResult = String(verdict.result_json);
    for (const privateValue of [
      apiKey,
      "peer-name",
      "peer-model",
      "peer-review-id",
      "human-id",
      "reviewer-secret",
      "reviewer-name",
      "private-pod",
      "pod-secret",
      "private.test",
      "private-model-name",
      "private-evaluator-id",
      creditToken,
      "0xprivate-wallet",
      "trace",
    ]) {
      expect(safeResult).not.toContain(privateValue);
    }
    expect(safeResult).toContain("Strong work");
    const rawAudit = String(
      (
        db.$client
          .query(
            "SELECT response_json FROM reppo_calls WHERE operation = 'poll' ORDER BY id DESC LIMIT 1",
          )
          .get() as { response_json: string }
      ).response_json,
    );
    expect(rawAudit).toContain("private-model-name");
    expect(rawAudit).toContain('"trace"');
    expect(rawAudit).not.toContain(apiKey);
    expect(rawAudit).not.toContain(creditToken);
    expect(rawAudit).not.toContain("0xprivate-wallet");
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({ count: 1 });
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM reppo_calls").get(),
    ).toEqual({ count: 3 });
    expect(readdirSync(fixtureDirectory)).toHaveLength(3);
    const fixtureContents = readdirSync(fixtureDirectory)
      .map((name) => readFileSync(join(fixtureDirectory, name), "utf8"))
      .join("\n");
    expect(fixtureContents).not.toContain(apiKey);
    expect(fixtureContents).not.toContain("peer-name");
    expect(fixtureContents).not.toContain("reviewer-secret");
    expect(fixtureContents).not.toContain("private-model-name");
    expect(fixtureContents).not.toContain("private-evaluator-id");
    expect(fixtureContents).not.toContain(creditToken);
    expect(fixtureContents).not.toContain("0xprivate-wallet");
    expect(fixtureContents).not.toContain('"trace"');
    expect(
      await runReppoTick(db, {
        env,
        now: new Date(start.getTime() + 15 * 60_000),
        fetch: fetcher,
      }),
    ).toMatchObject({ status: "idle" });
    expect(requests).toHaveLength(3);
  });

  test("a 409 without a stored eval ID requires reconciliation and blocks later jobs", async () => {
    enqueueEvaluation(db, input("afc:test:conflict-a"), { env, now: start });
    enqueueEvaluation(db, input("afc:test:conflict-b"), { env, now: start });
    let calls = 0;
    const fetcher: ReppoFetch = async () => {
      calls += 1;
      return response({ error: "A pending evaluation already exists" }, 409);
    };
    const result = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(result.status).toBe("reconciliation_required");
    expect(result.eval_id).toBeNull();
    const next = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(next.status).toBe("reconciliation_required");
    expect(calls).toBe(1);
  });

  test("a 409 resumes the eval ID already stored with the queue row", async () => {
    const queued = enqueueEvaluation(db, input("afc:test:known-conflict"), {
      env,
      now: start,
    });
    db.$client
      .query("UPDATE reppo_queue SET eval_id = 'eval-known' WHERE id = ?")
      .run(queued.queue_id);
    const methods: string[] = [];
    const fetcher: ReppoFetch = async (_url, init = {}) => {
      methods.push(init.method ?? "GET");
      return init.method === "POST"
        ? response({ error: "A pending evaluation already exists" }, 409)
        : response({ id: "eval-known", status: "PROCESSING" });
    };
    const conflict = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(conflict).toMatchObject({
      status: "pending",
      eval_id: "eval-known",
      next_poll_at: "2026-11-10T10:01:00.000Z",
    });
    const resumed = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(resumed.status).toBe("pending");
    expect(methods).toEqual(["POST", "GET"]);
  });

  test("a 402 blocks the account and stops queued work", async () => {
    enqueueEvaluation(db, input("afc:test:credits-a"), { env, now: start });
    enqueueEvaluation(db, input("afc:test:credits-b"), { env, now: start });
    let calls = 0;
    const fetcher: ReppoFetch = async () => {
      calls += 1;
      return response({ error: "Not enough credits" }, 402);
    };
    const blocked = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(blocked.status).toBe("blocked");
    const stopped = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(stopped.status).toBe("blocked");
    expect(calls).toBe(1);
  });

  test("recovers a persisted 201 eval ID after a crash before queue update", async () => {
    const queued = enqueueEvaluation(db, input("afc:test:recover"), {
      env,
      now: start,
    });
    const startedAt = start.toISOString();
    db.$client
      .query(
        `UPDATE reppo_queue SET status = 'submitting', submit_started_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(startedAt, startedAt, queued.queue_id);
    db.$client
      .query(
        `INSERT INTO reppo_calls
         (queue_id, operation, request_json, response_json, http_status, error, started_at, completed_at)
         VALUES (?, 'submit', '{}', ?, 201, NULL, ?, ?)`,
      )
      .run(
        queued.queue_id,
        JSON.stringify({ id: "eval-recovered", status: "QUEUED" }),
        startedAt,
        new Date(start.getTime() + 10_000).toISOString(),
      );
    const result = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 20_000),
      fetch: async () => {
        throw new Error("must not resubmit");
      },
    });
    expect(result).toMatchObject({
      status: "pending",
      eval_id: "eval-recovered",
      next_poll_at: "2026-11-10T10:01:00.000Z",
    });
    expect(getReppoQueueStatus(db, queued.queue_id)?.eval_id).toBe(
      "eval-recovered",
    );
  });

  test("a poll response for a different eval ID cannot create a score event", async () => {
    enqueueEvaluation(db, input("afc:test:mismatch"), { env, now: start });
    const fetcher: ReppoFetch = async (_url, init = {}) =>
      init.method === "POST"
        ? response({ id: "eval-expected", status: "QUEUED" }, 201)
        : response(settled("eval-other"));
    await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    const result = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(result.status).toBe("reconciliation_required");
    expect(result.eval_id).toBe("eval-expected");
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({
      count: 0,
    });
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM verdicts").get(),
    ).toEqual({
      count: 0,
    });
  });

  test("a mismatched current score summary requires reconciliation", async () => {
    enqueueEvaluation(db, input("afc:test:score-mismatch"), {
      env,
      now: start,
    });
    const inconsistent = { ...settled("eval-score"), score: 12 };
    const fetcher: ReppoFetch = async (_url, init = {}) =>
      init.method === "POST"
        ? response({ id: "eval-score", status: "QUEUED" }, 201)
        : response(inconsistent);
    await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    const result = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(result.status).toBe("reconciliation_required");
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({
      count: 0,
    });
  });

  test("resumes an explicitly legacy pending row with its stored contract", async () => {
    const queued = enqueueEvaluation(db, input("afc:test:legacy"), {
      env,
      now: start,
    });
    db.$client
      .query(
        `UPDATE reppo_queue SET api_contract = 'eval-requests', status = 'pending',
         eval_id = 'legacy-eval', next_poll_at = ? WHERE id = ?`,
      )
      .run(start.toISOString(), queued.queue_id);
    let requestUrl = "";
    const legacyResponse = {
      evalId: "legacy-eval",
      status: "SETTLED",
      settledAt: "2026-11-10T10:01:00.000Z",
      result: {
        verdict: { score: 80, decision: "accept", confidence: "high" },
        verdicts: [],
        action: { route: "review" },
      },
    };
    const result = await runReppoTick(db, {
      env,
      now: start,
      fetch: async (url) => {
        requestUrl = String(url);
        return response(legacyResponse);
      },
      fixtureDirectory,
    });
    expect(result.status).toBe("settled");
    expect(result.eval_id).toBe("legacy-eval");
    expect(requestUrl).toBe(
      "https://reppo.test/api/v1/agents/eval-requests/legacy-eval",
    );
    const row = db.$client.query("SELECT event_json FROM events").get() as {
      event_json: string;
    };
    expect(JSON.parse(row.event_json).attrs).toMatchObject({
      reppo_score: 80,
      manipulation: true,
    });
  });

  test("non-JSON errors export content type and body hash, not the HTML page", async () => {
    enqueueEvaluation(db, input("afc:test:html-error"), { env, now: start });
    const html = `<html><body>not found ${apiKey}</body></html>`;
    const result = await runReppoTick(db, {
      env,
      now: start,
      fetch: async (url) => {
        expect(String(url)).toBe("https://reppo.test/api/v1/agents/evals");
        return new Response(html, {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      fixtureDirectory,
    });
    expect(result.status).toBe("failed");
    const audit = db.$client
      .query("SELECT response_json FROM reppo_calls")
      .get() as { response_json: string };
    expect(audit.response_json).toContain("<html>");
    expect(audit.response_json).not.toContain(apiKey);
    const fixture = JSON.parse(
      readFileSync(
        join(fixtureDirectory, readdirSync(fixtureDirectory)[0] as string),
        "utf8",
      ),
    ) as { response: Record<string, unknown> };
    expect(fixture.response).toMatchObject({
      non_json: true,
      content_type: "text/html; charset=utf-8",
    });
    expect(fixture.response.body_sha256).toBeString();
    expect(JSON.stringify(fixture)).not.toContain("<html>");
    expect(JSON.stringify(fixture)).not.toContain(apiKey);
  });

  test("an ambiguous submit transport failure is never automatically retried", async () => {
    enqueueEvaluation(db, input("afc:test:ambiguous"), { env, now: start });
    let calls = 0;
    const fetcher: ReppoFetch = async () => {
      calls += 1;
      throw new Error("network lost after write");
    };
    const first = await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
    });
    expect(first.status).toBe("reconciliation_required");
    const restart = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 5 * 60_000),
      fetch: fetcher,
    });
    expect(restart.status).toBe("reconciliation_required");
    expect(calls).toBe(1);
  });

  test("offline mode uses a synthetic event with no fabricated Reppo eval ID", async () => {
    const offlineEnv = { AFC_OFFLINE: "1" };
    const queued = enqueueEvaluation(db, input("afc:test:offline"), {
      env: offlineEnv,
      now: start,
    });
    expect(queued).toMatchObject({
      offline: true,
      simulated_share: 1,
      eval_id: null,
    });
    const result = await runReppoTick(db, {
      env: offlineEnv,
      now: start,
      fetch: async () => {
        throw new Error("offline mode must not send HTTP");
      },
    });
    expect(result).toMatchObject({
      status: "settled",
      offline: true,
      eval_id: null,
    });
    const row = db.$client
      .query("SELECT event_json, source, simulated FROM events")
      .get() as { event_json: string; source: string; simulated: number };
    const event = JSON.parse(row.event_json) as Record<string, unknown>;
    expect(row.source).toBe("simulator");
    expect(row.simulated).toBe(1);
    expect(event.evidence).toBeUndefined();
    expect(event.attrs).toMatchObject({
      evaluation_origin: "synthetic_simulation",
      evaluation_status: "synthetic_not_reppo",
    });
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM verdicts").get(),
    ).toEqual({
      count: 0,
    });
  });

  test("live submissions remain 15 minutes apart even after quick settlement", async () => {
    const first = enqueueEvaluation(db, input("afc:test:spacing-a"), {
      env,
      now: start,
    });
    const fetcher: ReppoFetch = async (_url, init = {}) =>
      init.method === "POST"
        ? response({ id: "eval-spacing", status: "QUEUED" }, 201)
        : response(settled("eval-spacing"));
    await runReppoTick(db, {
      env,
      now: start,
      fetch: fetcher,
      fixtureDirectory,
    });
    await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(getReppoQueueStatus(db, first.queue_id)?.status).toBe("settled");
    const second = enqueueEvaluation(db, input("afc:test:spacing-b"), {
      env,
      now: new Date(start.getTime() + 2 * 60_000),
    });
    const tooSoon = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 2 * 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(tooSoon).toMatchObject({
      status: "queued",
      job_id: second.queue_id,
      next_poll_at: "2026-11-10T10:15:00.000Z",
    });
    const allowed = await runReppoTick(db, {
      env,
      now: new Date(start.getTime() + 15 * 60_000),
      fetch: fetcher,
      fixtureDirectory,
    });
    expect(allowed.status).toBe("pending");
  });

  test("validates Reppo UTF-8 limits before persisting queue intent", () => {
    expect(() =>
      enqueueEvaluation(
        db,
        input("afc:test:too-few", { samples: input().samples.slice(0, 2) }),
        { env, now: start },
      ),
    ).toThrow("3 to 5 samples");
    expect(() =>
      enqueueEvaluation(
        db,
        input("afc:test:criteria-limit", { criteria: ["é".repeat(1025)] }),
        { env, now: start },
      ),
    ).toThrow("2 KiB UTF-8");
    expect(() =>
      enqueueEvaluation(
        db,
        input("afc:test:payload-limit", {
          samples: [
            { id: "1", task: "t", output: "x".repeat(18_000) },
            { id: "2", task: "t", output: "x".repeat(18_000) },
            { id: "3", task: "t", output: "x".repeat(18_000) },
          ],
        }),
        { env, now: start },
      ),
    ).toThrow("under 50 KiB");
    expect(
      db.$client.query("SELECT COUNT(*) AS count FROM reppo_queue").get(),
    ).toEqual({
      count: 0,
    });
  });
});
