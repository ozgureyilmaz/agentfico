import type { BehaviorEvent } from "./events";

export const MODEL_VERSION = "afc-0.2";

export const FACTOR_WEIGHTS = {
  Q: 35,
  P: 20,
  L: 15,
  C: 10,
  I: 10,
  F: 10,
} as const;
export type Factor = keyof typeof FACTOR_WEIGHTS;

export const HALF_LIFE_DAYS = {
  positive: 90,
  adverse: 120,
  fraud: 365,
  verdict: 60,
} as const;

export const ATTESTATION_WEIGHTS = {
  self_reported: 0.5,
  platform_signed: 0.8,
  onchain: 1,
} as const satisfies Record<BehaviorEvent["attestation"], number>;

export const VERDICT_CONFIDENCE_WEIGHTS = {
  high: 1,
  medium: 0.7,
  low: 0.4,
} as const;

export const FACTOR_PARAMETERS = {
  Q: { rejectPenalty: 0.25 },
  P: {
    failure: 0.4,
    violations: 0.3,
    disputes: 0.15,
    diversity: 0.15,
    violationsPer100: 5,
    disputeMultiplier: 5,
  },
  L: {
    uptime: 0.4,
    latency: 0.2,
    completion: 0.4,
    latencyTargetMs: 800,
    latencyRangeMs: 4200,
  },
  C: {
    spend: 0.5,
    quality: 0.3,
    drift: 0.2,
    spendCvLimit: 2,
    qualityStdevLimit: 25,
  },
  I: { age: 0.6, owner: 0.2, funding: 0.2, maxAgeDays: 365 },
} as const;

const { Q, P, L, C, I } = FACTOR_PARAMETERS;

export const FACTOR_FORMULAS = {
  Q: `weighted_mean(reppo_score / 100, event_weight * confidence_weight) - ${Q.rejectPenalty} * reject_rate`,
  P: `${P.failure}*(1-fail_rate) + ${P.violations}*(1-clamp(violations_per_100_payments/${P.violationsPer100})) + ${P.disputes}*(1-clamp(${P.disputeMultiplier}*dispute_refund_rate)) + ${P.diversity}*counterparty_entropy_norm`,
  L: `${L.uptime}*uptime + ${L.latency}*(1-clamp((p50_ms-${L.latencyTargetMs})/${L.latencyRangeMs})) + ${L.completion}*completion_rate`,
  C: `${C.spend}*(1-clamp(cv_daily_spend/${C.spendCvLimit})) + ${C.quality}*(1-clamp(stdev_quality/${C.qualityStdevLimit})) + ${C.drift}*(1-drift_score)`,
  I: `${I.age}*min(1,ln(1+age_days)/ln(${I.maxAgeDays + 1})) + ${I.owner}*owner_linked + ${I.funding}*funding_diversity`,
  F: "1 - clamp(sum(event_weight * anomaly_severity))",
} as const satisfies Record<Factor, string>;

export const SCORE_RANGE = { min: 300, max: 850 } as const;
export const SCORE_BANDS = [
  { min: 800, max: 850, band: "Exceptional" },
  { min: 740, max: 799, band: "Very good" },
  { min: 670, max: 739, band: "Good" },
  { min: 580, max: 669, band: "Fair" },
  { min: 300, max: 579, band: "Poor" },
] as const;

export const FILE_THRESHOLDS = {
  insufficient: 3,
  medium: { verdicts: 3, events: 10, days: 7, cap: 649 },
  high: { verdicts: 10, events: 50, days: 30 },
} as const;

export const MANIPULATION_PENALTY = { days: 60, points: 40, max: 120 } as const;
export const FRAUD_CAP = {
  codes: ["F01", "F02"],
  severity: 1,
  score: 549,
} as const;

export const DAY_MS = 86_400_000;

export const FEATURE_CONVENTIONS = {
  missingObservation: 0.5,
  spendWindowDays: 90,
  driftRecentDays: 14,
  driftWindowDays: 60,
  maxMeasuredAmount: Number.MAX_SAFE_INTEGER,
} as const;

export const ANOMALY_SEVERITIES = {
  low: 0.2,
  medium: 0.5,
  confirmed: 1,
} as const;
