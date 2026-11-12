import { detectFraud, scoreAgent } from "@agentfico/core";
import { migrateDb, openDb } from "@agentfico/db";
import { runServJob } from "@agentfico/serv";
import { generateSimulation, SIMULATION_ANCHOR } from "@agentfico/sim";

async function main() {
  const db = openDb();
  try {
    migrateDb(db);
    const afcId = "afc:sim:atlas";
    const score = scoreAgent(
      generateSimulation({ seed: 42, personas: ["atlas"] }),
      afcId,
      SIMULATION_ANCHOR,
    );
    const options = { db, afcId };
    const print = (
      job: number,
      result: { call_id: string; offline: boolean },
    ) => {
      console.log(
        JSON.stringify({
          job,
          call_id: result.call_id,
          offline: result.offline,
          status: "success",
        }),
      );
    };
    print(
      1,
      await runServJob(
        1,
        {
          afc_id: afcId,
          category: "shopping",
          capabilities: ["Compare prices"],
          missing_signals: ["work_quality"],
        },
        options,
      ),
    );
    print(
      2,
      await runServJob(
        2,
        {
          category: "shopping",
          capabilities: ["Compare prices", "Cite receipts"],
        },
        options,
      ),
    );
    print(
      3,
      await runServJob(
        3,
        {
          critiques: [
            {
              critique_id: "smoke:critique:1",
              criterion: "Receipt evidence",
              critique: "Synthetic smoke input omitted the receipt reference.",
            },
          ],
        },
        options,
      ),
    );
    print(
      4,
      await runServJob(
        4,
        {
          afc_id: afcId,
          score: score.score,
          factors: score.factors,
          reason_codes: score.reason_codes,
          reader: "agent_owner",
        },
        options,
      ),
    );
    const nova = "afc:sim:nova-7";
    const findings = detectFraud(
      generateSimulation({ seed: 42, personas: ["nova-7"] }),
      {
        afcId: nova,
        asOfMs: Date.parse(SIMULATION_ANCHOR),
      },
    );
    print(
      5,
      await runServJob(
        5,
        {
          afc_id: nova,
          findings: findings.map(({ code, source_event_ids }) => ({
            code,
            source_event_ids,
            text: "Review the cited detector evidence.",
          })),
        },
        { db, afcId: nova },
      ),
    );
    const occurred_at = "2026-11-01T10:00:00.000Z";
    const logId = "afc:asst:smoke";
    print(
      6,
      await runServJob(
        6,
        {
          afc_id: logId,
          line: JSON.stringify({
            format: "afc-assistant-v1",
            agent_id: logId,
            id: "smoke-task",
            timestamp: occurred_at,
            type: "task.completed",
          }),
          expected: { type: "task.completed", occurred_at, outcome: "success" },
        },
        { db, afcId: logId },
      ),
    );
    print(
      7,
      await runServJob(
        7,
        { afc_id: afcId, category: "shopping", target_quality: 70, count: 3 },
        options,
      ),
    );
  } finally {
    db.$client.close();
  }
}

main().catch((error: unknown) => {
  // The client exposes only safe call identifiers and failure categories.
  console.error(error instanceof Error ? error.message : "SERV smoke failed");
  process.exitCode = 1;
});
