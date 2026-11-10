import { scoreAgent } from "@agentfico/core";
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
