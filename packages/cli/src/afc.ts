import { readFile } from "node:fs/promises";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { SimulatorAdapter } from "@agentfico/adapters";
import { KiteDataError, readKiteEvents } from "@agentfico/adapters/kite-chain";
import { createApiService } from "@agentfico/api";
import type { BehaviorEvent } from "@agentfico/core";
import { WorkSampleSchema } from "@agentfico/core/api-schemas";
import { migrateDb, openDb, replaceSimulatorEvents } from "@agentfico/db";
import {
  DEFAULT_SIMULATION_DAYS,
  DEFAULT_SIMULATION_SEED,
  hashEventsSha256,
  isPersonaId,
  type PersonaId,
} from "@agentfico/sim";
import { z } from "zod";
import { runMapCommand } from "./map-log";
import { runProbeCommand } from "./probe";

class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 2,
  ) {
    super(message);
  }
}

class ProviderUnavailableError extends CliError {
  readonly outcome = "UNSURE" as const;
  readonly provider = "KiteScan" as const;
  readonly providerStatus = 503 as const;

  constructor(code: string, message: string) {
    super(code, message, 2);
  }
}

const KiteFixtureSchema = z.strictObject({
  simulated: z.boolean(),
  pages: z.array(z.unknown()).min(1).max(20),
});

function normalizedArgs(): string[] {
  const args = Bun.argv.slice(2);
  return args[0] === "--" ? args.slice(1) : args;
}

function parseOptions<const O extends NonNullable<ParseArgsConfig["options"]>>(
  args: string[],
  options: O,
) {
  return parseArgs({ args, options, strict: true, allowPositionals: true });
}

function required(value: string | undefined, flag: string): string {
  if (!value?.trim())
    throw new CliError("missing_argument", `--${flag} is required`);
  return value;
}

function parseInteger(
  value: string | undefined,
  name: string,
  minimum: number,
): number {
  const raw = value ?? "";
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new CliError(
      "invalid_argument",
      `--${name} must be a safe integer of at least ${minimum}`,
    );
  }
  return parsed;
}

function parsePersonas(raw: string): PersonaId[] | "all" {
  if (raw === "all") return raw;
  const values = raw.split(",");
  for (const value of values) {
    if (!isPersonaId(value))
      throw new CliError("invalid_persona", `Unknown persona: ${value}`);
  }
  return values as PersonaId[];
}

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorJson(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  ) {
    const code = String(error.code);
    const message = String(error.message);
    return { code, message, status: 1 };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "invalid_input",
      message: "Input failed schema validation",
      status: 2,
    };
  }
  return {
    code: "command_failed",
    message: error instanceof Error ? error.message : "Command failed",
    status: 1,
  };
}

function parseJsonl<T>(
  content: string,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  const result: T[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CliError(
        "invalid_jsonl",
        `${label} line ${index + 1} is not valid JSON`,
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new CliError(
        "invalid_jsonl_record",
        `${label} line ${index + 1} has an unsupported shape`,
      );
    }
    result.push(parsed.data);
  }
  if (result.length === 0)
    throw new CliError("empty_jsonl", `${label} file contains no records`);
  return result;
}

async function main(args: string[]) {
  if (args[0] === "probe") return runProbeCommand(args.slice(1));
  if (args[0] === "map-log") return runMapCommand(args.slice(1));
  const [command, ...rest] = args;
  if (!command)
    throw new CliError(
      "missing_command",
      "Expected score, explain, evaluate, sim, or serv-log",
    );

  const db = openDb();
  try {
    migrateDb(db);
    const service = createApiService({ db, env: process.env });

    if (command === "score") {
      const { values } = parseOptions(rest, {
        id: { type: "string" },
        log: { type: "string" },
        kite: { type: "string" },
        "kite-fixture": { type: "string" },
        "as-of": { type: "string" },
      });
      const modes = [values.id, values.log, values.kite].filter(Boolean).length;
      if (modes !== 1)
        throw new CliError(
          "invalid_arguments",
          "Choose exactly one of --id, --log, or --kite",
        );
      if (values.id) return json(service.score(values.id, values["as-of"]));
      if (values.log) {
        if (values["kite-fixture"])
          throw new CliError(
            "invalid_arguments",
            "--kite-fixture can only be used with --kite",
          );
        const content = await readFile(values.log, "utf8");
        return json(service.scoreLog(content, { asOf: values["as-of"] }));
      }
      if (!values.kite && values["kite-fixture"])
        throw new CliError(
          "invalid_arguments",
          "--kite-fixture can only be used with --kite",
        );
      if (values.kite && !/^0x[0-9a-fA-F]{40}$/.test(values.kite)) {
        throw new CliError(
          "invalid_kite_address",
          "--kite must be a 20-byte 0x-prefixed address",
        );
      }
      if (values.kite) {
        let fixture: { simulated: boolean; pages: unknown[] } | undefined;
        if (values["kite-fixture"]) {
          let data: unknown;
          try {
            data = JSON.parse(await readFile(values["kite-fixture"], "utf8"));
          } catch {
            throw new CliError(
              "invalid_kite_fixture",
              "Kite fixture file is not valid JSON",
            );
          }
          const parsed = KiteFixtureSchema.safeParse(data);
          if (!parsed.success)
            throw new CliError(
              "invalid_kite_fixture",
              "Kite fixture must contain simulated and pages fields",
            );
          fixture = parsed.data;
        }

        let result: Awaited<ReturnType<typeof readKiteEvents>>;
        try {
          result = await readKiteEvents(values.kite, {
            env: process.env,
            ...(fixture ? { fixture } : {}),
          });
        } catch (error) {
          if (error instanceof KiteDataError) {
            if (error.code === "invalid_address")
              throw new CliError("invalid_kite_address", error.message);
            throw new ProviderUnavailableError(error.code, error.message);
          }
          throw error;
        }

        const score = service.scoreEvents(
          result.events,
          result.afc_id,
          values["as-of"],
        );
        if (!result.complete) {
          console.error(
            JSON.stringify({
              warning: {
                code: "partial_coverage",
                message:
                  "KiteScan history is incomplete; treat this score as provisional",
                pages: result.pages,
              },
            }),
          );
        }
        return json({
          score,
          complete: result.complete,
          pages: result.pages,
          offline: result.offline,
          outcome: result.complete
            ? result.offline
              ? "OFFLINE_FIXTURE"
              : "COMPLETE"
            : "PARTIAL_COVERAGE",
          simulated_share: score.simulated_share,
        });
      }
      throw new CliError("invalid_arguments", "No scoring input was provided");
    }

    if (command === "explain") {
      const { positionals, values } = parseOptions(rest, {
        "as-of": { type: "string" },
      });
      const afcId = positionals[0];
      if (positionals.length !== 1)
        throw new CliError(
          "invalid_arguments",
          "Usage: afc explain <afcId> [--as-of <ISO timestamp>]",
        );
      const report = await service.report(afcId ?? "", values["as-of"]);
      return json({
        afc_id: report.score.afc_id,
        score: report.score.score,
        reason_codes: report.score.reason_codes,
        trust_memo: report.trust_memo,
        critique_summary: report.critique_summary,
        serv_call_ids: report.serv_call_ids,
        simulated_share: report.simulated_share,
      });
    }

    if (command === "serv-log") {
      const { values } = parseOptions(rest, {
        "afc-id": { type: "string" },
        job: { type: "string" },
        limit: { type: "string" },
      });
      const job = values.job ? parseInteger(values.job, "job", 1) : undefined;
      if (job !== undefined && job > 7)
        throw new CliError("invalid_argument", "--job must be between 1 and 7");
      const limit = values.limit
        ? parseInteger(values.limit, "limit", 1)
        : undefined;
      if (limit !== undefined && limit > 200)
        throw new CliError("invalid_argument", "--limit must be at most 200");
      return json(service.servLog({ afcId: values["afc-id"], job, limit }));
    }

    if (command === "evaluate") {
      const { values } = parseOptions(rest, {
        samples: { type: "string" },
        category: { type: "string" },
        id: { type: "string" },
        simulated: { type: "boolean", default: false },
      });
      const category = required(values.category, "category");
      const samples = parseJsonl(
        await readFile(required(values.samples, "samples"), "utf8"),
        WorkSampleSchema,
        "Sample",
      );
      if (samples.length < 3 || samples.length > 5) {
        throw new CliError(
          "invalid_samples",
          "Reppo trace evaluation requires 3 to 5 samples",
        );
      }
      const afcId =
        values.id ??
        `afc:sample:${category.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
      return json(
        await service.enqueueEvaluation({
          afc_id: afcId,
          samples,
          criteria: [],
          simulated: values.simulated,
          category,
        }),
      );
    }

    if (command === "sim") {
      const { values } = parseOptions(rest, {
        seed: { type: "string", default: String(DEFAULT_SIMULATION_SEED) },
        days: { type: "string", default: String(DEFAULT_SIMULATION_DAYS) },
        personas: { type: "string", default: "all" },
      });
      const seed = parseInteger(values.seed, "seed", 0);
      const days = parseInteger(values.days, "days", 1);
      const personas = parsePersonas(values.personas);
      const generated: BehaviorEvent[] = new SimulatorAdapter().generate({
        seed,
        days,
        personas,
      });
      const stored = replaceSimulatorEvents(db, generated);
      const counts = Object.fromEntries(
        [...new Set(generated.map((event) => event.subject.afc_id))]
          .sort()
          .map((afcId) => [
            afcId,
            generated.filter((event) => event.subject.afc_id === afcId).length,
          ]),
      );
      return json({
        simulated_share: 1,
        seed,
        days,
        events: generated.length,
        stored,
        personas: counts,
        sha256: hashEventsSha256(generated),
      });
    }

    throw new CliError("unknown_command", `Unknown command: ${command}`);
  } finally {
    db.$client.close();
  }
}

main(normalizedArgs()).catch((error: unknown) => {
  const formatted = errorJson(error);
  console.error(
    JSON.stringify({
      error: { code: formatted.code, message: formatted.message },
      ...(error instanceof ProviderUnavailableError
        ? {
            outcome: error.outcome,
            provider: error.provider,
            status: error.providerStatus,
          }
        : {}),
      simulated_share: 0,
    }),
  );
  process.exitCode = formatted.status;
});
