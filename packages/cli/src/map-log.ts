import { parseArgs } from "node:util";
import { mapAssistantLog } from "@agentfico/adapters/assistant-log";
import { type AgentFicoDb, migrateDb, openDb } from "@agentfico/db";
import { runServJob } from "@agentfico/serv";
import { redactValue } from "@agentfico/serv/redact";

export async function mapLogWithServ(
  db: AgentFicoDb,
  content: string,
  env: Record<string, string | undefined>,
) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 1 || lines.length > 20) {
    throw new Error(
      "Provide one to twenty structured records for a SERV mapping run",
    );
  }
  const records = lines.map((line, index) => {
    try {
      const raw: unknown = JSON.parse(line);
      const event = mapAssistantLog(raw);
      if (event) return { raw, event };
    } catch {
      // Report the line number without echoing the supplied contents.
    }
    throw new Error(`Unsupported assistant record at line ${index + 1}`);
  });
  const outputs = [];
  for (const { raw, event } of records) {
    const line = JSON.stringify(
      redactValue(
        raw,
        [env.SERV_API_KEY ?? "", env.REPPO_API_KEY ?? ""].filter(Boolean),
      ),
    );
    const result = await runServJob(
      6,
      {
        afc_id: event.subject.afc_id,
        line,
        expected: {
          type: event.type as Parameters<
            typeof runServJob<6>
          >[1]["expected"]["type"],
          occurred_at: event.occurred_at,
          outcome: event.outcome ?? null,
        },
      },
      { db, afcId: event.subject.afc_id, env },
    );
    outputs.push({
      event,
      serv_call_id: result.call_id,
      offline: result.offline,
    });
  }
  return outputs;
}

export async function runMapCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { log: { type: "string" }, live: { type: "boolean" } },
  });
  if (!values.log) throw new Error("Usage: afc map-log --log LOG.jsonl");
  const file = Bun.file(values.log);
  if (file.size > 1_048_576) throw new Error("Mapping file exceeds 1 MiB");
  const db = openDb();
  try {
    migrateDb(db);
    const env = {
      ...process.env,
      ...(!values.live ? { AFC_OFFLINE: "1" } : {}),
    };
    const rows = await mapLogWithServ(db, await file.text(), env);
    console.log(JSON.stringify(rows));
  } finally {
    db.$client.close();
  }
}
