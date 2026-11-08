import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDb, openDb, storeEvents } from "@agentfico/db";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function runSimulator(dbPath: string, args: string[] = []) {
  const result = Bun.spawnSync(
    [process.execPath, "run", "sim", "--", "--seed", "42", ...args],
    {
      cwd: root,
      env: { ...process.env, AFC_DB_PATH: dbPath },
    },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

test("the seed-42 command writes all five personas and keeps its event hash and count on replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentfico-sim-"));
  const firstPath = join(directory, "first.sqlite");
  const secondPath = join(directory, "second.sqlite");

  try {
    const first = runSimulator(firstPath);
    expect(first).toContain("SIMULATED DATA | seed=42 days=90");
    for (const id of ["atlas", "blaze", "murk", "nova-7", "phoenix"]) {
      expect(first).toContain(`afc:sim:${id} `);
    }
    expect(first).toMatch(/^sha256=[a-f0-9]{64}$/m);
    expect(runSimulator(secondPath)).toBe(first);
    expect(runSimulator(firstPath)).toBe(first);

    const db = new Database(firstPath, { readonly: true });
    try {
      const totals = db
        .query<{ count: number; subjects: number; simulated: number }, []>(
          "SELECT count(*) AS count, count(DISTINCT subject_afc_id) AS subjects, sum(simulated) AS simulated FROM events",
        )
        .get();
      if (!totals) throw new Error("Expected event totals");
      const { count, subjects, simulated } = totals;
      expect(first).toContain(`events=${count}\n`);
      expect(count).toBeGreaterThan(5);
      expect(subjects).toBe(5);
      expect(simulated).toBe(count);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reseeding replaces selected legacy simulation histories and preserves other sources and personas", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentfico-upgrade-"));
  const dbPath = join(directory, "events.sqlite");
  const oldAtlasId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
  const oldBlazeId = "01ARZ3NDEKTSV4RRFFQ69G5FA2";
  const realId = "01ARZ3NDEKTSV4RRFFQ69G5FA3";
  try {
    const db = openDb(dbPath);
    try {
      migrateDb(db);
      const legacy = {
        event_id: oldAtlasId,
        subject: { afc_id: "afc:sim:atlas" },
        source: "simulator",
        simulated: true,
        attestation: "self_reported",
        type: "identity.registered",
        occurred_at: "2026-10-01T00:00:00.000Z",
      };
      storeEvents(db, [
        legacy,
        {
          ...legacy,
          event_id: oldBlazeId,
          subject: { afc_id: "afc:sim:blaze" },
        },
        {
          ...legacy,
          event_id: realId,
          source: "reppo",
          simulated: false,
          type: "work.evaluated",
        },
      ]);
      const output = runSimulator(dbPath, ["--personas", "atlas"]);
      const count = Number(/events=(\d+)/.exec(output)?.[1]);
      const rows = db.$client
        .query<{ event_id: string }, []>("SELECT event_id FROM events")
        .all();
      const ids = rows.map((row) => row.event_id);
      expect(rows).toHaveLength(count + 2);
      expect(ids).not.toContain(oldAtlasId);
      expect(ids).toContain(oldBlazeId);
      expect(ids).toContain(realId);
      expect(runSimulator(dbPath, ["--personas", "atlas"])).toBe(output);
    } finally {
      db.$client.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
