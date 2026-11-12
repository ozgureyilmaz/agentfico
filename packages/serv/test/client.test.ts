import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { scoreAgent } from "@agentfico/core";
import { type AgentFicoDb, migrateDb, openDb } from "@agentfico/db";
import { generateSimulation, SIMULATION_ANCHOR } from "../../sim/src";
import { runServJob, ServCallError } from "../src/client";

const key = ["local", "test", "credential"].join("-");
const env = {
  SERV_API_KEY: key,
  AFC_OFFLINE: "0",
  SERV_BASE_URL: "https://example.test/v1",
  AFC_MODEL_RUBRIC: "configured-serv-kronos-multipath",
};
const input = { category: "shopping", capabilities: ["Compare receipts"] };
const rubric = {
  criteria: ["Cite the receipt."],
  context: "Evaluate a shopping result.",
};

interface LogRow {
  id: string;
  afc_id: string | null;
  status: string;
  offline: number;
  model: string;
  features_json: string;
  tools_json: string;
  input_sha256: string;
  output_sha256: string | null;
  output_preview: string | null;
  usage_json: string | null;
  response_id: string | null;
  cost_json: string | null;
  prompt_guard_json: string | null;
  shadow_agent_json: string | null;
}

function completion(
  content = JSON.stringify(rubric),
  extras: Record<string, unknown> = {},
) {
  return Response.json({
    id: "completion-1",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
    ...extras,
  });
}

describe("logged SERV client", () => {
  let db: AgentFicoDb;
  const logs = () =>
    db.$client
      .query<LogRow, []>("SELECT * FROM serv_calls ORDER BY created_at, id")
      .all();

  beforeEach(() => {
    db = openDb(":memory:");
    migrateDb(db);
  });
  afterEach(() => {
    db.$client.close();
  });

  test("explanations have room to preserve the full scored event citation set", async () => {
    const score = scoreAgent(
      generateSimulation({ seed: 42, personas: ["atlas"] }),
      "afc:sim:atlas",
      SIMULATION_ANCHOR,
    );
    expect(
      score.reason_codes.flatMap((reason) => reason.events).length,
    ).toBeGreaterThan(200);
    const explanation = {
      trust_memo: "Review the supplied evidence.",
      reason_codes: score.reason_codes,
    };
    const result = await runServJob(
      4,
      {
        afc_id: score.afc_id,
        score: score.score,
        factors: score.factors,
        reason_codes: score.reason_codes,
        reader: "agent_owner",
      },
      {
        db,
        env: { ...env, AFC_MODEL_EXPLAIN: "configured-explanation" },
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.max_completion_tokens).toBe(8192);
          return completion(JSON.stringify(explanation));
        },
      },
    );
    expect(result.data.reason_codes).toEqual(score.reason_codes);
    expect(logs()[0].status).toBe("success");
  });

  test("persists pending intent before dispatch and uses strict schema, system prompt, guard and env configuration", async () => {
    let requests = 0;
    const result = await runServJob(2, input, {
      db,
      env,
      fetch: async (url, init) => {
        requests += 1;
        expect(String(url)).toBe("https://example.test/v1/chat/completions");
        expect(logs()).toHaveLength(1);
        expect(logs()[0].status).toBe("pending");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${key}`,
        );
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe(env.AFC_MODEL_RUBRIC);
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[0].content.length).toBeGreaterThan(0);
        expect(body.messages[1].content).toContain("untrusted");
        expect(body.tools[0].function.name).toBe("serv_prompt_guard");
        expect(body.response_format.type).toBe("json_schema");
        expect(body.response_format.json_schema.strict).toBe(true);
        expect(
          body.response_format.json_schema.schema.additionalProperties,
        ).toBe(false);
        return completion(undefined, {
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        });
      },
    });
    expect(requests).toBe(1);
    expect(result.offline).toBe(false);
    expect(result.data).toEqual(rubric);
    const [row] = logs();
    expect(row.id).toBe(result.call_id);
    expect(row.status).toBe("success");
    expect(row.offline).toBe(0);
    expect(row.response_id).toBe("completion-1");
    expect(JSON.parse(row.features_json)).toEqual([
      "serv-kronos",
      "serv-multipath",
    ]);
    expect(
      JSON.parse(row.usage_json ?? "null").prompt_tokens_details.cached_tokens,
    ).toBe(4);
    expect(row.input_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.output_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(key);
  });

  test("job 5 uses the offline fixture and logs its guard, citations, and trace", async () => {
    const input = {
      afc_id: "afc:sim:nova-7",
      findings: [
        {
          code: "F01" as const,
          text: "Circular payment activity was detected.",
          source_event_ids: ["01JBF5V4R9X4Y5K7Q6M8N2P3AA"],
        },
      ],
    };
    let dispatched = false;
    const result = await runServJob(5, input, {
      db,
      env: { AFC_OFFLINE: "1", AFC_MODEL_FRAUD: "configured-fraud" },
      fetch: async () => {
        dispatched = true;
        throw new Error("Offline fraud review must not dispatch");
      },
    });
    const [row] = logs();
    expect(dispatched).toBe(false);
    expect(result.offline).toBe(true);
    expect(row.id).toBe(result.call_id);
    expect(row.afc_id).toBe(input.afc_id);
    expect(row.status).toBe("success");
    expect(row.offline).toBe(1);
    expect(
      JSON.parse(row.tools_json).map(
        (tool: { function: { name: string } }) => tool.function.name,
      ),
    ).toEqual(["serv_prompt_guard", "serv_shadow_agent"]);
    expect(result.data.findings[0]?.source_event_ids).toEqual(
      input.findings[0]?.source_event_ids,
    );
  });

  test("no key uses an offline fixture without constructing a network call or inventing usage", async () => {
    const result = await runServJob(2, input, {
      db,
      env: {},
      fetch: async () => {
        throw new Error("Unexpected network call");
      },
    });
    expect(result.offline).toBe(true);
    expect(result.data.criteria.length).toBeGreaterThan(0);
    const [row] = logs();
    expect(row.status).toBe("success");
    expect(row.offline).toBe(1);
    expect(row.response_id).toBeNull();
    expect(row.usage_json).toBeNull();
    expect(row.cost_json).toBeNull();
    expect(row.prompt_guard_json).toBeNull();
    expect(row.shadow_agent_json).toBeNull();
  });

  test("explicit offline mode takes precedence over a key", async () => {
    const result = await runServJob(2, input, {
      db,
      env: { ...env, AFC_OFFLINE: "1" },
      fetch: async () => {
        throw new Error("Unexpected network call");
      },
    });
    expect(result.offline).toBe(true);
    expect(logs()).toHaveLength(1);
  });

  test("critique summaries request guarded shadow validation with schema defaults", async () => {
    await runServJob(
      3,
      {
        critiques: [
          {
            critique_id: "c1",
            criterion: "Evidence",
            critique: "Receipt missing",
          },
        ],
      },
      {
        db,
        env: { ...env, AFC_MODEL_SUMMARY: "configured-summary" },
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(
            body.tools.map(
              (tool: { function: { name: string } }) => tool.function.name,
            ),
          ).toEqual(["serv_prompt_guard", "serv_shadow_agent"]);
          const settings = body.tools[1].function.parameters.properties;
          expect(settings.hint.default).toContain("critique ID");
          expect(settings.max_iterations.default).toBe(3);
          return completion(
            JSON.stringify({
              weaknesses: [
                { summary: "Missing receipts", critique_ids: ["c1"] },
              ],
            }),
          );
        },
      },
    );
    expect(logs()).toHaveLength(1);
    expect(logs()[0].status).toBe("success");
  });

  test("agent context is inferred from validated input and conflicting attribution is rejected", async () => {
    const workInput = {
      afc_id: "afc:sim:atlas",
      category: "shopping",
      target_quality: 70,
      count: 3,
    };
    await runServJob(7, workInput, { db, env: {} });
    expect(logs()[0].afc_id).toBe(workInput.afc_id);
    await expect(
      runServJob(7, workInput, { db, env: {}, afcId: "afc:sim:blaze" }),
    ).rejects.toBeInstanceOf(ServCallError);
    expect(logs().some((row) => row.status === "invalid_input")).toBe(true);
  });

  test("a live error creates one failed row, makes one request and never falls back to fixtures", async () => {
    let requests = 0;
    await expect(
      runServJob(2, input, {
        db,
        env,
        fetch: async () => {
          requests += 1;
          return Response.json(
            {
              error: {
                message: `Authorization: Bearer ${key}`,
                type: "server_error",
              },
            },
            { status: 503 },
          );
        },
      }),
    ).rejects.toBeInstanceOf(ServCallError);
    expect(requests).toBe(1);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].status).toBe("http_error");
    expect(logs()[0].offline).toBe(0);
    expect(JSON.stringify(logs())).not.toContain(key);
  });

  for (const [name, response, expectedStatus] of [
    ["invalid JSON", () => completion("{invalid"), "invalid_output"],
    [
      "wrong schema",
      () => completion(JSON.stringify({ criteria: [], context: "" })),
      "invalid_output",
    ],
    [
      "unknown score field",
      () => completion(JSON.stringify({ ...rubric, score: 850 })),
      "invalid_output",
    ],
    [
      "refusal",
      () =>
        completion("", {
          choices: [
            {
              finish_reason: "stop",
              message: { content: null, refusal: "Blocked" },
            },
          ],
        }),
      "refused",
    ],
    [
      "truncation",
      () =>
        completion("{", {
          choices: [{ finish_reason: "length", message: { content: "{" } }],
        }),
      "truncated",
    ],
  ] as const) {
    test(`${name} is rejected and logged with its observed usage`, async () => {
      await expect(
        runServJob(2, input, {
          db,
          env,
          fetch: async () =>
            Response.json({
              ...(await response().json()),
              usage: {
                prompt_tokens: 2,
                completion_tokens: 1,
                total_tokens: 3,
              },
            }),
        }),
      ).rejects.toBeInstanceOf(ServCallError);
      expect(logs()).toHaveLength(1);
      expect(logs()[0].status).toBe(expectedStatus);
      expect(logs()[0].offline).toBe(0);
      expect(JSON.parse(logs()[0].usage_json ?? "null")).toEqual({
        prompt_tokens: 2,
        completion_tokens: 1,
        total_tokens: 3,
      });
    });
  }

  test("redacts complete credentials before truncating previews, including nested Authorization fields", async () => {
    const token = "x".repeat(80);
    const content = JSON.stringify({
      criteria: ["Read evidence"],
      context: `${"a".repeat(280)} Bearer ${token} Authorization: ${key}`,
    });
    const result = await runServJob(2, input, {
      db,
      env,
      fetch: async () => completion(content),
    });
    const [row] = logs();
    expect(row.output_preview?.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(row)).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(token.slice(0, 10));
    expect(result.data.context).not.toContain(key);
    expect(result.data.context).not.toContain(token);
  });

  test("invalid input and missing live configuration are logged without dispatch", async () => {
    const fetch = async () => {
      throw new Error("Unexpected dispatch");
    };
    await expect(
      runServJob(2, { category: 4 } as never, { db, env, fetch }),
    ).rejects.toBeInstanceOf(ServCallError);
    await expect(
      runServJob(2, input, {
        db,
        env: { ...env, AFC_MODEL_RUBRIC: "" },
        fetch,
      }),
    ).rejects.toBeInstanceOf(ServCallError);
    expect(
      logs()
        .map((row) => row.status)
        .sort(),
    ).toEqual(["configuration_error", "invalid_input"]);
  });

  test("a logging failure prevents a live request", async () => {
    db.$client.exec("DROP TABLE serv_calls");
    let requests = 0;
    await expect(
      runServJob(2, input, {
        db,
        env,
        fetch: async () => {
          requests += 1;
          return completion();
        },
      }),
    ).rejects.toBeInstanceOf(ServCallError);
    expect(requests).toBe(0);
  });

  test("undocumented metadata and absent usage stay null", async () => {
    await runServJob(2, input, {
      db,
      env,
      fetch: async () =>
        completion(undefined, {
          cost: 1,
          prompt_guard: { passed: true },
          shadow_agent: { passed: true },
        }),
    });
    const [row] = logs();
    expect(row.usage_json).toBeNull();
    expect(row.cost_json).toBeNull();
    expect(row.prompt_guard_json).toBeNull();
    expect(row.shadow_agent_json).toBeNull();
  });
});
