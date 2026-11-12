import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("serv:smoke works without credentials and logs all seven implemented jobs", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentfico-serv-smoke-"));
  const path = join(directory, "smoke.sqlite");
  try {
    const result = Bun.spawnSync([process.execPath, "run", "serv:smoke"], {
      cwd: root,
      env: {
        ...process.env,
        SERV_API_KEY: "",
        AFC_OFFLINE: "1",
        AFC_DB_PATH: path,
      },
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    const output = result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(output.map((row) => row.job)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(output.every((row) => row.offline && row.status === "success")).toBe(
      true,
    );
    const db = new Database(path, { readonly: true });
    try {
      const rows = db
        .query<{ id: string; offline: number; status: string }, []>(
          "SELECT id,offline,status FROM serv_calls ORDER BY job",
        )
        .all();
      expect(rows).toHaveLength(7);
      expect(rows.map((row) => row.id)).toEqual(
        output.map((row) => row.call_id),
      );
      expect(
        rows.every((row) => row.offline === 1 && row.status === "success"),
      ).toBe(true);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
