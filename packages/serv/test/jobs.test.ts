import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { applyFraudReview } from "../src/fraud-review";
import {
  materializeFixture,
  SERV_JOBS,
  type ServInputs,
  type ServJobId,
  validateJobOutput,
} from "../src/jobs";

const critiques = [
  {
    critique_id: "critique-a",
    criterion: "Complete the requested comparison",
    critique: "The response omitted one requested option.",
  },
  {
    critique_id: "critique-b",
    criterion: "Explain the recommendation",
    critique: "The recommendation was not tied to the stated needs.",
  },
];

const reasonCodes: ServInputs[4]["reason_codes"] = [
  {
    code: "Q01",
    direction: "hurts" as const,
    text: "Recent work did not meet a stated criterion.",
    events: ["event-a"],
    eval_ids: ["eval-a"],
  },
  {
    code: "P01",
    direction: "helps" as const,
    text: "The cited payment was completed on time.",
    events: ["event-b"],
    eval_ids: [],
  },
];

const explanationInput = {
  afc_id: "afc:sim:atlas",
  score: 778,
  factors: { Q: 0.8, P: 0.9, L: 0.7, C: 0.6, I: 0.8, F: 1 },
  reason_codes: reasonCodes,
  reader: "marketplace" as const,
};

const fraudInput: ServInputs[5] = {
  afc_id: "afc:sim:nova-7",
  findings: [
    {
      code: "F01",
      text: "Circular payment activity was detected.",
      source_event_ids: ["01JBF5V4R9X4Y5K7Q6M8N2P3AA"],
    },
    {
      code: "F02",
      text: "A shared funder was detected.",
      source_event_ids: [
        "01JBF5V4R9X4Y5K7Q6M8N2P3AB",
        "01JBF5V4R9X4Y5K7Q6M8N2P3AC",
      ],
    },
  ],
};

function fraudOutput() {
  return {
    summary: "The supplied events support two detector findings.",
    findings: [
      {
        code: "F01" as const,
        source_event_ids: [...fraudInput.findings[0]!.source_event_ids],
        typology: "wash" as const,
        description:
          "The cited detector events show a circular payment pattern.",
      },
      {
        code: "F02" as const,
        source_event_ids: [...fraudInput.findings[1]!.source_event_ids],
        typology: "sybil_ring" as const,
        description: "The cited detector events share a funding source.",
      },
    ],
  };
}

function explanationOutput() {
  return {
    trust_memo: "The supplied evidence indicates strong payment conduct.",
    reason_codes: reasonCodes.map((reason) => ({
      ...reason,
      text: `Explanation for ${reason.code}.`,
    })),
  };
}

async function readFixture(job: ServJobId): Promise<unknown> {
  return Bun.file(
    new URL(
      `../../../fixtures/serv/${SERV_JOBS[job].fixtureFile}`,
      import.meta.url,
    ),
  ).json();
}

describe("SERV job contracts", () => {
  test("explanations require event evidence for every reason code", () => {
    const input = {
      ...explanationInput,
      reason_codes: [{ ...reasonCodes[0], events: [] }],
    };
    const output = { trust_memo: "A memo.", reason_codes: input.reason_codes };
    expect(() => validateJobOutput(4, input, output)).toThrow();
  });
  test("registers only jobs 2, 3, 4, and 7 with prompts and fixture metadata", () => {
    expect(Object.keys(SERV_JOBS).map(Number).sort()).toEqual([2, 3, 4, 5, 7]);
    for (const job of Object.values(SERV_JOBS)) {
      expect(job.name.length).toBeGreaterThan(0);
      expect(job.systemPrompt.length).toBeGreaterThan(0);
      expect(job.fixtureFile.endsWith(".json")).toBe(true);
    }
  });

  test("uses the configured model environment variables and only specified shadow hints", () => {
    expect(SERV_JOBS[2].modelEnv).toBe("AFC_MODEL_RUBRIC");
    expect(SERV_JOBS[3].modelEnv).toBe("AFC_MODEL_SUMMARY");
    expect(SERV_JOBS[4].modelEnv).toBe("AFC_MODEL_EXPLAIN");
    expect(SERV_JOBS[5].modelEnv).toBe("AFC_MODEL_FRAUD");
    expect(SERV_JOBS[7].modelEnv).toBe("AFC_MODEL_SUMMARY");
    expect(SERV_JOBS[2].shadowHint).toBeUndefined();
    expect(SERV_JOBS[3].shadowHint).toContain("critique ID");
    expect(SERV_JOBS[4].shadowHint).toContain("event_id");
    expect(SERV_JOBS[5].shadowHint).toContain("source_event_ids");
    expect(SERV_JOBS[7].shadowHint).toBeUndefined();
  });

  test("requires strict, complete structured output objects", () => {
    for (const job of Object.values(SERV_JOBS)) {
      expect(job.outputSchema.safeParse({}).success).toBe(false);
    }
    expect(
      SERV_JOBS[2].outputSchema.safeParse({
        criteria: ["A criterion"],
        context: "Context",
        extra: true,
      }).success,
    ).toBe(false);
  });

  test("converts every output schema to a strict JSON Schema with all fields required", () => {
    for (const job of Object.values(SERV_JOBS)) {
      const schema = z.toJSONSchema(job.outputSchema) as {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.additionalProperties).toBe(false);
      expect([...(schema.required ?? [])].sort()).toEqual(
        Object.keys(schema.properties ?? {}).sort(),
      );
    }
  });

  test("enforces UTF-8 byte limits on rubric criteria and context", () => {
    const exactCriterionLimit = "é".repeat(1024);
    const overCriterionLimit = "é".repeat(1025);
    expect(() =>
      validateJobOutput(
        2,
        { category: "shopping", capabilities: [] },
        {
          criteria: [exactCriterionLimit],
          context: "Context",
        },
      ),
    ).not.toThrow();
    expect(() =>
      validateJobOutput(
        2,
        { category: "shopping", capabilities: [] },
        {
          criteria: [overCriterionLimit],
          context: "Context",
        },
      ),
    ).toThrow();
    expect(() =>
      validateJobOutput(
        2,
        { category: "shopping", capabilities: [] },
        {
          criteria: ["Criterion"],
          context: "🙂".repeat(8193),
        },
      ),
    ).toThrow();
  });

  test("rejects empty rubric criteria and context", () => {
    expect(() =>
      validateJobOutput(
        2,
        { category: "shopping", capabilities: [] },
        {
          criteria: ["   "],
          context: "Context",
        },
      ),
    ).toThrow();
    expect(() =>
      validateJobOutput(
        2,
        { category: "shopping", capabilities: [] },
        {
          criteria: ["A criterion"],
          context: "",
        },
      ),
    ).toThrow();
  });

  test("accepts critique summaries only when every cited critique ID is supplied", () => {
    const input = { critiques };
    const output = {
      weaknesses: [
        {
          summary: "A recurring omission is visible.",
          critique_ids: ["critique-a"],
        },
      ],
    };
    expect(validateJobOutput(3, input, output)).toEqual(output);
    expect(() =>
      validateJobOutput(3, input, {
        weaknesses: [{ summary: "Unknown source", critique_ids: ["made-up"] }],
      }),
    ).toThrow();
  });

  test("rejects empty critique summaries and trust memos", () => {
    expect(() =>
      validateJobOutput(
        3,
        { critiques },
        {
          weaknesses: [{ summary: "  ", critique_ids: ["critique-a"] }],
        },
      ),
    ).toThrow();
    expect(() =>
      validateJobOutput(4, explanationInput, {
        ...explanationOutput(),
        trust_memo: "  ",
      }),
    ).toThrow();
  });

  test("requires explanation identities and citations to match every supplied reason", () => {
    const input = structuredClone(explanationInput);
    const output = explanationOutput();
    expect(validateJobOutput(4, input, output)).toEqual(output);
    expect(input).toEqual(explanationInput);
    expect(() =>
      validateJobOutput(4, input, {
        ...output,
        reason_codes: output.reason_codes.slice(0, 1),
      }),
    ).toThrow();
    expect(() =>
      validateJobOutput(4, input, {
        ...output,
        reason_codes: output.reason_codes.map((reason, index) =>
          index === 0 ? { ...reason, events: ["different-event"] } : reason,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateJobOutput(4, input, { ...output, score: 849 }),
    ).toThrow();
  });

  test("fraud reviews preserve only supplied reason codes and source event IDs", () => {
    const output = fraudOutput();
    expect(validateJobOutput(5, fraudInput, output)).toEqual(output);
    expect(() =>
      validateJobOutput(5, fraudInput, {
        ...output,
        findings: output.findings.map((finding, index) =>
          index === 0
            ? {
                ...finding,
                source_event_ids: ["01JBF5V4R9X4Y5K7Q6M8N2P3ZZ"],
              }
            : finding,
        ),
      }),
    ).toThrow("source event IDs do not match");
    expect(() =>
      validateJobOutput(5, fraudInput, {
        ...output,
        findings: output.findings.slice(0, 1),
      }),
    ).toThrow("every supplied finding");
    expect(() =>
      validateJobOutput(5, fraudInput, { ...output, score: 300 }),
    ).toThrow();
  });

  test("offline fraud fixture materializes the real supplied citation set", async () => {
    const fixture = await readFixture(5);
    const output = materializeFixture(5, fraudInput, fixture);
    expect(
      output.findings.map(({ code, source_event_ids }) => ({
        code,
        source_event_ids,
      })),
    ).toEqual(
      fraudInput.findings.map(({ code, source_event_ids }) => ({
        code,
        source_event_ids,
      })),
    );
  });

  test("public fraud review attaches the trace ID without changing its citations", () => {
    const output = fraudOutput();
    const review = applyFraudReview(fraudInput, output, {
      call_id: "serv-trace-5",
      offline: true,
    });
    expect(review.serv_call_id).toBe("serv-trace-5");
    expect(review.offline).toBe(true);
    expect(
      review.findings.map(({ code, source_event_ids }) => ({
        code,
        source_event_ids,
      })),
    ).toEqual(
      fraudInput.findings.map(({ code, source_event_ids }) => ({
        code,
        source_event_ids,
      })),
    );
  });

  test("bounds explanation scores and factors to the published ranges", () => {
    expect(
      SERV_JOBS[4].inputSchema.safeParse({ ...explanationInput, score: 300 })
        .success,
    ).toBe(true);
    expect(
      SERV_JOBS[4].inputSchema.safeParse({ ...explanationInput, score: 850 })
        .success,
    ).toBe(true);
    expect(
      SERV_JOBS[4].inputSchema.safeParse({ ...explanationInput, score: 299 })
        .success,
    ).toBe(false);
    expect(
      SERV_JOBS[4].inputSchema.safeParse({ ...explanationInput, score: 851 })
        .success,
    ).toBe(false);
    expect(
      SERV_JOBS[4].inputSchema.safeParse({
        ...explanationInput,
        factors: { ...explanationInput.factors, Q: -0.01 },
      }).success,
    ).toBe(false);
    expect(
      SERV_JOBS[4].inputSchema.safeParse({
        ...explanationInput,
        factors: { ...explanationInput.factors, F: 1.01 },
      }).success,
    ).toBe(false);
  });

  test("accepts only canonical core reason codes", () => {
    expect(SERV_JOBS[4].inputSchema.safeParse(explanationInput).success).toBe(
      true,
    );
    expect(
      SERV_JOBS[4].inputSchema.safeParse({
        ...explanationInput,
        reason_codes: reasonCodes.map((reason, index) =>
          index === 0 ? { ...reason, code: "Q99" } : reason,
        ),
      }).success,
    ).toBe(false);
  });

  test("requires simulated work sample count to match the request", () => {
    const input = {
      afc_id: "afc:sim:phoenix",
      category: "shopping",
      target_quality: 72,
      count: 3,
    };
    const output = {
      simulated: true as const,
      samples: [
        {
          id: "sample-1",
          task: "Compare two options.",
          output: "Option A is ...",
        },
        {
          id: "sample-2",
          task: "Explain a choice.",
          output: "The choice is ...",
        },
        {
          id: "sample-3",
          task: "Summarize a result.",
          output: "The result is ...",
        },
      ],
    };
    expect(validateJobOutput(7, input, output)).toEqual(output);
    expect(() =>
      validateJobOutput(7, input, {
        ...output,
        samples: output.samples.slice(0, 2),
      }),
    ).toThrow();
    expect(() =>
      validateJobOutput(7, input, { ...output, simulated: false as const }),
    ).toThrow();
    expect(() =>
      validateJobOutput(7, input, {
        ...output,
        samples: output.samples.map((sample, index) =>
          index === 1 ? { ...sample, id: "sample-1" } : sample,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateJobOutput(7, input, {
        ...output,
        samples: output.samples.map((sample, index) =>
          index === 0 ? { ...sample, output: " " } : sample,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateJobOutput(7, input, {
        simulated: true as const,
        samples: Array.from({ length: 3 }, (_, index) => ({
          id: `sample-${index}`,
          task: "x".repeat(14_000),
          output: "y".repeat(100),
        })),
      }),
    ).toThrow();
  });

  test("materializes rubric placeholders from the current input", async () => {
    const input = {
      category: "travel planning",
      capabilities: ["compare", "summarize"],
    };
    const output = materializeFixture(2, input, await readFixture(2));
    expect(JSON.stringify(output)).toContain("travel planning");
    expect(JSON.stringify(output)).toContain("compare, summarize");
  });

  test("materializes critique citations from the current input", async () => {
    const output = materializeFixture(3, { critiques }, await readFixture(3));
    expect(output.weaknesses[0]?.critique_ids).toEqual([
      "critique-a",
      "critique-b",
    ]);
  });

  test("materializes explanation identities and citations from the current input", async () => {
    const output = materializeFixture(
      4,
      explanationInput,
      await readFixture(4),
    );
    expect(output.reason_codes).toEqual(
      explanationInput.reason_codes.map((reason) => ({
        ...reason,
        text: expect.any(String),
      })),
    );
    expect(output.reason_codes).toHaveLength(
      explanationInput.reason_codes.length,
    );
  });

  test("materializes exactly the requested number of bounded simulated samples", async () => {
    const input = {
      afc_id: "afc:sim:phoenix",
      category: "shopping",
      target_quality: 72,
      count: 4,
    };
    const output = materializeFixture(7, input, await readFixture(7));
    expect(output.simulated).toBe(true);
    expect(output.samples).toHaveLength(input.count);
    expect(output.samples.map((sample) => sample.id)).toEqual([
      "afc:sim:phoenix:compare-options",
      "afc:sim:phoenix:summarize-request",
      "afc:sim:phoenix:recommend-next-step",
      "afc:sim:phoenix:check-result",
    ]);
    expect(
      new TextEncoder().encode(JSON.stringify(output.samples)).byteLength,
    ).toBeLessThan(40_000);
    expect(JSON.stringify(output)).toContain("shopping");
    expect(JSON.stringify(output)).toContain("72");
  });

  test("rejects an empty simulated-work fixture instead of manufacturing samples", () => {
    expect(() =>
      materializeFixture(
        7,
        {
          afc_id: "afc:sim:phoenix",
          category: "shopping",
          target_quality: 72,
          count: 3,
        },
        { samples: [] },
      ),
    ).toThrow();
  });

  test("rejects duplicate and empty sample IDs in simulated-work fixtures", () => {
    const input = {
      afc_id: "afc:sim:phoenix",
      category: "shopping",
      target_quality: 72,
      count: 3,
    };
    const samples = [
      { id: "duplicate", task: "Task one", output: "Output one" },
      { id: "duplicate", task: "Task two", output: "Output two" },
      { id: "third", task: "Task three", output: "Output three" },
    ];
    expect(() => materializeFixture(7, input, { samples })).toThrow();
    expect(() =>
      materializeFixture(7, input, {
        samples: samples.map((sample, index) =>
          index === 1 ? { ...sample, id: " " } : sample,
        ),
      }),
    ).toThrow();
  });
});
