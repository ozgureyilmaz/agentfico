import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { AgentFicoDb } from "./client";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

export const migrateDb = (db: AgentFicoDb): void => {
  migrate(db, { migrationsFolder });
};
