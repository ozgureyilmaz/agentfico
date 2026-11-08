import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function runSimulator(dbPath: string) {
  const result = Bun.spawnSync(
    [process.execPath, "run", "sim", "--", "--seed", "42"],
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
