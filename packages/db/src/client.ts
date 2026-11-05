import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { schema } from "./schema";

export type AgentFicoDb = BunSQLiteDatabase<typeof schema> & {
  $client: Database;
};

const defaultDbPath = resolve(
  import.meta.dir,
  "../../../data/agentfico.sqlite",
);

export const openDb = (path?: string): AgentFicoDb => {
  const configuredPath = path ?? process.env.AFC_DB_PATH ?? defaultDbPath;
  const dbPath =
    configuredPath === ":memory:"
      ? configuredPath
      : isAbsolute(configuredPath)
        ? configuredPath
        : resolve(configuredPath);

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const client = new Database(dbPath);
  try {
    client.exec("PRAGMA busy_timeout = 5000;");
    client.exec("PRAGMA journal_mode = WAL;");
    client.exec("PRAGMA foreign_keys = ON;");

    return drizzle(client, { schema });
  } catch (error) {
    client.close();
    throw error;
  }
};
