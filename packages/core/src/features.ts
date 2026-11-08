import type { BehaviorEvent } from "./events";
import {
  ANOMALY_SEVERITIES,
  ATTESTATION_WEIGHTS,
  DAY_MS,
  FACTOR_PARAMETERS,
  type Factor,
  FEATURE_CONVENTIONS,
  HALF_LIFE_DAYS,
  VERDICT_CONFIDENCE_WEIGHTS,
} from "./weights";

export interface FeatureMetrics {
  verdictCount: number;
  rejectReviseRate: number | null;
  failRate: number | null;
  disputeRefundRate: number | null;
  counterpartyEntropy: number | null;
  uptime: number | null;
  p50Ms: number | null;
  completionRate: number | null;
  spendCv: number | null;
  qualityStdev: number | null;
  driftScore: number | null;
  fundingDiversity: number | null;
  ownerLinked: boolean;
}

export interface FeatureEvidence {
  quality: BehaviorEvent[];
  payments: BehaviorEvent[];
  failures: BehaviorEvent[];
  disputes: BehaviorEvent[];
  violations: BehaviorEvent[];
  probes: BehaviorEvent[];
  tasks: BehaviorEvent[];
  spend: BehaviorEvent[];
  funding: BehaviorEvent[];
  identity: BehaviorEvent[];
  owner: BehaviorEvent[];
  anomalies: BehaviorEvent[];
  manipulation: BehaviorEvent[];
}

export interface ExtractedFeatures {
  factors: Record<Factor, number>;
  metrics: FeatureMetrics;
  evidence: FeatureEvidence;
  simulatedShare: number;
}

interface WeightedValue {
  value: number;
  weight: number;
}

interface SpendDay {
  total: number;
}

const NEUTRAL = FEATURE_CONVENTIONS.missingObservation;
const VALID_ANOMALY_CODES = new Set(["F01", "F02", "F03"]);
const VALID_ANOMALY_SEVERITIES = new Set<number>(
  Object.values(ANOMALY_SEVERITIES),
);
const VALID_DECISIONS = new Set(["accept", "revise", "reject"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attr(event: BehaviorEvent, key: string): unknown {
  const attrs: unknown = event.attrs;
  if (!isRecord(attrs) || !Object.hasOwn(attrs, key)) {
    return undefined;
  }
  return attrs[key];
}

function finiteAttr(
  event: BehaviorEvent,
  key: string,
  minimum: number,
  maximum: number,
): number | null {
  const value = attr(event, key);
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function halfLifeDays(event: BehaviorEvent): number {
  if (event.type === "anomaly.flagged") {
    return HALF_LIFE_DAYS.fraud;
  }
  if (event.type === "work.evaluated") {
    return HALF_LIFE_DAYS.verdict;
  }
  if (
    event.type === "payment.failed" ||
    event.type === "payment.limit_violation" ||
    event.type === "payment.refund" ||
    event.type === "payment.dispute" ||
    event.type === "task.failed" ||
    event.type === "action.reversed_by_user" ||
    event.type === "action.complaint" ||
    event.outcome === "failure" ||
    event.outcome === "reversed" ||
    event.outcome === "disputed"
  ) {
    return HALF_LIFE_DAYS.adverse;
  }
  return HALF_LIFE_DAYS.positive;
}

function eventWeight(event: BehaviorEvent, asOfMs: number): number {
  const occurredAtMs = Date.parse(event.occurred_at);
  if (!Number.isFinite(occurredAtMs)) {
    return 0;
  }
  const ageDays = Math.max(0, (asOfMs - occurredAtMs) / DAY_MS);
  const halfLife = halfLifeDays(event);
  const decay = Math.exp((-Math.LN2 * ageDays) / halfLife);
  return decay * ATTESTATION_WEIGHTS[event.attestation];
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function weightedMean(values: readonly WeightedValue[]): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const { value, weight } of values) {
    if (weight > 0 && Number.isFinite(value)) {
      weightedTotal += value * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : null;
}

function weightedStandardDeviation(
  values: readonly WeightedValue[],
): number | null {
  const mean = weightedMean(values);
  if (mean === null) {
    return null;
  }
  let weightedSquaredDistance = 0;
  let totalWeight = 0;
  for (const { value, weight } of values) {
    if (weight > 0 && Number.isFinite(value)) {
      weightedSquaredDistance += weight * (value - mean) ** 2;
      totalWeight += weight;
    }
  }
  return totalWeight > 0
    ? Math.sqrt(weightedSquaredDistance / totalWeight)
    : null;
}

function weightedEntropy(counts: ReadonlyMap<string, number>): number | null {
  let totalWeight = 0;
  for (const weight of counts.values()) {
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return null;
  }
  if (counts.size < 2) {
    return 0;
  }

  let entropy = 0;
  for (const weight of counts.values()) {
    const probability = weight / totalWeight;
    if (probability > 0) {
      entropy -= probability * Math.log(probability);
    }
  }
  return clamp(entropy / Math.log(counts.size));
}

function addWeight(
  counts: Map<string, number>,
  key: string,
  weight: number,
): void {
  if (weight > 0) {
    counts.set(key, (counts.get(key) ?? 0) + weight);
  }
}

function weightedMedian(values: readonly WeightedValue[]): number | null {
  const sorted = values
    .filter(({ value, weight }) => Number.isFinite(value) && weight > 0)
    .toSorted((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((total, item) => total + item.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  const halfway = totalWeight / 2;
  let cumulativeWeight = 0;
  for (const item of sorted) {
    cumulativeWeight += item.weight;
    if (cumulativeWeight >= halfway) {
      return item.value;
    }
  }
  return sorted.at(-1)?.value ?? null;
}

function readAmount(event: BehaviorEvent): number | null {
  const value = event.amount?.value;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
  ) {
    return null;
  }
  const amount = Number(value);
  // Larger decimal strings are unsupported; bounding values keeps CV arithmetic finite.
  return Number.isFinite(amount) &&
    amount >= 0 &&
    amount <= FEATURE_CONVENTIONS.maxMeasuredAmount
    ? amount
    : null;
}

function isPaymentAttempt(event: BehaviorEvent): boolean {
  return (
    event.type === "payment.sent" ||
    event.type === "payment.received" ||
    event.type === "payment.failed"
  );
}

function hasVerifiedOwnerLink(event: BehaviorEvent): boolean {
  if (
    event.type !== "identity.linked" ||
    event.attestation === "self_reported"
  ) {
    return false;
  }
  const subjectLink = nonEmptyString(event.subject.links?.owner_ref);
  const attrLink = nonEmptyString(attr(event, "owner_ref"));
  return subjectLink !== null || attrLink !== null;
}

function readAnomalySeverity(event: BehaviorEvent): number | null {
  if (event.type !== "anomaly.flagged") {
    return null;
  }
  const reasonCode = attr(event, "reason_code");
  const severity = attr(event, "severity");
  if (
    typeof reasonCode !== "string" ||
    !VALID_ANOMALY_CODES.has(reasonCode) ||
    typeof severity !== "number" ||
    !VALID_ANOMALY_SEVERITIES.has(severity)
  ) {
    return null;
  }
  return severity;
}

function validManipulationEvidence(event: BehaviorEvent): boolean {
  return (
    event.source === "reppo" &&
    event.type === "work.evaluated" &&
    event.attestation === "platform_signed" &&
    attr(event, "manipulation") === true &&
    nonEmptyString(event.evidence?.eval_id) !== null
  );
}

function isAcceptedVerdict(event: BehaviorEvent): boolean {
  if (event.type !== "work.evaluated") {
    return false;
  }
  if (event.source === "reppo") {
    return nonEmptyString(event.evidence?.eval_id) !== null;
  }
  return (
    event.source === "simulator" &&
    event.simulated &&
    attr(event, "evaluation_origin") === "synthetic_simulation" &&
    attr(event, "evaluation_status") === "synthetic_not_reppo"
  );
}

function spendCoefficientOfVariation(
  days: ReadonlyMap<number, SpendDay>,
  asOfMs: number,
): number | null {
  if (days.size === 0) {
    return null;
  }
  const asOfDay = Math.floor(asOfMs / DAY_MS);
  let firstSpendDay = asOfDay;
  for (const day of days.keys()) {
    firstSpendDay = Math.min(firstSpendDay, day);
  }
  const windowStartDay = Math.max(
    firstSpendDay,
    asOfDay - FEATURE_CONVENTIONS.spendWindowDays + 1,
  );
  const observations: WeightedValue[] = [];
  // Amounts already carry event weights; calendar bins, including empty days, are equal.
  for (let day = windowStartDay; day <= asOfDay; day += 1) {
    observations.push({ value: days.get(day)?.total ?? 0, weight: 1 });
  }
  const mean = weightedMean(observations);
  if (mean === null) {
    return null;
  }
  if (mean === 0) {
    return 0;
  }
  const stdev = weightedStandardDeviation(observations);
  return stdev === null ? null : stdev / mean;
}

function qualityDrift(
  dailyQuality: ReadonlyMap<number, WeightedValue[]>,
  asOfMs: number,
): number | null {
  const recentStartDay =
    Math.floor(asOfMs / DAY_MS) - FEATURE_CONVENTIONS.driftRecentDays + 1;
  const baselineStartDay =
    Math.floor(asOfMs / DAY_MS) - FEATURE_CONVENTIONS.driftWindowDays + 1;
  const baselineEndDay = recentStartDay;
  const recent: WeightedValue[] = [];
  const baseline: WeightedValue[] = [];

  for (const [day, values] of dailyQuality) {
    const dailyMean = weightedMean(values);
    const dailyWeight = values.reduce(
      (total, value) => total + value.weight,
      0,
    );
    if (dailyMean === null || dailyWeight <= 0) {
      continue;
    }
    if (day >= recentStartDay) {
      recent.push({ value: dailyMean, weight: dailyWeight });
    } else if (day >= baselineStartDay && day < baselineEndDay) {
      baseline.push({ value: dailyMean, weight: dailyWeight });
    }
  }

  const recentMean = weightedMean(recent);
  const baselineMean = weightedMean(baseline);
  if (recentMean === null || baselineMean === null) {
    return null;
  }
  return clamp((baselineMean - recentMean) / 100);
}

/** Extract decayed, attestation-weighted signals from already-filtered events. */
export function extractFeatures(
  events: readonly BehaviorEvent[],
  asOfMs: number,
  ageDays: number,
): ExtractedFeatures {
  if (
    !Number.isFinite(asOfMs) ||
    !Number.isFinite(new Date(asOfMs).getTime())
  ) {
    throw new RangeError("asOfMs must be a valid finite timestamp.");
  }
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    throw new RangeError("ageDays must be a finite non-negative number.");
  }

  const evidence: FeatureEvidence = {
    quality: [],
    payments: [],
    failures: [],
    disputes: [],
    violations: [],
    probes: [],
    tasks: [],
    spend: [],
    funding: [],
    identity: [],
    owner: [],
    anomalies: [],
    manipulation: [],
  };

  const qualityValues: WeightedValue[] = [];
  const probeUptime: WeightedValue[] = [];
  const probeLatency: WeightedValue[] = [];
  const paymentCounterparties = new Map<string, number>();
  const fundingSources = new Map<string, number>();
  const spendDays = new Map<number, SpendDay>();
  const dailyQuality = new Map<number, WeightedValue[]>();
  let verdictCount = 0;
  let qualityScoreTotal = 0;
  let qualityScoreWeight = 0;
  let totalDecisionWeight = 0;
  let rejectReviseWeight = 0;
  let rejectOnlyWeight = 0;
  let totalPaymentWeight = 0;
  let failedPaymentWeight = 0;
  let disputeWeight = 0;
  let violationWeight = 0;
  let completedTaskWeight = 0;
  let failedTaskWeight = 0;
  let totalEventWeight = 0;
  let simulatedEventWeight = 0;
  let anomalySeverityWeight = 0;

  for (const event of events) {
    const weight = eventWeight(event, asOfMs);
    totalEventWeight += weight;
    if (event.simulated) {
      simulatedEventWeight += weight;
    }

    if (event.type === "work.evaluated") {
      const score = finiteAttr(event, "reppo_score", 0, 100);
      const confidence = attr(event, "confidence");
      const confidenceWeight =
        typeof confidence === "string" &&
        Object.hasOwn(VERDICT_CONFIDENCE_WEIGHTS, confidence)
          ? VERDICT_CONFIDENCE_WEIGHTS[
              confidence as keyof typeof VERDICT_CONFIDENCE_WEIGHTS
            ]
          : null;
      const acceptedVerdict = isAcceptedVerdict(event) && score !== null;
      if (acceptedVerdict) {
        if (confidenceWeight !== null) {
          const qualityWeight = weight * confidenceWeight;
          qualityScoreTotal += score * qualityWeight;
          qualityScoreWeight += qualityWeight;
        }
        qualityValues.push({ value: score, weight });
        verdictCount += 1;
        evidence.quality.push(event);
        const day = Math.floor(Date.parse(event.occurred_at) / DAY_MS);
        const dayValues = dailyQuality.get(day) ?? [];
        dayValues.push({ value: score, weight });
        dailyQuality.set(day, dayValues);
      }

      const decision = attr(event, "decision");
      if (
        acceptedVerdict &&
        typeof decision === "string" &&
        VALID_DECISIONS.has(decision)
      ) {
        totalDecisionWeight += weight;
        if (decision === "reject" || decision === "revise") {
          rejectReviseWeight += weight;
        }
        if (decision === "reject") {
          rejectOnlyWeight += weight;
        }
      }
      if (validManipulationEvidence(event)) {
        evidence.manipulation.push(event);
      }
    }

    if (weight <= 0) {
      continue;
    }

    if (isPaymentAttempt(event)) {
      evidence.payments.push(event);
      totalPaymentWeight += weight;
      if (event.type === "payment.failed" || event.outcome === "failure") {
        evidence.failures.push(event);
        failedPaymentWeight += weight;
      }
      const counterparty = nonEmptyString(event.counterparty?.id);
      if (counterparty !== null) {
        addWeight(paymentCounterparties, counterparty, weight);
      }
    }

    if (event.type === "payment.limit_violation") {
      evidence.violations.push(event);
      violationWeight += weight;
    }

    if (
      event.type === "payment.refund" ||
      event.type === "payment.dispute" ||
      (isPaymentAttempt(event) &&
        (event.outcome === "disputed" || event.outcome === "reversed"))
    ) {
      evidence.disputes.push(event);
      disputeWeight += weight;
    }

    if (
      event.type === "payment.sent" &&
      event.outcome !== "failure" &&
      event.outcome !== "reversed" &&
      event.outcome !== "disputed"
    ) {
      const amount = readAmount(event);
      if (amount !== null) {
        evidence.spend.push(event);
        const day = Math.floor(Date.parse(event.occurred_at) / DAY_MS);
        const spendDay = spendDays.get(day) ?? { total: 0 };
        spendDay.total += amount * weight;
        spendDays.set(day, spendDay);
      }
    }

    if (event.type === "payment.received") {
      const fundingSource = nonEmptyString(event.counterparty?.id);
      if (fundingSource !== null) {
        evidence.funding.push(event);
        addWeight(fundingSources, fundingSource, weight);
      }
    }

    if (event.type === "probe.uptime" || event.type === "probe.latency") {
      const uptime =
        event.type === "probe.uptime"
          ? finiteAttr(event, "uptime", 0, 1)
          : null;
      const latency = finiteAttr(
        event,
        "latency_ms",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if (uptime !== null) {
        probeUptime.push({ value: uptime, weight });
      }
      if (latency !== null) {
        probeLatency.push({ value: latency, weight });
      }
      if (uptime !== null || latency !== null) {
        evidence.probes.push(event);
      }
    }

    if (
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "action.reversed_by_user"
    ) {
      evidence.tasks.push(event);
      if (event.type === "task.completed") {
        completedTaskWeight += weight;
      } else {
        failedTaskWeight += weight;
      }
    }

    if (
      event.type === "identity.registered" ||
      event.type === "identity.linked"
    ) {
      evidence.identity.push(event);
    }
    if (hasVerifiedOwnerLink(event)) {
      evidence.owner.push(event);
    }

    const severity = readAnomalySeverity(event);
    if (severity !== null) {
      evidence.anomalies.push(event);
      anomalySeverityWeight += severity * weight;
    }
  }

  const qualityMean =
    qualityScoreWeight > 0 ? qualityScoreTotal / qualityScoreWeight : null;
  const qualityStdev = weightedStandardDeviation(qualityValues);
  const rejectReviseRate =
    totalDecisionWeight > 0
      ? clamp(rejectReviseWeight / totalDecisionWeight)
      : null;
  const rejectRate =
    totalDecisionWeight > 0
      ? clamp(rejectOnlyWeight / totalDecisionWeight)
      : null;
  const disputeRefundRate =
    totalPaymentWeight > 0
      ? clamp(disputeWeight / totalPaymentWeight)
      : disputeWeight > 0
        ? 1
        : null;
  const violationsPer100Payments =
    totalPaymentWeight > 0
      ? (violationWeight / totalPaymentWeight) * 100
      : violationWeight > 0
        ? Number.POSITIVE_INFINITY
        : null;
  const taskWeight = completedTaskWeight + failedTaskWeight;
  const ownerLinked = evidence.owner.length > 0;
  const metrics: FeatureMetrics = {
    verdictCount,
    rejectReviseRate,
    failRate:
      totalPaymentWeight > 0
        ? clamp(failedPaymentWeight / totalPaymentWeight)
        : null,
    disputeRefundRate,
    counterpartyEntropy: weightedEntropy(paymentCounterparties),
    uptime: weightedMean(probeUptime),
    p50Ms: weightedMedian(probeLatency),
    completionRate:
      taskWeight > 0 ? clamp(completedTaskWeight / taskWeight) : null,
    spendCv: spendCoefficientOfVariation(spendDays, asOfMs),
    qualityStdev,
    driftScore: qualityDrift(dailyQuality, asOfMs),
    fundingDiversity: weightedEntropy(fundingSources),
    ownerLinked,
  };

  const qParameters = FACTOR_PARAMETERS.Q;
  const pParameters = FACTOR_PARAMETERS.P;
  const lParameters = FACTOR_PARAMETERS.L;
  const cParameters = FACTOR_PARAMETERS.C;
  const iParameters = FACTOR_PARAMETERS.I;
  const qualitySubscore =
    qualityMean === null
      ? NEUTRAL
      : clamp(
          qualityMean / 100 - qParameters.rejectPenalty * (rejectRate ?? 0),
        );
  const violationsPenalty =
    violationsPer100Payments === null
      ? 1 - NEUTRAL
      : 1 - clamp(violationsPer100Payments / pParameters.violationsPer100);
  const disputePenalty =
    metrics.disputeRefundRate === null
      ? 1 - NEUTRAL
      : 1 - clamp(pParameters.disputeMultiplier * metrics.disputeRefundRate);
  const factors: Record<Factor, number> = {
    Q: qualitySubscore,
    P:
      pParameters.failure * (1 - (metrics.failRate ?? NEUTRAL)) +
      pParameters.violations * violationsPenalty +
      pParameters.disputes * disputePenalty +
      pParameters.diversity * (metrics.counterpartyEntropy ?? NEUTRAL),
    L:
      lParameters.uptime * (metrics.uptime ?? NEUTRAL) +
      lParameters.latency *
        (metrics.p50Ms === null
          ? NEUTRAL
          : 1 -
            clamp(
              (metrics.p50Ms - lParameters.latencyTargetMs) /
                lParameters.latencyRangeMs,
            )) +
      lParameters.completion * (metrics.completionRate ?? NEUTRAL),
    C:
      cParameters.spend *
        (metrics.spendCv === null
          ? NEUTRAL
          : 1 - clamp(metrics.spendCv / cParameters.spendCvLimit)) +
      cParameters.quality *
        (metrics.qualityStdev === null
          ? NEUTRAL
          : 1 - clamp(metrics.qualityStdev / cParameters.qualityStdevLimit)) +
      cParameters.drift *
        (metrics.driftScore === null ? NEUTRAL : 1 - metrics.driftScore),
    I:
      iParameters.age *
        clamp(Math.log1p(ageDays) / Math.log(iParameters.maxAgeDays + 1)) +
      iParameters.owner * Number(metrics.ownerLinked) +
      iParameters.funding * (metrics.fundingDiversity ?? NEUTRAL),
    F: 1 - clamp(anomalySeverityWeight),
  };

  return {
    factors,
    metrics,
    evidence,
    simulatedShare:
      totalEventWeight > 0 ? clamp(simulatedEventWeight / totalEventWeight) : 0,
  };
}
