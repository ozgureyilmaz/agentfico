import { REASON_CODES } from "./reasons";
import {
  ANOMALY_SEVERITIES,
  ATTESTATION_WEIGHTS,
  FACTOR_FORMULAS,
  FACTOR_WEIGHTS,
  FEATURE_CONVENTIONS,
  FILE_THRESHOLDS,
  FRAUD_CAP,
  HALF_LIFE_DAYS,
  MANIPULATION_PENALTY,
  MODEL_VERSION,
  SCORE_BANDS,
  SCORE_RANGE,
  VERDICT_CONFIDENCE_WEIGHTS,
} from "./weights";

export const METHODOLOGY = {
  model_version: MODEL_VERSION,
  simulated_share: 0,
  weights: FACTOR_WEIGHTS,
  formulas: {
    decay: "exp(-ln(2) * age_days / half_life_days)",
    event_weight: "decay * attestation_weight",
    score: `clamp(round(${SCORE_RANGE.min} + ${SCORE_RANGE.max - SCORE_RANGE.min} * sum(weight_f * clamp(sub_f)) / 100) - penalties, ${SCORE_RANGE.min}, ${SCORE_RANGE.max})`,
    factors: FACTOR_FORMULAS,
  },
  half_life_days: HALF_LIFE_DAYS,
  attestation_weights: ATTESTATION_WEIGHTS,
  verdict_confidence_weights: VERDICT_CONFIDENCE_WEIGHTS,
  feature_conventions: FEATURE_CONVENTIONS,
  anomaly_severities: ANOMALY_SEVERITIES,
  history_conventions: {
    eligibility:
      "Supplemental payment.limit_violation and anomaly.flagged events cannot establish age or increase the event count used to lift a thin-file cap.",
    minimum_history:
      "At least three distinct events at or before as_of are required for a numeric score.",
    age: "Elapsed days since the first eligible event for the requested subject.",
    unknown_signals:
      "Missing measured signals use the neutral value. An unverified owner link contributes zero.",
  },
  thresholds: FILE_THRESHOLDS,
  caps: { fraud: FRAUD_CAP },
  penalties: { manipulation: MANIPULATION_PENALTY },
  bands: SCORE_BANDS,
  reason_codes: REASON_CODES,
} as const;
