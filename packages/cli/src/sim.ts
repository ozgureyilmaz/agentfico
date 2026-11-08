import { parseArgs } from "node:util";
import { SimulatorAdapter } from "@agentfico/adapters";
import { migrateDb, openDb, storeEvents } from "@agentfico/db";
import {
  DEFAULT_SIMULATION_DAYS,
  DEFAULT_SIMULATION_SEED,
  hashEventsSha256,
  isPersonaId,
  type PersonaId,
} from "@agentfico/sim";

function parseInteger(raw: string, name: string, minimum: number): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`--${name} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

function parsePersonas(raw: string): PersonaId[] | "all" {
  if (raw === "all") return raw;
  return raw.split(",").map((id) => {
    if (!isPersonaId(id)) throw new Error(`Unknown persona: ${id}`);
    return id;
  });
}

function main(args: string[]) {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      seed: { type: "string", default: String(DEFAULT_SIMULATION_SEED) },
      days: { type: "string", default: String(DEFAULT_SIMULATION_DAYS) },
      personas: { type: "string", default: "all" },
    },
  });
  const seed = parseInteger(values.seed, "seed", 0);
  const days = parseInteger(values.days, "days", 1);
  const personas = parsePersonas(values.personas);
  const events = new SimulatorAdapter().generate({ seed, days, personas });
  const counts = new Map<string, number>();

  for (const event of events) {
    const id = event.subject.afc_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const db = openDb();
  try {
    migrateDb(db);
    storeEvents(db, events);
  } finally {
    db.$client.close();
  }

  console.log(
    `SIMULATED DATA | seed=${seed} days=${days} events=${events.length}`,
  );
  for (const [id, count] of counts) console.log(`${id} ${count}`);
  console.log(`sha256=${hashEventsSha256(events)}`);
}

try {
  main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
