import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { importRecordedReppoEvaluation } from "@agentfico/adapters/reppo";
import { ServCallSchema } from "@agentfico/core/api-schemas";
import {
  type AgentFicoDb,
  migrateDb,
  openDb,
  replaceSimulatorEvents,
  servCalls,
} from "@agentfico/db";
import { generateSimulation } from "@agentfico/sim";
import { z } from "zod";

const root = resolve(import.meta.dir, "../../..");
const reppoDir = resolve(root, "fixtures/reppo");
const ManifestSchema = z.array(
  z.strictObject({
    afc_id: z.string().regex(/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/),
    file: z.string().regex(/^real\/[a-z0-9-]+\.json$/i),
    simulated: z.boolean(),
  }),
);
const EvidenceCallSchema = ServCallSchema.extend({
  input_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  output_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  usage: ServCallSchema.shape.usage.default(null),
  cost: ServCallSchema.shape.cost.default(null),
});

async function seedDemo(db: AgentFicoDb) {
  migrateDb(db);
  const manifest = ManifestSchema.parse(
    await Bun.file(resolve(reppoDir, "recorded.json")).json(),
  );
  const reppoRows = await Promise.all(
    manifest.map(async (row) => ({
      ...row,
      response: z
        .object({ response: z.unknown() })
        .parse(await Bun.file(resolve(reppoDir, row.file)).json()).response,
    })),
  );
  const evidence = await Bun.file(
    resolve(root, "docs/evidence/serv-calls.sample.jsonl"),
  ).text();
  const serviceCalls = evidence
    .trim()
    .split(/\r?\n/)
    .map((line) => EvidenceCallSchema.parse(JSON.parse(line)));
  db.$client.transaction(() => {
    replaceSimulatorEvents(db, generateSimulation({ seed: 42 }));
    for (const row of reppoRows) {
      importRecordedReppoEvaluation(
        db,
        row.afc_id,
        row.response,
        row.simulated,
      );
    }
    for (const call of serviceCalls) {
      db.insert(servCalls)
        .values({
          id: call.id,
          createdAt: call.created_at,
          job: call.job,
          afcId: call.afc_id,
          model: call.model,
          featuresJson: JSON.stringify(call.features),
          toolsJson: JSON.stringify(call.tools),
          responseId: call.response_id,
          status: call.status,
          offline: call.offline,
          latencyMs: call.latency_ms,
          usageJson: call.usage ? JSON.stringify(call.usage) : null,
          costJson: call.cost ? JSON.stringify(call.cost) : null,
          inputSha256: call.input_sha256,
          outputSha256: call.output_sha256,
        })
        .onConflictDoNothing()
        .run();
    }
  })();
  return { verdicts: reppoRows.length, servCalls: serviceCalls.length };
}

async function main() {
  process.env.AFC_OFFLINE = "1";
  process.env.AFC_HOSTED = "1";
  if (process.env.AFC_EPHEMERAL_DB === "1") {
    process.env.AFC_DB_PATH = resolve(
      mkdtempSync(resolve(tmpdir(), "agentfico-")),
      "agentfico.sqlite",
    );
  } else {
    process.env.AFC_DB_PATH ??= resolve(root, "data/demo.sqlite");
  }
  delete process.env.REPPO_API_KEY;
  delete process.env.SERV_API_KEY;

  if (!Bun.argv.includes("--prebuilt")) {
    const build = Bun.spawnSync(
      [process.execPath, "run", "--filter", "@agentfico/web", "build"],
      {
        cwd: root,
        env: { ...process.env, VITE_AFC_HOSTED: "1" },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (build.exitCode !== 0) throw new Error("Dashboard build failed");
  }
  const db = openDb();
  try {
    const evidence = await seedDemo(db);
    console.log(
      `Demo evidence loaded: ${evidence.verdicts} Reppo verdicts, ${evidence.servCalls} SERV calls`,
    );
  } finally {
    db.$client.close();
  }

  const { default: options } = await import("../../../apps/api/src/index");
  const server = Bun.serve(options);
  console.log(`AgentFICO demo running at ${server.url}`);
}

await main();
