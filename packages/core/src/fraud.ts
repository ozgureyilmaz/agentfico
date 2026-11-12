import type { BehaviorEvent } from "./events";
import { ATTESTATION_WEIGHTS, DAY_MS, HALF_LIFE_DAYS } from "./weights";

export const FRAUD_DETECTOR_THRESHOLDS = {
  F01: { windowHours: 24, minimumAmount: 10, amountTolerance: 0.01 },
  F02: { freshWalletDays: 30, minimumWallets: 5 },
  F04: { windowMinutes: 10, minimumPayments: 8, minimumVolume: 250 },
  F05: {
    windowMinutes: 30,
    minimumEvaluations: 5,
    maximumScoreRange: 1,
  },
  F06: { windowDays: 7, minimumDistinctLinks: 3 },
  F07: {
    windowDays: 30,
    minimumSettledPayments: 5,
    minimumRefundsOrDisputes: 3,
    minimumAdverseRate: 0.4,
  },
} as const;

export type FraudFindingCode = keyof typeof FRAUD_DETECTOR_THRESHOLDS;
export type FraudFindingBasis =
  | "onchain"
  | "platform_signed"
  | "simulated_demo";

export interface FraudFinding {
  afc_id: string;
  code: FraudFindingCode;
  severity: 0.5 | 1;
  confidence: "medium" | "high";
  confirmed: boolean;
  basis: FraudFindingBasis;
  source_event_ids: string[];
  eval_ids: string[];
  metrics: Record<string, number | string>;
}

interface Transfer {
  event: BehaviorEvent;
  from: string;
  to: string;
  amountMicros: bigint;
  currency: "USDC" | "USD";
  occurredAt: number;
}

const FRESHNESS_MS = FRAUD_DETECTOR_THRESHOLDS.F02.freshWalletDays * DAY_MS;
const CYCLE_WINDOW_MS =
  FRAUD_DETECTOR_THRESHOLDS.F01.windowHours * 60 * 60 * 1000;
const VELOCITY_WINDOW_MS =
  FRAUD_DETECTOR_THRESHOLDS.F04.windowMinutes * 60 * 1000;
const EVALUATION_WINDOW_MS =
  FRAUD_DETECTOR_THRESHOLDS.F05.windowMinutes * 60 * 1000;
const IDENTITY_WINDOW_MS = FRAUD_DETECTOR_THRESHOLDS.F06.windowDays * DAY_MS;
const REFUND_WINDOW_MS = FRAUD_DETECTOR_THRESHOLDS.F07.windowDays * DAY_MS;
const MICROS_PER_UNIT = 1_000_000n;
const MIN_CYCLE_MICROS =
  BigInt(FRAUD_DETECTOR_THRESHOLDS.F01.minimumAmount) * MICROS_PER_UNIT;
const MIN_VELOCITY_MICROS =
  BigInt(FRAUD_DETECTOR_THRESHOLDS.F04.minimumVolume) * MICROS_PER_UNIT;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function attr(event: BehaviorEvent, key: string): unknown {
  return record(event.attrs)?.[key];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function verifiedExternal(event: BehaviorEvent): boolean {
  return (
    event.source !== "simulator" &&
    event.simulated === false &&
    event.attestation !== "self_reported"
  );
}

function novaScenarioEvent(event: BehaviorEvent, afcId: string): boolean {
  return (
    afcId === "afc:sim:nova-7" &&
    event.subject.afc_id === afcId &&
    event.source === "simulator" &&
    event.simulated === true &&
    attr(event, "synthetic_case") === "nova-7"
  );
}

function verifiedFor(
  event: BehaviorEvent,
  afcId: string,
  syntheticMarker?: string,
): boolean {
  if (verifiedExternal(event)) return true;
  if (!syntheticMarker || !novaScenarioEvent(event, afcId)) return false;
  return attr(event, syntheticMarker) !== undefined;
}

function isSuccessfulTransfer(event: BehaviorEvent): boolean {
  return (
    (event.type === "payment.sent" || event.type === "payment.received") &&
    event.outcome !== "failure" &&
    event.outcome !== "reversed" &&
    event.outcome !== "disputed"
  );
}

function amountMicros(event: BehaviorEvent): bigint | null {
  const value = event.amount?.value;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
  ) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  try {
    return BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction.padEnd(6, "0"));
  } catch {
    return null;
  }
}

function readAmountNumber(event: BehaviorEvent): number | null {
  const micros = amountMicros(event);
  if (
    micros === null ||
    micros > BigInt(Number.MAX_SAFE_INTEGER) * MICROS_PER_UNIT
  ) {
    return null;
  }
  const amount = Number(micros) / Number(MICROS_PER_UNIT);
  return Number.isFinite(amount) ? amount : null;
}

function observedEvents(
  input: readonly BehaviorEvent[],
  asOfMs: number,
): BehaviorEvent[] {
  const eligible = input
    .filter((event) => {
      const time = Date.parse(event.occurred_at);
      return Number.isFinite(time) && time <= asOfMs;
    })
    .toSorted((left, right) => {
      const timeOrder =
        Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
      if (timeOrder !== 0) return timeOrder;
      const idOrder = compareText(left.event_id, right.event_id);
      if (idOrder !== 0) return idOrder;
      return compareText(JSON.stringify(left), JSON.stringify(right));
    });
  const unique = new Map<string, BehaviorEvent>();
  for (const event of eligible) {
    if (!unique.has(event.event_id)) unique.set(event.event_id, event);
  }
  return [...unique.values()];
}

function amountMatches(left: bigint, right: bigint): boolean {
  const larger = left > right ? left : right;
  const difference = left > right ? left - right : right - left;
  const tolerance = larger / 100n;
  return difference <= (tolerance > 10_000n ? tolerance : 10_000n);
}

function aliases(events: readonly BehaviorEvent[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of events) {
    const afcId = event.subject.afc_id;
    result.set(afcId.toLowerCase(), afcId);
    const address = nonEmptyString(event.subject.links?.kite_address);
    if (address) result.set(address.toLowerCase(), afcId);
    if (afcId.startsWith("afc:kite:")) {
      result.set(afcId.slice("afc:kite:".length).toLowerCase(), afcId);
    }
  }
  return result;
}

function findingBasis(events: readonly BehaviorEvent[]): FraudFindingBasis {
  if (
    events.every((event) => event.source === "simulator" && event.simulated)
  ) {
    return "simulated_demo";
  }
  return events.every((event) => event.attestation === "onchain")
    ? "onchain"
    : "platform_signed";
}

function eventIds(events: readonly BehaviorEvent[]): string[] {
  return [...new Set(events.map((event) => event.event_id))].sort(compareText);
}

function evalIds(events: readonly BehaviorEvent[]): string[] {
  return [
    ...new Set(
      events.flatMap((event) => {
        const id = event.evidence?.eval_id;
        return event.source === "reppo" && typeof id === "string" && id.trim()
          ? [id]
          : [];
      }),
    ),
  ].sort(compareText);
}

function makeFinding(
  afcId: string,
  code: FraudFindingCode,
  severity: FraudFinding["severity"],
  confidence: FraudFinding["confidence"],
  confirmed: boolean,
  events: readonly BehaviorEvent[],
  metrics: Record<string, number | string>,
): FraudFinding {
  return {
    afc_id: afcId,
    code,
    severity,
    confidence,
    confirmed,
    basis: findingBasis(events),
    source_event_ids: eventIds(events),
    eval_ids: evalIds(events),
    metrics,
  };
}

function detectCycles(
  events: readonly BehaviorEvent[],
  afcId: string,
): FraudFinding | null {
  const aliasMap = aliases(events);
  const resolve = (id: string): string =>
    aliasMap.get(id.toLowerCase()) ?? id.toLowerCase();
  const target = resolve(afcId);
  const transfers: Transfer[] = [];

  for (const event of events) {
    if (
      !isSuccessfulTransfer(event) ||
      !verifiedFor(event, afcId, "synthetic_cycle_leg")
    ) {
      continue;
    }
    const value = amountMicros(event);
    const counterparty = nonEmptyString(event.counterparty?.id);
    if (
      value === null ||
      value < MIN_CYCLE_MICROS ||
      counterparty === null ||
      event.amount === undefined
    ) {
      continue;
    }
    const subject = resolve(event.subject.afc_id);
    const peer = resolve(counterparty);
    if (subject === peer) {
      if (subject === target) {
        return makeFinding(afcId, "F01", 1, "high", true, [event], {
          self_transfer: 1,
          amount_min: Number(value) / Number(MICROS_PER_UNIT),
        });
      }
      continue;
    }
    const occurredAt = Date.parse(event.occurred_at);
    transfers.push({
      event,
      from: event.type === "payment.sent" ? subject : peer,
      to: event.type === "payment.sent" ? peer : subject,
      amountMicros: value,
      currency: event.amount.currency,
      occurredAt,
    });
  }

  const matches = new Map<string, Transfer[]>();
  for (let index = 0; index < transfers.length; index += 1) {
    const left = transfers[index];
    if (left.from !== target && left.to !== target) continue;
    for (
      let otherIndex = index + 1;
      otherIndex < transfers.length;
      otherIndex += 1
    ) {
      const right = transfers[otherIndex];
      if (right.occurredAt - left.occurredAt > CYCLE_WINDOW_MS) break;
      if (
        right.from !== left.to ||
        right.to !== left.from ||
        right.currency !== left.currency ||
        !amountMatches(left.amountMicros, right.amountMicros)
      ) {
        continue;
      }
      const pairKey = [left.event.event_id, right.event.event_id]
        .sort(compareText)
        .join(":");
      matches.set(pairKey, [left, right]);
    }
  }

  if (matches.size === 0) return null;
  const matched = [...matches.values()].flat();
  const uniqueTransfers = [
    ...new Map(
      matched.map((transfer) => [transfer.event.event_id, transfer]),
    ).values(),
  ];
  const sourceEvents = uniqueTransfers.map((transfer) => transfer.event);
  const elapsed =
    Math.max(...uniqueTransfers.map((transfer) => transfer.occurredAt)) -
    Math.min(...uniqueTransfers.map((transfer) => transfer.occurredAt));
  return makeFinding(afcId, "F01", 1, "high", true, sourceEvents, {
    matched_cycles: matches.size,
    matched_transfers: uniqueTransfers.length,
    amount_min:
      Number(
        uniqueTransfers.reduce(
          (min, transfer) =>
            transfer.amountMicros < min ? transfer.amountMicros : min,
          uniqueTransfers[0].amountMicros,
        ),
      ) / Number(MICROS_PER_UNIT),
    elapsed_minutes: Math.round(elapsed / 60_000),
  });
}

function detectSharedFunder(
  events: readonly BehaviorEvent[],
  afcId: string,
  asOfMs: number,
): FraudFinding | null {
  const identities = new Map<string, BehaviorEvent>();
  for (const event of events) {
    if (event.type === "identity.registered" && verifiedExternal(event)) {
      const prior = identities.get(event.subject.afc_id);
      if (!prior || event.occurred_at < prior.occurred_at) {
        identities.set(event.subject.afc_id, event);
      }
    }
  }

  const fundingBySource = new Map<string, Map<string, BehaviorEvent>>();
  for (const event of events) {
    if (
      event.type !== "payment.received" ||
      !isSuccessfulTransfer(event) ||
      !verifiedExternal(event)
    ) {
      continue;
    }
    const source = nonEmptyString(event.counterparty?.id);
    const identity = identities.get(event.subject.afc_id);
    if (
      !source ||
      !identity ||
      asOfMs - Date.parse(identity.occurred_at) > FRESHNESS_MS ||
      Date.parse(event.occurred_at) < Date.parse(identity.occurred_at)
    )
      continue;
    const wallets =
      fundingBySource.get(source.toLowerCase()) ??
      new Map<string, BehaviorEvent>();
    const prior = wallets.get(event.subject.afc_id);
    if (!prior || event.occurred_at < prior.occurred_at) {
      wallets.set(event.subject.afc_id, event);
    }
    fundingBySource.set(source.toLowerCase(), wallets);
  }

  const actualGroups = [...fundingBySource.entries()]
    .filter(
      ([, wallets]) =>
        wallets.has(afcId) &&
        wallets.size >= FRAUD_DETECTOR_THRESHOLDS.F02.minimumWallets,
    )
    .sort(([left], [right]) => compareText(left, right));
  if (actualGroups.length > 0) {
    const [funder, wallets] = actualGroups[0];
    const selectedWallets = [
      afcId,
      ...[...wallets.keys()]
        .filter((id) => id !== afcId)
        .sort(compareText)
        .slice(0, FRAUD_DETECTOR_THRESHOLDS.F02.minimumWallets - 1),
    ];
    const sourceEvents = selectedWallets
      .flatMap((wallet) => [wallets.get(wallet), identities.get(wallet)])
      .filter((event): event is BehaviorEvent => event !== undefined);
    return makeFinding(afcId, "F02", 1, "high", true, sourceEvents, {
      fresh_wallets: wallets.size,
      required_wallets: FRAUD_DETECTOR_THRESHOLDS.F02.minimumWallets,
      funder,
    });
  }

  const simulatedGroups = new Map<string, Map<string, BehaviorEvent[]>>();
  for (const event of events) {
    if (
      event.subject.afc_id !== afcId ||
      event.type !== "payment.received" ||
      !verifiedFor(event, afcId, "linked_wallet")
    ) {
      continue;
    }
    const wallet = nonEmptyString(attr(event, "linked_wallet"));
    const funder =
      nonEmptyString(attr(event, "shared_funder_id")) ??
      nonEmptyString(event.counterparty?.id);
    if (!wallet || !funder) continue;
    const wallets =
      simulatedGroups.get(funder) ?? new Map<string, BehaviorEvent[]>();
    const walletEvents = wallets.get(wallet) ?? [];
    walletEvents.push(event);
    wallets.set(wallet, walletEvents);
    simulatedGroups.set(funder, wallets);
  }

  const syntheticGroup = [...simulatedGroups.entries()]
    .filter(
      ([, wallets]) =>
        wallets.size >= FRAUD_DETECTOR_THRESHOLDS.F02.minimumWallets,
    )
    .sort(([left], [right]) => compareText(left, right))[0];
  if (!syntheticGroup) return null;
  const [funder, wallets] = syntheticGroup;
  const selected = [...wallets.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .slice(0, 5);
  const sourceEvents = selected.flatMap(([, fundingEvents]) =>
    fundingEvents.slice(0, 1),
  );
  const identity = events.find(
    (event) =>
      event.subject.afc_id === afcId &&
      event.type === "identity.registered" &&
      event.source === "simulator" &&
      event.simulated &&
      attr(event, "identity_origin") === "synthetic_simulation" &&
      asOfMs - Date.parse(event.occurred_at) <= FRESHNESS_MS,
  );
  if (identity) sourceEvents.push(identity);
  return makeFinding(afcId, "F02", 1, "high", true, sourceEvents, {
    fresh_wallets: wallets.size,
    required_wallets: FRAUD_DETECTOR_THRESHOLDS.F02.minimumWallets,
    funder,
  });
}

function detectVelocity(
  events: readonly BehaviorEvent[],
  afcId: string,
): FraudFinding | null {
  const payments = events
    .filter(
      (event) =>
        event.subject.afc_id === afcId &&
        isSuccessfulTransfer(event) &&
        verifiedExternal(event),
    )
    .flatMap((event) => {
      const amount = amountMicros(event);
      return amount === null || event.amount === undefined
        ? []
        : [
            {
              event,
              amount,
              currency: event.amount.currency,
              at: Date.parse(event.occurred_at),
            },
          ];
    })
    .toSorted(
      (left, right) =>
        left.at - right.at ||
        compareText(left.event.event_id, right.event.event_id),
    );
  let best: typeof payments = [];
  for (let end = 0; end < payments.length; end += 1) {
    let start = end;
    while (
      start > 0 &&
      payments[end].at - payments[start - 1].at <= VELOCITY_WINDOW_MS
    ) {
      start -= 1;
    }
    const window = payments
      .slice(start, end + 1)
      .filter((item) => item.currency === payments[end].currency);
    const volume = window.reduce((sum, item) => sum + item.amount, 0n);
    if (
      window.length >= FRAUD_DETECTOR_THRESHOLDS.F04.minimumPayments &&
      volume >= MIN_VELOCITY_MICROS &&
      window.length > best.length
    ) {
      best = window;
    }
  }
  if (best.length === 0) return null;
  return makeFinding(
    afcId,
    "F04",
    0.5,
    "medium",
    false,
    best.map((item) => item.event),
    {
      payment_count: best.length,
      window_minutes: Math.round((best.at(-1)!.at - best[0].at) / 60_000),
      volume:
        Number(best.reduce((sum, item) => sum + item.amount, 0n)) /
        Number(MICROS_PER_UNIT),
    },
  );
}

function detectEvaluationFarming(
  events: readonly BehaviorEvent[],
  afcId: string,
): FraudFinding | null {
  const evaluations = events
    .filter(
      (event) =>
        event.subject.afc_id === afcId &&
        event.type === "work.evaluated" &&
        event.source === "reppo" &&
        event.attestation === "platform_signed" &&
        event.simulated === false &&
        nonEmptyString(event.evidence?.eval_id) !== null &&
        typeof attr(event, "reppo_score") === "number" &&
        Number.isFinite(attr(event, "reppo_score")),
    )
    .toSorted(
      (left, right) =>
        Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
        compareText(left.event_id, right.event_id),
    );
  let best: BehaviorEvent[] = [];
  for (let end = 0; end < evaluations.length; end += 1) {
    let start = end;
    while (
      start > 0 &&
      Date.parse(evaluations[end].occurred_at) -
        Date.parse(evaluations[start - 1].occurred_at) <=
        EVALUATION_WINDOW_MS
    ) {
      start -= 1;
    }
    const window = evaluations.slice(start, end + 1);
    const scores = window.map((event) => Number(attr(event, "reppo_score")));
    const decisions = new Set(window.map((event) => attr(event, "decision")));
    const evalIdsInWindow = new Set(
      window.map((event) => event.evidence?.eval_id),
    );
    if (
      window.length >= FRAUD_DETECTOR_THRESHOLDS.F05.minimumEvaluations &&
      evalIdsInWindow.size === window.length &&
      decisions.size === 1 &&
      Math.max(...scores) - Math.min(...scores) <=
        FRAUD_DETECTOR_THRESHOLDS.F05.maximumScoreRange &&
      window.length > best.length
    ) {
      best = window;
    }
  }
  if (best.length === 0) return null;
  const scores = best.map((event) => Number(attr(event, "reppo_score")));
  return makeFinding(afcId, "F05", 0.5, "medium", false, best, {
    evaluation_count: best.length,
    window_minutes: Math.round(
      (Date.parse(best.at(-1)!.occurred_at) - Date.parse(best[0].occurred_at)) /
        60_000,
    ),
    score_range: Math.max(...scores) - Math.min(...scores),
  });
}

function detectIdentityChurn(
  events: readonly BehaviorEvent[],
  afcId: string,
): FraudFinding | null {
  const fields = ["kite_address", "passport_id", "erc8004"] as const;
  for (const field of fields) {
    const candidates = events.filter(
      (event) =>
        event.subject.afc_id === afcId &&
        (event.type === "identity.registered" ||
          event.type === "identity.linked") &&
        verifiedExternal(event) &&
        nonEmptyString(event.subject.links?.[field]) !== null,
    );
    const byValue = new Map<string, BehaviorEvent>();
    for (const event of candidates) {
      const value = nonEmptyString(event.subject.links?.[field]);
      if (value && !byValue.has(value.toLowerCase()))
        byValue.set(value.toLowerCase(), event);
    }
    const references = [...byValue.values()].toSorted(
      (left, right) =>
        Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
        compareText(left.event_id, right.event_id),
    );
    for (
      let end = FRAUD_DETECTOR_THRESHOLDS.F06.minimumDistinctLinks - 1;
      end < references.length;
      end += 1
    ) {
      let start = end;
      while (
        start > 0 &&
        Date.parse(references[end].occurred_at) -
          Date.parse(references[start - 1].occurred_at) <=
          IDENTITY_WINDOW_MS
      ) {
        start -= 1;
      }
      const window = references.slice(start, end + 1);
      if (window.length >= FRAUD_DETECTOR_THRESHOLDS.F06.minimumDistinctLinks) {
        return makeFinding(afcId, "F06", 0.5, "medium", false, window, {
          distinct_links: window.length,
          window_days: Number(
            (
              (Date.parse(window.at(-1)!.occurred_at) -
                Date.parse(window[0].occurred_at)) /
              DAY_MS
            ).toFixed(3),
          ),
          link_type: field,
        });
      }
    }
  }
  return null;
}

function detectRefundAbuse(
  events: readonly BehaviorEvent[],
  afcId: string,
  asOfMs: number,
): FraudFinding | null {
  const windowEvents = events.filter(
    (event) =>
      event.subject.afc_id === afcId &&
      asOfMs - Date.parse(event.occurred_at) <= REFUND_WINDOW_MS &&
      verifiedExternal(event),
  );
  const settled = windowEvents.filter(
    (event) => event.type === "payment.sent" && isSuccessfulTransfer(event),
  );
  const adverse = windowEvents.filter(
    (event) =>
      event.type === "payment.refund" ||
      event.type === "payment.dispute" ||
      ((event.type === "payment.sent" || event.type === "payment.received") &&
        (event.outcome === "reversed" || event.outcome === "disputed")),
  );
  const uniqueAdverse = new Map<string, BehaviorEvent>();
  for (const event of adverse) {
    const key = nonEmptyString(event.evidence?.tx_hash) ?? event.event_id;
    if (!uniqueAdverse.has(key)) uniqueAdverse.set(key, event);
  }
  const refundEvents = [...uniqueAdverse.values()];
  const rate = settled.length === 0 ? 0 : refundEvents.length / settled.length;
  if (
    settled.length < FRAUD_DETECTOR_THRESHOLDS.F07.minimumSettledPayments ||
    refundEvents.length <
      FRAUD_DETECTOR_THRESHOLDS.F07.minimumRefundsOrDisputes ||
    rate < FRAUD_DETECTOR_THRESHOLDS.F07.minimumAdverseRate
  ) {
    return null;
  }
  return makeFinding(
    afcId,
    "F07",
    0.5,
    "medium",
    false,
    [...settled, ...refundEvents],
    {
      settled_payments: settled.length,
      refunds_or_disputes: refundEvents.length,
      adverse_rate: Number(rate.toFixed(3)),
    },
  );
}

/**
 * Pure deterministic fraud detectors. Pass the broadest available event set so
 * shared-funder evidence can include sibling wallets; scoreAgent also calls
 * this function and filters findings to the requested subject.
 */
export function detectFraud(
  input: readonly BehaviorEvent[],
  options: { afcId: string; asOfMs: number },
): FraudFinding[] {
  const { afcId, asOfMs } = options;
  if (!afcId.trim()) throw new TypeError("afcId must be a non-empty string.");
  if (
    !Number.isFinite(asOfMs) ||
    !Number.isFinite(new Date(asOfMs).getTime())
  ) {
    throw new RangeError("asOfMs must be a valid finite timestamp.");
  }
  const events = observedEvents(input, asOfMs);
  const targetHasHistory = events.some(
    (event) => event.subject.afc_id === afcId,
  );
  if (!targetHasHistory) return [];

  return [
    detectCycles(events, afcId),
    detectSharedFunder(events, afcId, asOfMs),
    detectVelocity(events, afcId),
    detectEvaluationFarming(events, afcId),
    detectIdentityChurn(events, afcId),
    detectRefundAbuse(events, afcId, asOfMs),
  ]
    .filter((finding): finding is FraudFinding => finding !== null)
    .toSorted((left, right) => compareText(left.code, right.code));
}

/** Weight used when detector findings enter the existing integrity formula. */
export function fraudEvidenceWeight(
  event: BehaviorEvent,
  asOfMs: number,
): number {
  const occurredAtMs = Date.parse(event.occurred_at);
  if (!Number.isFinite(occurredAtMs) || occurredAtMs > asOfMs) return 0;
  const ageDays = Math.max(0, (asOfMs - occurredAtMs) / DAY_MS);
  return (
    2 ** (-ageDays / HALF_LIFE_DAYS.fraud) *
    ATTESTATION_WEIGHTS[event.attestation]
  );
}
