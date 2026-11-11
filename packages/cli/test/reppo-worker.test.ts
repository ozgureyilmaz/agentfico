import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueEvaluation, runReppoTick } from "@agentfico/adapters/reppo";
import { migrateDb, openDb } from "@agentfico/db";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("drain resumes an already pending evaluation when no new jobs are queued", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentfico-reppo-resume-"));
  const path = join(directory, "state.sqlite");
  const db = openDb(path);
  let polls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.method).toBe("GET");
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/agents/evals/resume-eval",
      );
      polls += 1;
      return Response.json({
        id: "resume-eval",
        status: "COMPLETED",
        score: 81,
        route: "ship",
        completedAt: new Date().toISOString(),
        result: {
          score: 81,
          decision: "accept",
          confidence: "high",
          route: "ship",
          reason: "Correct comparison",
          rubric_scores: { accuracy: 81 },
        },
      });
    },
  });
  const env = {
    ...process.env,
    AFC_DB_PATH: path,
    AFC_OFFLINE: "0",
    REPPO_API_KEY: "local-reppo-resume-credential",
    REPPO_BASE_URL: `http://127.0.0.1:${server.port}/api/v1`,
    AFC_REPPO_FIXTURE_DIR: directory,
  };
  try {
    migrateDb(db);
    const started = new Date(Date.now() - 120_000);
    enqueueEvaluation(
      db,
      {
        afc_id: "afc:test:resume",
        samples: [1, 2, 3].map((id) => ({
          id: String(id),
          task: "Compare",
          output: "A is cheaper",
        })),
        criteria: [],
        simulated: true,
      },
      { env, now: started },
    );
    await runReppoTick(db, {
      env,
      now: started,
      fixtureDirectory: directory,
      fetch: async () =>
        Response.json({ id: "resume-eval", status: "QUEUED" }, { status: 201 }),
    });
    const child = Bun.spawn(
      [process.execPath, "run", "reppo:worker", "--", "--drain"],
      { cwd: root, env, stdout: "pipe", stderr: "pipe" },
    );
    const exit = await child.exited;
    const stderr = await new Response(child.stderr).text();
    if (exit !== 0) throw new Error(stderr);
    expect(polls).toBe(1);
    expect(
      db.$client
        .query<{ status: string }, []>("SELECT status FROM reppo_queue")
        .get()?.status,
    ).toBe("settled");
  } finally {
    server.stop(true);
    db.$client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
