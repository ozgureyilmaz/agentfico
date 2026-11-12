import { parseArgs } from "node:util";
import {
  enqueueEvaluation,
  getReppoQueueStatus,
} from "@agentfico/adapters/reppo";
import type { AgentScore } from "@agentfico/core";
import { type AgentFicoDb, migrateDb, openDb } from "@agentfico/db";
import { ProbePlanSchema, runServJob, type ServInputs } from "@agentfico/serv";
import { z } from "zod";

const AnswerSchema = z.strictObject({
  id: z.string().regex(/^probe-[1-5]$/),
  output: z.string().trim().min(1).max(6000),
});
type Options = { env: Record<string, string | undefined>; now: Date };

function scoringGaps(score: AgentScore): ServInputs[1]["missing_signals"] {
  const codes = new Set(
    score.reason_codes
      .filter((reason) => reason.direction === "hurts")
      .map((reason) => reason.code),
  );
  const signals: ServInputs[1]["missing_signals"] = [];
  if (codes.has("Q03")) signals.push("work_quality");
  if (score.factors.P < 0.6) signals.push("payment_conduct");
  if (score.factors.L < 0.6) signals.push("reliability");
  if (score.confidence === "low") signals.push("identity_history");
  return signals;
}

export async function planProbes(
  db: AgentFicoDb,
  score: AgentScore,
  category: string,
  capabilities: string[],
  { env, now }: Options,
) {
  const result = await runServJob(
    1,
    {
      afc_id: score.afc_id,
      category,
      capabilities,
      missing_signals: scoringGaps(score),
    },
    { db, afcId: score.afc_id, env },
  );
  const plan = ProbePlanSchema.parse(result.data);
  const createdAt = now.toISOString();
  const readyAt = new Date(
    now.getTime() +
      Math.max(...plan.probes.map((probe) => probe.delay_minutes)) * 60_000,
  ).toISOString();
  db.$client
    .query(`INSERT INTO probe_plans
    (id, afc_id, category, created_at, ready_at, plan_json, simulated)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      result.call_id,
      score.afc_id,
      category,
      createdAt,
      readyAt,
      JSON.stringify(plan),
      score.simulated_share > 0 ? 1 : 0,
    );
  return {
    plan_id: result.call_id,
    afc_id: score.afc_id,
    ready_at: readyAt,
    offline: result.offline,
    probes: plan.probes.map((probe, index) => ({
      id: `probe-${index + 1}`,
      ...probe,
    })),
  };
}

export function queueProbeAnswers(
  db: AgentFicoDb,
  planId: string,
  input: unknown,
  { env, now }: Options,
) {
  const answers = z.array(AnswerSchema).min(3).max(5).parse(input);
  const outputs = new Map(answers.map(({ id, output }) => [id, output]));
  if (outputs.size !== answers.length)
    throw new Error("Each probe answer ID must be unique");
  return db.$client
    .transaction(() => {
      const record = db.$client
        .query<
          {
            afc_id: string;
            category: string;
            plan_json: string;
            ready_at: string;
            simulated: number;
            queue_id: number | null;
          },
          [string]
        >("SELECT * FROM probe_plans WHERE id = ?")
        .get(planId);
      if (!record) throw new Error("Probe plan was not found");
      const plan = ProbePlanSchema.parse(JSON.parse(record.plan_json));
      if (outputs.size !== plan.probes.length)
        throw new Error("Submit an answer for every probe");
      const samples = plan.probes.map((probe, index) => {
        const id = `probe-${index + 1}`;
        const output = outputs.get(id);
        if (!output) throw new Error(`Missing answer for ${id}`);
        return { id, task: probe.task, output };
      });
      if (record.queue_id !== null) {
        const existing = getReppoQueueStatus(db, record.queue_id);
        if (!existing)
          throw new Error("Probe evaluation queue record was not found");
        return {
          plan_id: planId,
          queue_id: record.queue_id,
          status: existing.status,
          offline: existing.offline,
        };
      }
      if (env.AFC_OFFLINE !== "1" && now.toISOString() < record.ready_at) {
        throw new Error(`Probe batch is ready after ${record.ready_at}`);
      }
      const queued = enqueueEvaluation(
        db,
        {
          afc_id: record.afc_id,
          samples,
          criteria: plan.probes.map((probe) => probe.acceptance),
          context:
            "Judge these submitted probe answers against their recorded tasks. The answers are owner-supplied.",
          simulated: record.simulated === 1,
          category: record.category,
        },
        { env, now },
      );
      db.$client
        .query("UPDATE probe_plans SET queue_id = ? WHERE id = ?")
        .run(queued.queue_id, planId);
      return { plan_id: planId, ...queued };
    })
    .immediate();
}

export async function runProbeCommand(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      id: { type: "string" },
      category: { type: "string", default: "shopping" },
      capability: { type: "string", multiple: true, default: [] },
      plan: { type: "string" },
      answers: { type: "string" },
      live: { type: "boolean", default: false },
    },
  });
  const db = openDb();
  try {
    migrateDb(db);
    const env = {
      ...process.env,
      ...(!values.live ? { AFC_OFFLINE: "1" } : {}),
    };
    const options = { env, now: new Date() };
    if (positionals[0] === "plan" && values.id) {
      const { createApiService } = await import("@agentfico/api");
      const score = createApiService({ db, env }).score(values.id);
      console.log(
        JSON.stringify(
          await planProbes(
            db,
            score,
            values.category,
            values.capability,
            options,
          ),
        ),
      );
    } else if (positionals[0] === "enqueue" && values.plan && values.answers) {
      const answers = (await Bun.file(values.answers).text())
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      console.log(
        JSON.stringify(queueProbeAnswers(db, values.plan, answers, options)),
      );
    } else {
      throw new Error(
        "Usage: afc probe plan --id AFC_ID | afc probe enqueue --plan PLAN_ID --answers ANSWERS.jsonl",
      );
    }
  } finally {
    db.$client.close();
  }
}
