import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
import {
  type AgentFicoDb,
  migrateDb,
  openDb,
  replaceSimulatorEvents,
  storeEvents,
} from "../src";
import { reppoQueue, servCalls } from "../src/schema";

const event = (
  eventId: string,
  afcId = "afc:sim:atlas",
  type: BehaviorEvent["type"] = "payment.sent",
  evidence?: BehaviorEvent["evidence"],
): BehaviorEvent => ({
  event_id: eventId,
  subject: { afc_id: afcId },
  source: "simulator",
  simulated: true,
  attestation: "self_reported",
  type,
  occurred_at: "2026-11-05T12:00:00.000Z",
  ...(evidence === undefined ? {} : { evidence }),
});

const eventId = (lastCharacter: string): string =>
  `01ARZ3NDEKTSV4RRFFQ69G5FA${lastCharacter}`;

describe("AgentFICO SQLite database", () => {
  let db: AgentFicoDb;

  beforeEach(() => {
    db = openDb(":memory:");
    migrateDb(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  test("exports a Zod 4 BehaviorEvent schema and rejects invalid events", () => {
    const parsed = BehaviorEventSchema.parse(event(eventId("V")));

    expect(parsed.type).toBe("payment.sent");
    expect(
      BehaviorEventSchema.safeParse({ ...parsed, event_id: "not-a-ulid" })
        .success,
    ).toBe(false);
    expect(
      BehaviorEventSchema.safeParse({ ...parsed, type: "payment.unknown" })
        .success,
    ).toBe(false);
  });

  test("migrates the database schema idempotently", () => {
    migrateDb(db);

    const rows = db.$client
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT LIKE '__drizzle_%' ORDER BY name",
      )
      .all();

    expect(rows.map((row) => row.name)).toEqual([
      "events",
      "probe_plans",
      "reppo_calls",
      "reppo_queue",
      "scores",
      "serv_calls",
      "verdicts",
    ]);
  });

  test("persists events transactionally and deduplicates without crossing subject or type", () => {
    const result = storeEvents(db, [
      event(eventId("V"), "afc:sim:atlas", "payment.sent", {
        tx_hash: "0xabc",
        url: "https://evidence.test/a",
      }),
      event(eventId("W"), "afc:sim:atlas", "payment.sent", {
        url: "https://evidence.test/a",
        tx_hash: "0xabc",
      }),
      event(eventId("X"), "afc:sim:blaze", "payment.sent", {
        tx_hash: "0xabc",
        url: "https://evidence.test/a",
      }),
      event(eventId("Y"), "afc:sim:atlas", "payment.received", {
        tx_hash: "0xabc",
        url: "https://evidence.test/a",
      }),
      event(eventId("Z"), "afc:sim:atlas", "payment.sent", {}),
      event(eventId("0"), "afc:sim:atlas", "payment.sent", {}),
    ]);

    expect(result).toEqual({ inserted: 5, duplicates: 1 });

    const storedCount = db.$client
      .query("SELECT COUNT(*) AS count FROM events")
      .get() as { count: number };
    expect(storedCount.count).toBe(5);

    expect(() =>
      storeEvents(db, [event(eventId("1")), { event_id: "invalid" }]),
    ).toThrow();
    const countAfterInvalidBatch = db.$client
      .query("SELECT COUNT(*) AS count FROM events")
      .get() as { count: number };
    expect(countAfterInvalidBatch.count).toBe(5);
  });

  test("allows multiple queued jobs per account but only one active eval", () => {
    const timestamp = "2026-11-05T12:00:00.000Z";
    const queuedJob = {
      afcId: "afc:sim:atlas",
      accountId: "reppo-account-1",
      type: "trace",
      payloadJson: "{}",
      criteriaJson: "[]",
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.insert(reppoQueue).values([queuedJob, queuedJob]).run();
    db.insert(reppoQueue)
      .values({ ...queuedJob, status: "pending", evalId: "eval-1" })
      .run();

    expect(
      db.$client
        .query("SELECT api_contract FROM reppo_queue WHERE id = 1")
        .get(),
    ).toEqual({ api_contract: "eval-requests" });

    expect(() => {
      db.insert(reppoQueue)
        .values({ ...queuedJob, status: "submitting", evalId: "eval-2" })
        .run();
    }).toThrow();

    const count = db.$client
      .query("SELECT COUNT(*) AS count FROM reppo_queue")
      .get() as { count: number };
    expect(count.count).toBe(3);
  });

  test("simulator replacement validates before deleting and rolls back on SQL failure", () => {
    const original = event(eventId("1"));
    const replacement = event(eventId("2"));
    storeEvents(db, [original]);
    expect(() =>
      replaceSimulatorEvents(db, [{ ...replacement, simulated: false }]),
    ).toThrow();
    db.$client.exec(`CREATE TRIGGER fail_replacement BEFORE INSERT ON events
      WHEN NEW.event_id = '${replacement.event_id}'
      BEGIN SELECT RAISE(ABORT, 'replacement failed'); END`);
    expect(() => replaceSimulatorEvents(db, [replacement])).toThrow();
    const ids = db.$client
      .query<{ event_id: string }, []>("SELECT event_id FROM events")
      .all();
    expect(ids).toEqual([{ event_id: original.event_id }]);
  });

  test("stores the SERV offline flag and defaults live-call rows to false", () => {
    const requiredFields = {
      id: "serv-call-live",
      createdAt: "2026-11-05T12:00:00.000Z",
      job: 4,
      model: "model-from-env",
      featuresJson: "[]",
      toolsJson: "[]",
      status: "completed",
      inputSha256: "a".repeat(64),
    };

    db.insert(servCalls).values(requiredFields).run();
    db.insert(servCalls)
      .values({ ...requiredFields, id: "serv-call-offline", offline: true })
      .run();

    const rows = db.$client
      .query("SELECT id, offline FROM serv_calls ORDER BY id")
      .all() as Array<{ id: string; offline: number }>;

    expect(rows).toEqual([
      { id: "serv-call-live", offline: 0 },
      { id: "serv-call-offline", offline: 1 },
    ]);
  });
});

test("opens file-backed SQLite databases in WAL mode and closes cleanly", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentfico-db-"));
  const path = join(directory, "nested", "agentfico.sqlite");
  const fileDb = openDb(path);

  try {
    const row = fileDb.$client.query("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(row.journal_mode.toLowerCase()).toBe("wal");

    const timeout = fileDb.$client.query("PRAGMA busy_timeout").get() as {
      timeout: number;
    };
    expect(Object.values(timeout)).toContain(5000);
  } finally {
    fileDb.$client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
