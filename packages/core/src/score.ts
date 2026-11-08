import { z } from "zod";
import type { BehaviorEvent } from "./events";
import { extractFeatures } from "./features";
import { buildReasonCodes, type ReasonCode } from "./reasons";
import {
  DAY_MS,
  FACTOR_WEIGHTS,
  type Factor,
  FILE_THRESHOLDS,
  FRAUD_CAP,
  MANIPULATION_PENALTY,
  MODEL_VERSION,
  SCORE_BANDS,
  SCORE_RANGE,
} from "./weights";

type Confidence = "low" | "medium" | "high";
type Band = (typeof SCORE_BANDS)[number]["band"];
type ScoreStatus = "active" | "under_review" | "insufficient_history";

const asOfSchema = z.iso.datetime();

export interface AgentScore {
  afc_id: string;
  score: number | null;
  band: Band | null;
  confidence: Confidence;
  status: ScoreStatus;
  model_version: typeof MODEL_VERSION;
  as_of: string;
  simulated_share: number;
  factors: Record<Factor, number>;
  reason_codes: ReasonCode[];
}

export function scoreAgent(
  input: readonly BehaviorEvent[],
  afcId: string,
  asOf: string,
): AgentScore {
  const asOfMs = Date.parse(asOfSchema.parse(asOf));

  const seen = new Set<string>();
  const history = input
    .filter(
      (event) =>
        event.subject.afc_id === afcId &&
        Date.parse(event.occurred_at) <= asOfMs,
    )
    .sort((left, right) => {
      const timeOrder =
        Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
      if (timeOrder) return timeOrder;
      return left.event_id < right.event_id
        ? -1
        : Number(left.event_id > right.event_id);
    })
    .filter((event) => {
      if (seen.has(event.event_id)) return false;
      seen.add(event.event_id);
      return true;
    });

  // Supplemental adverse evidence cannot establish age or lift a thin-file cap.
  const eligibleHistory = history.filter(
    (event) =>
      event.type !== "payment.limit_violation" &&
      event.type !== "anomaly.flagged",
  );
  const earliest = eligibleHistory[0];
  const ageDays = earliest
    ? (asOfMs - Date.parse(earliest.occurred_at)) / DAY_MS
    : 0;
  const features = extractFeatures(history, asOfMs, ageDays);
  const { verdictCount } = features.metrics;
  const { medium, high, insufficient } = FILE_THRESHOLDS;

  const isInsufficient = history.length < insufficient;
  const isThin =
    verdictCount < medium.verdicts ||
    eligibleHistory.length < medium.events ||
    ageDays < medium.days;
  const confidence: Confidence = isThin
    ? "low"
    : verdictCount >= high.verdicts &&
        eligibleHistory.length >= high.events &&
        ageDays >= high.days
      ? "high"
      : "medium";

  const underReview = features.evidence.anomalies.some(
    (event) =>
      FRAUD_CAP.codes.some((code) => event.attrs?.reason_code === code) &&
      event.attrs?.severity === FRAUD_CAP.severity,
  );

  const status = isInsufficient
    ? "insufficient_history"
    : underReview
      ? "under_review"
      : "active";
  let score: number | null = null;

  if (!isInsufficient) {
    const raw =
      (Object.keys(FACTOR_WEIGHTS) as Factor[]).reduce(
        (sum, factor) =>
          sum + FACTOR_WEIGHTS[factor] * features.factors[factor],
        0,
      ) / 100;
    const recentManipulations = features.evidence.manipulation.filter(
      (event) =>
        asOfMs - Date.parse(event.occurred_at) <=
        MANIPULATION_PENALTY.days * DAY_MS,
    );
    const penalty = Math.min(
      MANIPULATION_PENALTY.max,
      recentManipulations.length * MANIPULATION_PENALTY.points,
    );
    const base = Math.round(
      SCORE_RANGE.min + (SCORE_RANGE.max - SCORE_RANGE.min) * raw,
    );
    score = Math.max(
      SCORE_RANGE.min,
      Math.min(
        SCORE_RANGE.max,
        base - penalty,
        isThin ? medium.cap : SCORE_RANGE.max,
        underReview ? FRAUD_CAP.score : SCORE_RANGE.max,
      ),
    );
  }

  return {
    afc_id: afcId,
    score,
    band:
      score === null
        ? null
        : (SCORE_BANDS.find(({ min, max }) => score >= min && score <= max)
            ?.band ?? null),
    confidence,
    status,
    model_version: MODEL_VERSION,
    as_of: new Date(asOfMs).toISOString(),
    simulated_share: features.simulatedShare,
    factors: features.factors,
    reason_codes: buildReasonCodes(features, ageDays, asOfMs, history),
  };
}
