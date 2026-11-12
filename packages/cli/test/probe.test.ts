import { expect, test } from "bun:test";
import { scoreAgent } from "@agentfico/core";
import { migrateDb, openDb, probePlans, servCalls } from "@agentfico/db";
import { generateSimulation, SIMULATION_ANCHOR } from "@agentfico/sim";
import { mapLogWithServ } from "../src/map-log";
import { planProbes, queueProbeAnswers } from "../src/probe";

const env = { AFC_OFFLINE: "1" };

test("persists a capped fixture probe plan and queues exactly one matching batch", async () => {
  const db = openDb(":memory:");
  try {
    migrateDb(db);
    const score = scoreAgent(
      generateSimulation({ personas: ["atlas"] }),
      "afc:sim:atlas",
      SIMULATION_ANCHOR,
    );
    const options = { env, now: new Date(SIMULATION_ANCHOR) };
    const plan = await planProbes(
      db,
      score,
      "shopping",
      ["Compare prices"],
      options,
    );
    expect(plan.probes).toHaveLength(3);
    expect(db.select().from(probePlans).get()?.id).toBe(plan.plan_id);
    const answers = plan.probes.map(({ id }) => ({
      id,
      output: "Example owner-supplied answer.",
    }));
    expect(() =>
      queueProbeAnswers(db, plan.plan_id, answers.slice(1), options),
    ).toThrow();
    const queued = queueProbeAnswers(db, plan.plan_id, answers, options);
    expect(queued.offline).toBe(true);
    expect(queueProbeAnswers(db, plan.plan_id, answers, options).queue_id).toBe(
      queued.queue_id,
    );
    expect(db.select().from(probePlans).get()?.queueId).toBe(queued.queue_id);
  } finally {
    db.$client.close();
  }
});

test("job 6 traces validated events and rejects unknown records before logging", async () => {
  const db = openDb(":memory:");
  try {
    migrateDb(db);
    const line = JSON.stringify({
      format: "afc-assistant-v1",
      agent_id: "afc:asst:mapping-test",
      id: "sample-task",
      timestamp: SIMULATION_ANCHOR,
      type: "task.completed",
    });
    const [row] = await mapLogWithServ(db, line, env);
    expect(row.event.type).toBe("task.completed");
    expect(row.event.attestation).toBe("self_reported");
    expect(db.select().from(servCalls).get()?.job).toBe(6);
    await expect(mapLogWithServ(db, `${line}\n{}`, env)).rejects.toThrow(
      "line 2",
    );
    expect(db.select().from(servCalls).all()).toHaveLength(1);
  } finally {
    db.$client.close();
  }
});
