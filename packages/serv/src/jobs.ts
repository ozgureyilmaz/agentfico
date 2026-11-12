import { METHODOLOGY, type ReasonCode } from "@agentfico/core";
import { z } from "zod";

export type ServJobId = 2 | 3 | 4 | 5 | 7;

type ReasonCodeKey = ReasonCode["code"];

const reasonCodeKeys = METHODOLOGY.reason_codes.map((reason) => reason.key) as [
  ReasonCodeKey,
  ...ReasonCodeKey[],
];
const scoreMinimum = Math.min(...METHODOLOGY.bands.map((band) => band.min));
const scoreMaximum = Math.max(...METHODOLOGY.bands.map((band) => band.max));

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const reasonCodeSchema = z.strictObject({
  code: z.enum(reasonCodeKeys),
  direction: z.enum(["hurts", "helps"]),
  text: z.string().min(1),
  events: z.array(z.string().min(1)).min(1),
  eval_ids: z.array(z.string().min(1)),
});

const fraudCodeSchema = z.enum([
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
]);
const sourceEventIdsSchema = z
  .array(
    z
      .ulid()
      .refine((value) => value === value.toUpperCase(), "Canonical event ID"),
  )
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
const fraudEvidenceSchema = z.strictObject({
  code: fraudCodeSchema,
  text: z.string().min(1),
  source_event_ids: sourceEventIdsSchema,
});

const inputSchemas = {
  2: z.strictObject({
    category: z.string(),
    capabilities: z.array(z.string()),
  }),
  3: z.strictObject({
    critiques: z.array(
      z.strictObject({
        critique_id: z.string(),
        criterion: z.string(),
        critique: z.string(),
      }),
    ),
  }),
  4: z.strictObject({
    afc_id: z.string(),
    score: z.number().min(scoreMinimum).max(scoreMaximum).nullable(),
    factors: z.strictObject({
      Q: z.number().min(0).max(1),
      P: z.number().min(0).max(1),
      L: z.number().min(0).max(1),
      C: z.number().min(0).max(1),
      I: z.number().min(0).max(1),
      F: z.number().min(0).max(1),
    }),
    reason_codes: z.array(reasonCodeSchema),
    reader: z.enum(["marketplace", "merchant", "agent_owner", "lender"]),
  }),
  5: z.strictObject({
    afc_id: z.string().regex(/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/),
    findings: z.array(fraudEvidenceSchema).min(1).max(7),
  }),
  7: z.strictObject({
    afc_id: z.string(),
    category: z.string(),
    target_quality: z.number().min(0).max(100),
    count: z.number().int().min(3).max(5),
  }),
};

const workSampleSchema = z.strictObject({
  id: z.string().min(1),
  task: z.string().min(1),
  output: z.string().min(1),
});

const outputSchemas = {
  2: z.strictObject({
    criteria: z.array(z.string().min(1).max(2048)).min(1).max(10),
    context: z.string().min(1).max(32768),
  }),
  3: z.strictObject({
    weaknesses: z.array(
      z.strictObject({
        summary: z.string().min(1),
        critique_ids: z.array(z.string().min(1)).min(1),
      }),
    ),
  }),
  4: z.strictObject({
    trust_memo: z.string().min(1),
    reason_codes: z.array(reasonCodeSchema),
  }),
  5: z.strictObject({
    summary: z.string().min(1),
    findings: z
      .array(
        z.strictObject({
          code: fraudCodeSchema,
          source_event_ids: sourceEventIdsSchema,
          typology: z.enum([
            "wash",
            "sybil_ring",
            "bust_out",
            "benign",
            "unclear",
          ]),
          description: z.string().min(1),
        }),
      )
      .min(1)
      .max(7),
  }),
  7: z.strictObject({
    simulated: z.literal(true),
    samples: z.array(workSampleSchema).min(3).max(5),
  }),
};

export type ServInputs = {
  [J in ServJobId]: z.infer<(typeof inputSchemas)[J]>;
};

export type ServOutputs = {
  [J in ServJobId]: z.infer<(typeof outputSchemas)[J]>;
};

type ModelEnvironment =
  | "AFC_MODEL_RUBRIC"
  | "AFC_MODEL_SUMMARY"
  | "AFC_MODEL_EXPLAIN"
  | "AFC_MODEL_FRAUD";

type JobDefinition<J extends ServJobId> = {
  name: string;
  inputSchema: (typeof inputSchemas)[J];
  outputSchema: (typeof outputSchemas)[J];
  systemPrompt: string;
  modelEnv: ModelEnvironment;
  shadowHint?: string;
  fixtureFile: string;
};

type ServJobRegistry = {
  [J in ServJobId]: JobDefinition<J>;
};

export const SERV_JOBS: ServJobRegistry = {
  2: {
    name: "rubric",
    inputSchema: inputSchemas[2],
    outputSchema: outputSchemas[2],
    systemPrompt:
      "Create a concise Reppo evaluation rubric for the supplied category and capabilities. Return checkable criteria and context grounded in the input. Do not add criteria unrelated to the declared work.",
    modelEnv: "AFC_MODEL_RUBRIC",
    fixtureFile: "rubric.json",
  },
  3: {
    name: "critique_summary",
    inputSchema: inputSchemas[3],
    outputSchema: outputSchemas[3],
    systemPrompt:
      "Group the supplied Reppo critiques into recurring weaknesses. Cite only critique IDs present in the input and do not invent evidence.",
    modelEnv: "AFC_MODEL_SUMMARY",
    shadowHint: "Each weakness must quote a critique ID.",
    fixtureFile: "critique-summary.json",
  },
  4: {
    name: "explanation",
    inputSchema: inputSchemas[4],
    outputSchema: outputSchemas[4],
    systemPrompt:
      "Explain the supplied reason codes for the requested reader and write a concise trust memo. Preserve every code and its event and evaluation citations exactly. State no number that is not in the input, and do not output a score.",
    modelEnv: "AFC_MODEL_EXPLAIN",
    shadowHint:
      "Cite at least one event_id per code; state no number that is not in the input.",
    fixtureFile: "explanation.json",
  },
  5: {
    name: "fraud_review",
    inputSchema: inputSchemas[5],
    outputSchema: outputSchemas[5],
    systemPrompt:
      "Describe only the supplied detector findings. Choose a typology only when supported by the supplied reason code and source event IDs; otherwise use unclear. Return every finding in order with its code and source_event_ids copied exactly. Do not invent events, evidence, flags, recommendations, or scores. This review is descriptive and must not affect the deterministic score.",
    modelEnv: "AFC_MODEL_FRAUD",
    shadowHint:
      "Check that every finding keeps the exact input code and source_event_ids; do not add evidence or a flag.",
    fixtureFile: "fraud-review.json",
  },
  7: {
    name: "simulated_work",
    inputSchema: inputSchemas[7],
    outputSchema: outputSchemas[7],
    systemPrompt:
      "Create the requested number of synthetic work samples for the supplied category and target quality. Label the samples as simulated and do not present them as completed real-world actions or evaluation results.",
    modelEnv: "AFC_MODEL_SUMMARY",
    fixtureFile: "simulated-work.json",
  },
} satisfies ServJobRegistry;

const fixtureTemplateSchemas = {
  2: outputSchemas[2],
  3: z.strictObject({
    weaknesses: z.array(z.strictObject({ summary: z.string().min(1) })),
  }),
  4: z.strictObject({
    trust_memo: z.string().min(1),
    reason_texts: z.array(z.string().min(1)).min(1),
  }),
  5: z.strictObject({
    summary: z.string().min(1),
    findings: z
      .array(
        z.strictObject({
          code: fraudCodeSchema,
          typology: z.enum([
            "wash",
            "sybil_ring",
            "bust_out",
            "benign",
            "unclear",
          ]),
          description: z.string().min(1),
        }),
      )
      .min(1)
      .max(7),
  }),
  7: z.strictObject({
    samples: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          task: z.string().min(1),
          output: z.string().min(1),
        }),
      )
      .min(3)
      .max(5),
  }),
};

function interpolate(
  value: string,
  replacements: Record<string, string>,
): string {
  let result = value;
  for (const [key, replacement] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, replacement);
  }
  return result;
}

function requireNonblank(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`);
}

function requireUniqueSampleIds(samples: { id: string }[]): void {
  const ids = new Set<string>();
  for (const sample of samples) {
    requireNonblank(sample.id, "Sample ID");
    if (ids.has(sample.id)) throw new Error("Sample IDs must be unique");
    ids.add(sample.id);
  }
}

export function validateJobOutput<J extends ServJobId>(
  job: J,
  input: ServInputs[J],
  output: unknown,
): ServOutputs[J] {
  const parsedInput = SERV_JOBS[job].inputSchema.parse(input);
  const parsedOutput = SERV_JOBS[job].outputSchema.parse(output);

  if (job === 2) {
    const rubric = parsedOutput as ServOutputs[2];
    for (const criterion of rubric.criteria) {
      requireNonblank(criterion, "Rubric criterion");
      if (utf8Length(criterion) > 2048) {
        throw new Error("Rubric criteria must be at most 2048 UTF-8 bytes");
      }
    }
    requireNonblank(rubric.context, "Rubric context");
    if (utf8Length(rubric.context) > 32768) {
      throw new Error("Rubric context must be at most 32768 UTF-8 bytes");
    }
  }

  if (job === 3) {
    const knownIds = new Set(
      (parsedInput as ServInputs[3]).critiques.map(
        (critique) => critique.critique_id,
      ),
    );
    const summary = parsedOutput as ServOutputs[3];
    for (const weakness of summary.weaknesses) {
      requireNonblank(weakness.summary, "Critique summary");
      for (const critiqueId of weakness.critique_ids) {
        if (!knownIds.has(critiqueId)) {
          throw new Error(`Unknown critique ID: ${critiqueId}`);
        }
      }
    }
  }

  if (job === 4) {
    const explanationInput = parsedInput as ServInputs[4];
    const explanation = parsedOutput as ServOutputs[4];
    requireNonblank(explanation.trust_memo, "Trust memo");
    if (
      explanation.reason_codes.length !== explanationInput.reason_codes.length
    ) {
      throw new Error(
        "Explanation must return one response per supplied reason code",
      );
    }
    for (const [index, reason] of explanation.reason_codes.entries()) {
      const source = explanationInput.reason_codes[index];
      if (
        !source ||
        reason.code !== source.code ||
        reason.direction !== source.direction ||
        JSON.stringify(reason.events) !== JSON.stringify(source.events) ||
        JSON.stringify(reason.eval_ids) !== JSON.stringify(source.eval_ids)
      ) {
        throw new Error(
          "Explanation reason identity or citations do not match the input",
        );
      }
      requireNonblank(reason.text, "Reason explanation");
    }
  }

  if (job === 5) {
    const fraudInput = parsedInput as ServInputs[5];
    const fraudOutput = parsedOutput as ServOutputs[5];
    const inputCodes = fraudInput.findings.map((finding) => finding.code);
    if (new Set(inputCodes).size !== inputCodes.length) {
      throw new Error("Fraud findings must use unique reason codes");
    }
    if (fraudOutput.findings.length !== fraudInput.findings.length) {
      throw new Error("Fraud review must return every supplied finding");
    }
    for (const [index, finding] of fraudOutput.findings.entries()) {
      const source = fraudInput.findings[index];
      if (
        !source ||
        finding.code !== source.code ||
        JSON.stringify(finding.source_event_ids) !==
          JSON.stringify(source.source_event_ids)
      ) {
        throw new Error(
          "Fraud review reason code or source event IDs do not match the input",
        );
      }
      requireNonblank(finding.description, "Fraud review description");
    }
    requireNonblank(fraudOutput.summary, "Fraud review summary");
  }

  if (job === 7) {
    const workInput = parsedInput as ServInputs[7];
    const workOutput = parsedOutput as ServOutputs[7];
    if (workOutput.samples.length !== workInput.count) {
      throw new Error("Simulated work sample count must match the input count");
    }
    requireUniqueSampleIds(workOutput.samples);
    for (const sample of workOutput.samples) {
      requireNonblank(sample.task, "Sample task");
      requireNonblank(sample.output, "Sample output");
    }
    if (utf8Length(JSON.stringify(workOutput.samples)) >= 40_000) {
      throw new Error("Sample JSON must be less than 40000 UTF-8 bytes");
    }
  }

  return parsedOutput as ServOutputs[J];
}

export function materializeFixture<J extends ServJobId>(
  job: J,
  input: ServInputs[J],
  raw: unknown,
): ServOutputs[J] {
  const parsedInput = SERV_JOBS[job].inputSchema.parse(input);
  let output: unknown;

  if (job === 2) {
    const template = fixtureTemplateSchemas[2].parse(raw);
    const rubricInput = parsedInput as ServInputs[2];
    const replacements = {
      category: rubricInput.category,
      capabilities: rubricInput.capabilities.join(", "),
    };
    output = {
      criteria: template.criteria.map((criterion) =>
        interpolate(criterion, replacements),
      ),
      context: interpolate(template.context, replacements),
    };
  } else if (job === 3) {
    const template = fixtureTemplateSchemas[3].parse(raw);
    const critiqueInput = parsedInput as ServInputs[3];
    output = {
      weaknesses:
        critiqueInput.critiques.length === 0 || template.weaknesses.length === 0
          ? []
          : [
              {
                summary: template.weaknesses[0]?.summary ?? "",
                critique_ids: critiqueInput.critiques.map(
                  (critique) => critique.critique_id,
                ),
              },
            ],
    };
  } else if (job === 4) {
    const template = fixtureTemplateSchemas[4].parse(raw);
    const explanationInput = parsedInput as ServInputs[4];
    output = {
      trust_memo: interpolate(template.trust_memo, {
        reader: explanationInput.reader,
      }),
      reason_codes: explanationInput.reason_codes.map((reason, index) => ({
        ...reason,
        text: template.reason_texts[index] ?? reason.text,
      })),
    };
  } else if (job === 5) {
    const template = fixtureTemplateSchemas[5].parse(raw);
    const fraudInput = parsedInput as ServInputs[5];
    output = {
      summary: template.summary,
      findings: fraudInput.findings.map((finding) => {
        const match = template.findings.find(
          (item) => item.code === finding.code,
        );
        if (!match) {
          throw new Error(
            `Fraud review fixture is missing template for ${finding.code}`,
          );
        }
        return {
          code: finding.code,
          source_event_ids: [...finding.source_event_ids],
          typology: match.typology,
          description: match.description,
        };
      }),
    };
  } else {
    const template = fixtureTemplateSchemas[7].parse(raw);
    const workInput = parsedInput as ServInputs[7];
    requireUniqueSampleIds(template.samples);
    if (template.samples.length < workInput.count) {
      throw new Error(
        "Simulated-work fixture has fewer samples than requested",
      );
    }
    output = {
      simulated: true,
      samples: Array.from({ length: workInput.count }, (_, index) => {
        const sample = template.samples[index];
        if (!sample)
          throw new Error("Simulated-work fixture sample is missing");
        const replacements = {
          afc_id: workInput.afc_id,
          category: workInput.category,
          target_quality: String(workInput.target_quality),
        };
        return {
          id: `${workInput.afc_id}:${sample.id}`,
          task: interpolate(sample.task, replacements),
          output: interpolate(sample.output, replacements),
        };
      }),
    };
  }

  return validateJobOutput(job, input, output);
}
