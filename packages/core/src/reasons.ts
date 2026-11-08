import type { BehaviorEvent } from "./events";
import type { extractFeatures } from "./features";
import {
  DAY_MS,
  FACTOR_PARAMETERS,
  FACTOR_WEIGHTS,
  type Factor,
  FEATURE_CONVENTIONS,
  FILE_THRESHOLDS,
  FRAUD_CAP,
  MANIPULATION_PENALTY,
  SCORE_RANGE,
} from "./weights";

const SCORE_POINTS_PER_WEIGHT_POINT = (SCORE_RANGE.max - SCORE_RANGE.min) / 100;

export const REASON_CODES = [
  {
    key: "Q01",
    description: "Sampled work quality is low.",
    helps_description: "Sampled work quality is high.",
    trigger:
      "Hurts when Q < 0.6; helps when Q >= 0.8 and observed work evaluations support the signal.",
  },
  {
    key: "Q02",
    description:
      "A high share of sampled work was rejected or sent for revision.",
    trigger: "Hurts when reject plus revise rate > 30%.",
  },
  {
    key: "Q03",
    description: "Too few work samples have been evaluated.",
    trigger: "Hurts when fewer than 3 Reppo verdicts are available.",
  },
  {
    key: "Q04",
    description: "Reppo reported an attempt to manipulate its judge.",
    trigger: `Hurts for each manipulation downgrade in the last ${MANIPULATION_PENALTY.days} days; the penalty is capped at ${MANIPULATION_PENALTY.max} points.`,
  },
  {
    key: "P01",
    description: "Spending-limit violations were observed.",
    trigger:
      "Hurts when a Kite session spending-limit error occurred in the last 90 days.",
  },
  {
    key: "P02",
    description: "A high share of payments failed.",
    trigger: "Hurts when failed-payment rate > 5%.",
  },
  {
    key: "P03",
    description: "Refunds or disputes were observed at an elevated rate.",
    trigger: "Hurts when dispute and refund rate > 2%.",
  },
  {
    key: "P04",
    description: "Observed payments show low counterparty diversity.",
    helps_description:
      "Observed payment activity spans diverse counterparties.",
    trigger:
      "Hurts when normalized counterparty entropy < 0.3; helps when it is >= 0.7 and observed payments show counterparties.",
  },
  {
    key: "L01",
    description: "The endpoint was often unreachable or slow.",
    trigger: "Hurts when uptime < 95% or median latency > 3 seconds.",
  },
  {
    key: "L02",
    description: "Tasks were often incomplete or reversed by users.",
    trigger: "Hurts when task completion rate < 85%.",
  },
  {
    key: "C01",
    description: "Daily spending shows erratic spikes.",
    trigger: "Hurts when daily-spend coefficient of variation > 1.2.",
  },
  {
    key: "C02",
    description: "Work quality varies substantially.",
    trigger: "Hurts when work-quality standard deviation > 15.",
  },
  {
    key: "C03",
    description: "Recent behavior differs sharply from the agent's baseline.",
    trigger: "Hurts when behavior drift score > 0.5.",
  },
  {
    key: "I01",
    description: "The agent has a short history.",
    trigger: "Hurts when observed history is less than 30 days old.",
  },
  {
    key: "I02",
    description: "Funding is concentrated in a small number of sources.",
    trigger: "Hurts when funding-source diversity < 0.3.",
  },
  {
    key: "I03",
    description: "No verified owner link was observed.",
    trigger: "Hurts when owner-linked is false.",
  },
  {
    key: "F01",
    description: "A circular or wash-payment signal was detected.",
    trigger: "Hurts when normalized anomaly evidence includes F01.",
  },
  {
    key: "F02",
    description: "The agent is linked to a sybil cluster or flagged wallet.",
    trigger: "Hurts when normalized anomaly evidence includes F02.",
  },
  {
    key: "F03",
    description: "An attested log chain has a gap or invalid signature.",
    trigger: "Hurts when normalized anomaly evidence includes F03.",
  },
] as const;

export type ReasonCodeKey = (typeof REASON_CODES)[number]["key"];
export type ReasonCode = {
  code: ReasonCodeKey;
  direction: "hurts" | "helps";
  text: string;
  events: string[];
  eval_ids: string[];
};

type Features = ReturnType<typeof extractFeatures>;
type Candidate = ReasonCode & { impact: number };

const REASON_CODE_BY_KEY = Object.fromEntries(
  REASON_CODES.map((reason) => [reason.key, reason]),
) as Record<ReasonCodeKey, (typeof REASON_CODES)[number]>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function factorImpact(factor: Factor, subscoreDelta: number): number {
  return (
    FACTOR_WEIGHTS[factor] *
    SCORE_POINTS_PER_WEIGHT_POINT *
    clamp01(subscoreDelta)
  );
}

function observedEvents(
  events: readonly BehaviorEvent[],
  asOfMs: number,
): BehaviorEvent[] {
  const unique = new Map<string, BehaviorEvent>();
  for (const event of events) {
    const occurredAt = Date.parse(event.occurred_at);
    if (event.event_id && Number.isFinite(occurredAt) && occurredAt <= asOfMs) {
      unique.set(event.event_id, event);
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
      compareText(left.event_id, right.event_id),
  );
}

function evalIds(events: readonly BehaviorEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const id = event.evidence?.eval_id;
    if (
      event.source === "reppo" &&
      event.type === "work.evaluated" &&
      typeof id === "string" &&
      id.trim().length > 0
    ) {
      ids.add(id);
    }
  }
  return [...ids].sort(compareText);
}

export function buildReasonCodes(
  features: ReturnType<typeof extractFeatures>,
  ageDays: number,
  asOfMs: number,
  history: readonly BehaviorEvent[],
): ReasonCode[] {
  // Feature evidence is already validated by extraction; raw history is only
  // context for missing-sample, missing-owner and observed-age reasons.
  const evidence = { ...features.evidence };
  for (const group of Object.keys(evidence) as (keyof Features["evidence"])[]) {
    evidence[group] = observedEvents(evidence[group], asOfMs);
  }
  const observed = observedEvents(history, asOfMs);
  const context = observed.filter(
    (event) =>
      event.type !== "anomaly.flagged" &&
      event.type !== "payment.limit_violation" &&
      event.type !== "work.evaluated",
  );
  const { factors, metrics } = features;
  const { Q, P, L, C, I } = FACTOR_PARAMETERS;
  const candidates: Candidate[] = [];
  const add = (
    code: ReasonCodeKey,
    triggered: boolean,
    impact: number,
    events: readonly BehaviorEvent[],
    direction: ReasonCode["direction"] = "hurts",
  ) => {
    if (!triggered || events.length === 0) return;
    const metadata = REASON_CODE_BY_KEY[code];
    const text =
      direction === "helps" && "helps_description" in metadata
        ? metadata.helps_description
        : metadata.description;
    candidates.push({
      code,
      direction,
      text,
      impact,
      events: [...new Set(events.map((event) => event.event_id))].sort(
        compareText,
      ),
      eval_ids: evalIds(events),
    });
  };

  const quality = evidence.quality.filter((event) => {
    const value = event.attrs?.reppo_score;
    return (
      event.type === "work.evaluated" &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
    );
  });
  const payments = evidence.payments;
  const counterparties = payments.filter((event) =>
    Boolean(event.counterparty?.id?.trim()),
  );
  const counterpartyCount = new Set(
    counterparties.map((event) => event.counterparty?.id),
  ).size;
  const manipulation = evidence.manipulation.filter(
    (event) =>
      event.source === "reppo" &&
      event.type === "work.evaluated" &&
      Date.parse(event.occurred_at) >=
        asOfMs - MANIPULATION_PENALTY.days * DAY_MS,
  );
  const manipulationPenalty = Math.min(
    MANIPULATION_PENALTY.max,
    manipulation.length * MANIPULATION_PENALTY.points,
  );

  add("Q01", factors.Q < 0.6, factorImpact("Q", 1 - factors.Q), quality);
  add("Q01", factors.Q >= 0.8, factorImpact("Q", factors.Q), quality, "helps");
  const rejectRate = metrics.rejectReviseRate;
  add(
    "Q02",
    rejectRate !== null && rejectRate > 0.3,
    factorImpact("Q", Q.rejectPenalty * (rejectRate ?? 0)),
    quality,
  );

  const sampleContext = context.filter(
    (event) => event.type === "work.probe_sent",
  );
  const sampleEvidence =
    quality.length > 0
      ? quality
      : sampleContext.length > 0
        ? sampleContext
        : context.slice(-3);
  const baseScore =
    Math.round(
      SCORE_RANGE.min +
        (Object.keys(FACTOR_WEIGHTS) as Factor[]).reduce(
          (sum, factor) => sum + factorImpact(factor, factors[factor]),
          0,
        ),
    ) - manipulationPenalty;
  const confirmedFraud = evidence.anomalies.some(
    (event) =>
      FRAUD_CAP.codes.some((code) => event.attrs?.reason_code === code) &&
      event.attrs?.severity === FRAUD_CAP.severity,
  );
  const beforeThinCap = Math.min(
    baseScore,
    confirmedFraud ? FRAUD_CAP.score : SCORE_RANGE.max,
  );
  add(
    "Q03",
    metrics.verdictCount < FILE_THRESHOLDS.medium.verdicts,
    Math.max(0, beforeThinCap - FILE_THRESHOLDS.medium.cap),
    sampleEvidence,
  );
  add("Q04", manipulation.length > 0, manipulationPenalty, manipulation);

  const violations = evidence.violations.filter(
    (event) => Date.parse(event.occurred_at) >= asOfMs - 90 * DAY_MS,
  );
  const violationsPer100 =
    (violations.length / Math.max(1, payments.length)) * 100;
  add(
    "P01",
    violations.length > 0,
    factorImpact(
      "P",
      P.violations * clamp01(violationsPer100 / P.violationsPer100),
    ),
    violations,
  );
  const failRate = metrics.failRate;
  add(
    "P02",
    failRate !== null && failRate > 0.05,
    factorImpact("P", P.failure * (failRate ?? 0)),
    evidence.failures,
  );
  const disputeRate = metrics.disputeRefundRate;
  add(
    "P03",
    disputeRate !== null && disputeRate > 0.02,
    factorImpact(
      "P",
      P.disputes * clamp01(P.disputeMultiplier * (disputeRate ?? 0)),
    ),
    evidence.disputes,
  );
  const entropy = metrics.counterpartyEntropy;
  add(
    "P04",
    entropy !== null && entropy < 0.3,
    factorImpact("P", P.diversity * (1 - (entropy ?? 0))),
    counterparties,
  );
  add(
    "P04",
    entropy !== null && entropy >= 0.7 && counterpartyCount >= 2,
    factorImpact("P", P.diversity * (entropy ?? 0)),
    counterparties,
    "helps",
  );

  const { uptime, p50Ms, completionRate } = metrics;
  const uptimeLoss = uptime === null ? 0 : L.uptime * (1 - uptime);
  const latencyLoss =
    p50Ms === null
      ? 0
      : L.latency * clamp01((p50Ms - L.latencyTargetMs) / L.latencyRangeMs);
  add(
    "L01",
    (uptime !== null && uptime < 0.95) || (p50Ms !== null && p50Ms > 3000),
    factorImpact("L", uptimeLoss + latencyLoss),
    evidence.probes,
  );
  add(
    "L02",
    completionRate !== null && completionRate < 0.85,
    factorImpact("L", L.completion * (1 - (completionRate ?? 1))),
    evidence.tasks,
  );

  const { spendCv, qualityStdev, driftScore } = metrics;
  add(
    "C01",
    spendCv !== null && spendCv > 1.2,
    factorImpact("C", C.spend * clamp01((spendCv ?? 0) / C.spendCvLimit)),
    evidence.spend,
  );
  add(
    "C02",
    qualityStdev !== null && qualityStdev > 15,
    factorImpact(
      "C",
      C.quality * clamp01((qualityStdev ?? 0) / C.qualityStdevLimit),
    ),
    quality,
  );
  // Drift currently compares recent quality against the preceding quality baseline.
  const driftStartDay =
    Math.floor(asOfMs / DAY_MS) - FEATURE_CONVENTIONS.driftWindowDays + 1;
  const driftEvidence = quality.filter(
    (event) =>
      Math.floor(Date.parse(event.occurred_at) / DAY_MS) >= driftStartDay,
  );
  add(
    "C03",
    driftScore !== null && driftScore > 0.5,
    factorImpact("C", C.drift * (driftScore ?? 0)),
    driftEvidence,
  );

  const ageEvidence =
    evidence.identity.length > 0
      ? evidence.identity
      : observed
          .filter(
            (event) =>
              event.type !== "anomaly.flagged" &&
              event.type !== "payment.limit_violation",
          )
          .slice(0, 1);
  const ageLoss =
    I.age *
    (1 -
      Math.min(
        1,
        Math.log1p(Math.max(0, ageDays)) / Math.log(I.maxAgeDays + 1),
      ));
  add(
    "I01",
    Number.isFinite(ageDays) && ageDays < 30,
    factorImpact("I", ageLoss),
    ageEvidence,
  );
  const fundingDiversity = metrics.fundingDiversity;
  add(
    "I02",
    fundingDiversity !== null && fundingDiversity < 0.3,
    factorImpact("I", I.funding * (1 - (fundingDiversity ?? 0))),
    evidence.funding,
  );
  const ownerEvidence =
    evidence.identity.length > 0
      ? evidence.identity
      : evidence.owner.length > 0
        ? evidence.owner
        : context.slice(-3);
  add("I03", !metrics.ownerLinked, factorImpact("I", I.owner), ownerEvidence);

  const fraudEvidence: Record<"F01" | "F02" | "F03", BehaviorEvent[]> = {
    F01: [],
    F02: [],
    F03: [],
  };
  for (const event of evidence.anomalies) {
    const code = event.attrs?.reason_code;
    const severity = event.attrs?.severity;
    if (
      (code === "F01" || code === "F02" || code === "F03") &&
      typeof severity === "number" &&
      Number.isFinite(severity) &&
      severity > 0
    ) {
      fraudEvidence[code].push(event);
    }
  }
  for (const code of ["F01", "F02", "F03"] as const) {
    const events = fraudEvidence[code];
    const severity = events.reduce(
      (sum, event) => sum + Number(event.attrs?.severity),
      0,
    );
    add(code, events.length > 0, factorImpact("F", severity), events);
  }

  candidates.sort(
    (left, right) =>
      right.impact - left.impact || compareText(left.code, right.code),
  );
  return [
    ...candidates.filter((item) => item.direction === "hurts").slice(0, 4),
    ...candidates.filter((item) => item.direction === "helps").slice(0, 2),
  ].map(({ impact: _impact, ...reason }) => reason);
}
