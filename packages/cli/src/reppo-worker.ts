import { parseArgs } from "node:util";
import type { ReppoTickResult } from "@agentfico/adapters/reppo";
import {
  getReppoQueueStatus,
  listReppoWorkIds,
  runReppoTick,
} from "@agentfico/adapters/reppo";
import { migrateDb, openDb } from "@agentfico/db";

const POLL_FALLBACK_MS = 60_000;

function parseFlags(args: string[]): { once: boolean; drain: boolean } {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      once: { type: "boolean", default: false },
      drain: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (values.once && values.drain)
    throw new Error("Choose either --once or --drain");
  return { once: values.once, drain: values.drain };
}

function printResult(result: ReppoTickResult): void {
  console.log(JSON.stringify(result));
}

function isTerminal(status: string | undefined): boolean {
  return status === "settled" || status === "failed";
}

function delayUntil(result: ReppoTickResult): number {
  if (!result.next_poll_at) return POLL_FALLBACK_MS;
  const scheduled = Date.parse(result.next_poll_at);
  if (!Number.isFinite(scheduled)) return POLL_FALLBACK_MS;
  return Math.max(250, scheduled - Date.now());
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function drainInitialQueue(
  db: ReturnType<typeof openDb>,
  queueIds: number[],
): Promise<number> {
  if (queueIds.length === 0) {
    const result = await runReppoTick(db);
    printResult(result);
    return result.status === "blocked" ||
      result.status === "reconciliation_required"
      ? 2
      : 0;
  }

  while (true) {
    const unfinished = queueIds.some((id) => {
      const status = getReppoQueueStatus(db, id)?.status;
      return status !== undefined && !isTerminal(status);
    });
    if (!unfinished) return 0;

    const result = await runReppoTick(db, { allowedQueueIds: queueIds });
    printResult(result);
    if (
      result.status === "blocked" ||
      result.status === "reconciliation_required"
    )
      return 2;
    if (result.status === "idle") return 1;
    if (
      !queueIds.some((id) => !isTerminal(getReppoQueueStatus(db, id)?.status))
    ) {
      return 0;
    }
    await sleep(delayUntil(result));
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(Bun.argv.slice(2));
  const db = openDb();
  try {
    migrateDb(db);
    if (flags.once) {
      const result = await runReppoTick(db);
      printResult(result);
      if (
        result.status === "blocked" ||
        result.status === "reconciliation_required"
      ) {
        process.exitCode = 2;
      }
      return;
    }
    if (flags.drain) {
      const initialQueueIds = listReppoWorkIds(db);
      process.exitCode = await drainInitialQueue(db, initialQueueIds);
      return;
    }

    while (true) {
      const result = await runReppoTick(db);
      printResult(result);
      if (
        result.status === "blocked" ||
        result.status === "reconciliation_required"
      ) {
        process.exitCode = 2;
        return;
      }
      await sleep(delayUntil(result));
    }
  } finally {
    db.$client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Reppo worker failed");
  process.exitCode = 1;
});
