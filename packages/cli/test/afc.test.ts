import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "@agentfico/api/app";
import { migrateDb, openDb, replaceSimulatorEvents } from "@agentfico/db";
import {
  generateSimulation,
  PERSONA_IDS,
  SIMULATION_ANCHOR,
} from "@agentfico/sim";

const root = resolve(import.meta.dir, "../../..");
const cliPath = resolve(import.meta.dir, "../src/afc.ts");
const asOf = SIMULATION_ANCHOR;
let directory = "";
let dbPath = "";
let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "agentfico-cli-test-"));
  dbPath = join(directory, "agentfico.sqlite");
  db = openDb(dbPath);
  migrateDb(db);
  replaceSimulatorEvents(db, generateSimulation({ seed: 42, personas: "all" }));
  app = createApp({ db, env: { AFC_AS_OF: asOf, AFC_OFFLINE: "1" } });
});

afterAll(() => {
  db?.$client.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      AFC_DB_PATH: dbPath,
      AFC_AS_OF: asOf,
      AFC_OFFLINE: "1",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode: await child.exited, stdout, stderr };
}

describe("M5 CLI", () => {
  test("score --id exactly matches the API for all five personas", async () => {
    for (const persona of PERSONA_IDS) {
      const afcId = `afc:sim:${persona}`;
      const apiResponse = await app.request(`/v1/score/${afcId}`);
      expect(apiResponse.status).toBe(200);
      const apiScore = await apiResponse.json();
      const cli = await runCli(["score", "--id", afcId]);
      expect(cli.exitCode).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual(apiScore);
    }
  });

  test("score --log uses the same provisional service contract as the upload API", async () => {
    const examplePath = resolve(root, "examples/my-agent.jsonl");
    const content = await Bun.file(examplePath).text();
    const form = new FormData();
    form.set(
      "file",
      new File([content], "agent.jsonl", { type: "application/jsonl" }),
    );
    const apiResponse = await app.request("/v1/score/log", {
      method: "POST",
      body: form,
    });
    expect(apiResponse.status).toBe(200);
    const apiScore = await apiResponse.json();
    const cli = await runCli(["score", "--log", examplePath]);
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(cli.stdout)).toEqual(apiScore);
  });

  test("explain and serv-log return structured JSON", async () => {
    const explain = await runCli(["explain", "afc:sim:atlas"]);
    expect(explain.exitCode).toBe(0);
    const explanation = JSON.parse(explain.stdout);
    expect(explanation.afc_id).toBe("afc:sim:atlas");
    expect(explanation.trust_memo).toEqual(expect.any(String));

    const log = await runCli(["serv-log", "--afc-id", "afc:sim:atlas"]);
    expect(log.exitCode).toBe(0);
    const trace = JSON.parse(log.stdout);
    expect(trace).toHaveProperty("calls");
    expect(trace.simulated_share).toBe(1);
  });

  test("Kite mode returns typed UNSURE when the offline fixture is missing", async () => {
    const result = await runCli(
      ["score", "--kite", "0x0000000000000000000000000000000000000001"],
      {
        AFC_OFFLINE: "1",
        KITE_USDC_ADDRESS: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "kite_fixture_unavailable" },
      outcome: "UNSURE",
      provider: "KiteScan",
      status: 503,
    });
  });

  test("Kite fixture scoring is read-only and carries completeness metadata", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    const token = "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";
    const fixturePath = join(directory, "kite-fixture.json");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        simulated: true,
        pages: [
          {
            items: [
              {
                transaction_hash: `0x${"1".repeat(64)}`,
                log_index: 0,
                timestamp: "2026-11-04T12:00:00.000Z",
                from: { hash: address },
                to: { hash: "0x0000000000000000000000000000000000000002" },
                token: { address_hash: token, decimals: "6" },
                total: { value: "2500000", decimals: "6" },
              },
              {
                transaction_hash: `0x${"2".repeat(64)}`,
                log_index: 1,
                timestamp: "2026-11-04T13:00:00.000Z",
                from: { hash: "0x0000000000000000000000000000000000000003" },
                to: { hash: address },
                token: { address_hash: token, decimals: "6" },
                total: { value: "1750000", decimals: "6" },
              },
            ],
            next_page_params: null,
          },
        ],
      }),
    );
    const result = await runCli(
      ["score", "--kite", address, "--kite-fixture", fixturePath],
      { AFC_OFFLINE: "1", KITE_USDC_ADDRESS: token },
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      complete: true,
      pages: 1,
      offline: true,
      outcome: "OFFLINE_FIXTURE",
      simulated_share: 1,
    });
    expect(output.score.score).toEqual(expect.any(Number));
    expect(result.stderr).toBe("");
  });

  test("incomplete Kite pagination is visible as partial coverage", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    const token = "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";
    const fixturePath = join(directory, "kite-partial-fixture.json");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        simulated: true,
        pages: Array.from({ length: 20 }, (_, index) => ({
          items: [],
          next_page_params: { block_number: index + 1 },
        })),
      }),
    );
    const result = await runCli(
      ["score", "--kite", address, "--kite-fixture", fixturePath],
      { AFC_OFFLINE: "1", KITE_USDC_ADDRESS: token },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      complete: false,
      pages: 20,
      outcome: "PARTIAL_COVERAGE",
    });
    expect(JSON.parse(result.stderr).warning.code).toBe("partial_coverage");
  });

  test("evaluate enqueues in offline mode through the shared service", async () => {
    const samplesPath = join(directory, "samples.jsonl");
    writeFileSync(
      samplesPath,
      [
        { id: "sample-1", task: "task one", output: "output one" },
        { id: "sample-2", task: "task two", output: "output two" },
        { id: "sample-3", task: "task three", output: "output three" },
      ]
        .map((sample) => JSON.stringify(sample))
        .join("\n"),
    );
    const result = await runCli(
      [
        "evaluate",
        "--samples",
        samplesPath,
        "--category",
        "shopping",
        "--simulated",
      ],
      { REPPO_API_KEY: "test" },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "queued",
      eval_id: null,
      offline: true,
      simulated_share: 1,
    });
  });
});
