import { z } from "zod";
import { BehaviorEventSchema } from "./events";
import { METHODOLOGY } from "./methodology";
import type { AgentScore } from "./score";

const reasonCodeKeys = METHODOLOGY.reason_codes.map(({ key }) => key) as [
  (typeof METHODOLOGY.reason_codes)[number]["key"],
  ...(typeof METHODOLOGY.reason_codes)[number]["key"][],
];

export const ReasonCodeResponseSchema = z.strictObject({
  code: z.enum(reasonCodeKeys),
  direction: z.enum(["hurts", "helps"]),
  text: z.string().min(1),
  events: z.array(z.string().min(1)),
  eval_ids: z.array(z.string().min(1)),
});

export const AgentScoreSchema = z.strictObject({
  afc_id: z.string().regex(/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/),
  score: z.number().int().min(300).max(850).nullable(),
  band: z.enum(["Exceptional", "Very good", "Good", "Fair", "Poor"]).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  status: z.enum(["active", "under_review", "insufficient_history"]),
  model_version: z.literal(METHODOLOGY.model_version),
  as_of: z.iso.datetime(),
  simulated_share: z.number().min(0).max(1),
  factors: z.strictObject({
    Q: z.number().min(0).max(1),
    P: z.number().min(0).max(1),
    L: z.number().min(0).max(1),
    C: z.number().min(0).max(1),
    I: z.number().min(0).max(1),
    F: z.number().min(0).max(1),
  }),
  reason_codes: z.array(ReasonCodeResponseSchema),
});
export type AgentScoreResponse = z.infer<typeof AgentScoreSchema>;

export const HealthResponseSchema = z.strictObject({
  ok: z.literal(true),
  simulated_share: z.literal(0),
});

export const AgentSummarySchema = z.strictObject({
  ...AgentScoreSchema.shape,
  last_event_at: z.iso.datetime().nullable(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const ReppoPublicResultSchema = z.strictObject({
  score: z.number().min(0).max(100).optional(),
  decision: z.enum(["accept", "revise", "reject"]).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  route: z.enum(["auto-ship", "review", "block"]).optional(),
  reason: z.string().max(4096).optional(),
  rubric_scores: z
    .record(z.string().min(1), z.number().min(0).max(100))
    .optional(),
  verdict: z
    .strictObject({
      score: z.number().min(0).max(100).optional(),
      decision: z.enum(["accept", "revise", "reject"]).optional(),
      confidence: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  verdicts: z
    .array(
      z.strictObject({
        criterion: z.string().max(2048).optional(),
        score: z.number().min(0).max(10).optional(),
        critique: z.string().max(4096).optional(),
      }),
    )
    .optional(),
  action: z
    .strictObject({
      route: z.enum(["auto-ship", "review", "block"]),
    })
    .optional(),
});

export const VerdictRecordSchema = z.strictObject({
  eval_id: z.string().min(1),
  status: z.string().min(1),
  score: z.number().min(0).max(100).nullable(),
  decision: z.string().nullable(),
  confidence: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  result: ReppoPublicResultSchema.nullable(),
});

export const CritiqueSummarySchema = z.strictObject({
  weaknesses: z.array(
    z.strictObject({
      summary: z.string().min(1),
      critique_ids: z.array(z.string().min(1)).min(1),
    }),
  ),
});
export type CritiqueSummary = z.infer<typeof CritiqueSummarySchema>;

const FraudCodeSchema = z.enum([
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
]);
const SourceEventIdsSchema = z
  .array(
    z
      .ulid()
      .refine((value) => value === value.toUpperCase(), "Canonical event ID"),
  )
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);

export const FraudReviewSchema = z.strictObject({
  summary: z.string().min(1),
  findings: z
    .array(
      z.strictObject({
        code: FraudCodeSchema,
        text: z.string().min(1),
        source_event_ids: SourceEventIdsSchema,
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
  serv_call_id: z.string().min(1),
  offline: z.boolean(),
});
export type FraudReview = z.infer<typeof FraudReviewSchema>;

export const AgentReportSchema = z.strictObject({
  score: AgentScoreSchema,
  history: z.strictObject({
    first_event_at: z.iso.datetime().nullable(),
    last_event_at: z.iso.datetime().nullable(),
  }),
  events: z.array(BehaviorEventSchema).max(50),
  verdicts: z.array(VerdictRecordSchema),
  trust_memo: z.string().min(1).nullable(),
  critique_summary: CritiqueSummarySchema.nullable(),
  fraud_review: FraudReviewSchema.nullable(),
  fraud_transition: z
    .strictObject({
      score_before: z.number().int().min(300).max(850),
      before_as_of: z.iso.datetime(),
      detector_at: z.iso.datetime(),
    })
    .nullable(),
  serv_call_ids: z.array(z.string().min(1)),
  simulated_share: z.number().min(0).max(1),
});

export const AgentsResponseSchema = z.strictObject({
  agents: z.array(AgentSummarySchema),
  as_of: z.iso.datetime(),
  simulated_share: z.number().min(0).max(1),
});

const FactorWeightsSchema = z
  .strictObject({
    Q: z.number().nonnegative(),
    P: z.number().nonnegative(),
    L: z.number().nonnegative(),
    C: z.number().nonnegative(),
    I: z.number().nonnegative(),
    F: z.number().nonnegative(),
  })
  .refine(
    (weights) =>
      Object.values(weights).reduce((sum, value) => sum + value, 0) === 100,
  );

const FactorStringsSchema = z.strictObject({
  Q: z.string().min(1),
  P: z.string().min(1),
  L: z.string().min(1),
  C: z.string().min(1),
  I: z.string().min(1),
  F: z.string().min(1),
});

export const MethodologySchema = z.strictObject({
  model_version: z.string().min(1),
  simulated_share: z.number().min(0).max(1),
  weights: FactorWeightsSchema,
  formulas: z.strictObject({
    decay: z.string().min(1),
    event_weight: z.string().min(1),
    score: z.string().min(1),
    factors: FactorStringsSchema,
  }),
  half_life_days: z.strictObject({
    positive: z.number().positive(),
    adverse: z.number().positive(),
    fraud: z.number().positive(),
    verdict: z.number().positive(),
  }),
  attestation_weights: z.strictObject({
    self_reported: z.number().min(0).max(1),
    platform_signed: z.number().min(0).max(1),
    onchain: z.number().min(0).max(1),
  }),
  verdict_confidence_weights: z.strictObject({
    high: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    low: z.number().min(0).max(1),
  }),
  feature_conventions: z.strictObject({
    missingObservation: z.number().min(0).max(1),
    spendWindowDays: z.number().positive(),
    driftRecentDays: z.number().positive(),
    driftWindowDays: z.number().positive(),
    maxMeasuredAmount: z.number().positive(),
  }),
  anomaly_severities: z.strictObject({
    low: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    confirmed: z.number().min(0).max(1),
  }),
  history_conventions: z.strictObject({
    eligibility: z.string().min(1),
    minimum_history: z.string().min(1),
    age: z.string().min(1),
    unknown_signals: z.string().min(1),
  }),
  thresholds: z.strictObject({
    insufficient: z.number().int().positive(),
    medium: z.strictObject({
      verdicts: z.number().int().positive(),
      events: z.number().int().positive(),
      days: z.number().positive(),
      cap: z.number().int().min(300).max(850),
    }),
    high: z.strictObject({
      verdicts: z.number().int().positive(),
      events: z.number().int().positive(),
      days: z.number().positive(),
    }),
  }),
  caps: z.strictObject({
    fraud: z.strictObject({
      codes: z.array(z.enum(["F01", "F02"])).min(1),
      severity: z.number().min(0).max(1),
      score: z.number().int().min(300).max(850),
    }),
  }),
  penalties: z.strictObject({
    manipulation: z.strictObject({
      days: z.number().positive(),
      points: z.number().positive(),
      max: z.number().positive(),
    }),
  }),
  bands: z.array(
    z.strictObject({
      min: z.number().int().min(300).max(850),
      max: z.number().int().min(300).max(850),
      band: z.enum(["Exceptional", "Very good", "Good", "Fair", "Poor"]),
    }),
  ),
  reason_codes: z.array(
    z.strictObject({
      key: z.enum(reasonCodeKeys),
      description: z.string().min(1),
      helps_description: z.string().min(1).optional(),
      trigger: z.string().min(1),
    }),
  ),
});
export const MethodologyResponseSchema = MethodologySchema;

export const EventResponseSchema = z.strictObject({
  event: BehaviorEventSchema,
  simulated_share: z.number().min(0).max(1),
});

export const ServCallSchema = z.strictObject({
  id: z.string().min(1),
  created_at: z.iso.datetime(),
  job: z.number().int().min(1).max(7),
  afc_id: z.string().nullable(),
  model: z.string().min(1),
  features: z.array(z.string()),
  tools: z.array(z.unknown()),
  response_id: z.string().nullable(),
  status: z.string().min(1),
  offline: z.boolean(),
  latency_ms: z.number().int().min(0).nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  cost: z.record(z.string(), z.unknown()).nullable(),
});

export const ServLogResponseSchema = z.strictObject({
  calls: z.array(ServCallSchema),
  simulated_share: z.number().min(0).max(1),
});

export const ScoreLogResponseSchema = z.strictObject({
  score: AgentScoreSchema,
  saved: z.boolean(),
  simulated_share: z.number().min(0).max(1),
});

export const KiteScoreRequestSchema = z.strictObject({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  as_of: z.iso.datetime().optional(),
});

export const KiteScoreResponseSchema = z.strictObject({
  score: AgentScoreSchema,
  events: z.array(BehaviorEventSchema),
  complete: z.boolean(),
  pages: z.number().int().min(0),
  offline: z.boolean(),
  outcome: z.enum(["COMPLETE", "PARTIAL_COVERAGE", "OFFLINE_FIXTURE"]),
  simulated_share: z.number().min(0).max(1),
});

export const WorkSampleSchema = z.strictObject({
  id: z.string().trim().min(1).max(512),
  task: z.string().min(1).max(16_384),
  output: z.string().min(1).max(32_768),
});

export const EvaluateRequestSchema = z
  .strictObject({
    afc_id: z.string().regex(/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/),
    samples: z.array(WorkSampleSchema).min(3).max(5),
    criteria: z.array(z.string().min(1).max(2048)).max(10),
    context: z.string().max(32_768).optional(),
    simulated: z.boolean().default(false),
    category: z.string().trim().min(1).max(128).optional(),
  })
  .refine(
    ({ samples }) =>
      new Set(samples.map(({ id }) => id)).size === samples.length,
    { message: "Sample IDs must be unique", path: ["samples"] },
  );
export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export const EvaluateReceiptSchema = z.strictObject({
  queue_id: z.number().int().positive(),
  afc_id: z.string().min(1),
  status: z.literal("queued"),
  eval_id: z.null(),
  offline: z.boolean(),
  simulated_share: z.number().min(0).max(1),
});

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  simulated_share: z.number().min(0).max(1),
});

export function validateAgentScore(score: AgentScore): AgentScoreResponse {
  return AgentScoreSchema.parse(score);
}
