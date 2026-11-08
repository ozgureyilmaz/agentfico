import { createHash } from "node:crypto";
import type { BehaviorEvent } from "@agentfico/core";
import { getPersona, PERSONA_IDS, PERSONAS, type PersonaId } from "./personas";
import {
  createRandomSource,
  createUlidFactory,
  type RandomSource,
} from "./random";

export const SIMULATION_ANCHOR = "2026-11-05T00:00:00.000Z";
export const SIMULATION_ANCHOR_MS = Date.parse(SIMULATION_ANCHOR);
export const DEFAULT_SIMULATION_DAYS = 90;
export const DEFAULT_SIMULATION_SEED = 42;

const DAY_MS = 24 * 60 * 60 * 1000;
const PERSONA_ID_SET = new Set<string>(PERSONA_IDS);

export interface SimulationOptions {
  seed?: number | string;
  days?: number;
  personas?: readonly PersonaId[] | "all";
}

interface NormalizedSimulationOptions {
  seed: number | string;
  days: number;
  personas: readonly PersonaId[];
}

interface SimulationContext {
  afcId: string;
  activeDays: number;
  startMs: number;
  random: RandomSource;
  nextUlid: (timestampMs: number) => string;
  events: BehaviorEvent[];
}

function normalizeOptions(
  options: SimulationOptions,
): NormalizedSimulationOptions {
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const days = options.days ?? DEFAULT_SIMULATION_DAYS;

  if (typeof seed === "number" && !Number.isSafeInteger(seed)) {
    throw new Error("Simulation seed must be a safe integer or string.");
  }
  if (typeof seed === "string" && seed.length === 0) {
    throw new Error("Simulation seed cannot be empty.");
  }
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error("Simulation days must be an integer from 1 to 3650.");
  }

  const requestedPersonas = options.personas ?? "all";
  let selectedPersonas: readonly PersonaId[];

  if (requestedPersonas === "all") {
    selectedPersonas = PERSONA_IDS;
  } else {
    if (!Array.isArray(requestedPersonas)) {
      throw new Error(
        'Simulation personas must be "all" or an array of persona IDs.',
      );
    }

    const uniqueIds = new Set<PersonaId>();
    for (const personaId of requestedPersonas) {
      if (!PERSONA_ID_SET.has(personaId)) {
        throw new Error(`Unknown persona: ${String(personaId)}`);
      }
      uniqueIds.add(personaId);
    }
    selectedPersonas = PERSONA_IDS.filter((personaId) =>
      uniqueIds.has(personaId),
    );
  }

  return { seed, days, personas: selectedPersonas };
}

function eventTimestamp(context: SimulationContext, dayIndex: number): number {
  const hourOffset = context.random.integer(7, 20) * 60 * 60 * 1000;
  const minuteOffset = context.random.integer(0, 59) * 60 * 1000;
  const secondOffset = context.random.integer(0, 59) * 1000;
  return (
    context.startMs +
    dayIndex * DAY_MS +
    hourOffset +
    minuteOffset +
    secondOffset
  );
}

function emitEvent(
  context: SimulationContext,
  dayIndex: number,
  event: Omit<
    BehaviorEvent,
    | "event_id"
    | "subject"
    | "source"
    | "simulated"
    | "attestation"
    | "occurred_at"
  >,
): void {
  const occurredAtMs = eventTimestamp(context, dayIndex);
  context.events.push({
    event_id: context.nextUlid(occurredAtMs),
    subject: { afc_id: context.afcId },
    source: "simulator",
    simulated: true,
    attestation: "self_reported",
    occurred_at: new Date(occurredAtMs).toISOString(),
    ...event,
  });
}

function emitIdentity(context: SimulationContext): void {
  emitEvent(context, 0, {
    type: "identity.registered",
    attrs: { identity_origin: "synthetic_simulation" },
  });
}

function amountValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

function emitPayment(
  context: SimulationContext,
  dayIndex: number,
  options: {
    cents: number;
    counterpartyId: string;
    kind: "merchant" | "agent" | "user" | "unknown";
    outcome?: "success" | "failure" | "reversed" | "disputed";
    received?: boolean;
    attrs?: Record<string, unknown>;
  },
): void {
  const outcome = options.outcome ?? "success";
  emitEvent(context, dayIndex, {
    type: options.received
      ? "payment.received"
      : outcome === "failure"
        ? "payment.failed"
        : "payment.sent",
    amount: {
      value: amountValue(options.cents),
      currency: "USDC",
      decimals: 6,
    },
    counterparty: { id: options.counterpartyId, kind: options.kind },
    outcome,
    ...(options.attrs ? { attrs: options.attrs } : {}),
  });
}

function emitWorkEvaluation(
  context: SimulationContext,
  dayIndex: number,
  score: number,
  extraAttrs: Record<string, unknown> = {},
): void {
  const decision = score >= 70 ? "accept" : score >= 45 ? "revise" : "reject";
  emitEvent(context, dayIndex, {
    type: "work.evaluated",
    attrs: {
      reppo_score: score,
      decision,
      confidence: "low",
      evaluation_origin: "synthetic_simulation",
      evaluation_status: "synthetic_not_reppo",
      ...extraAttrs,
    },
  });
}

function evenlySpacedIndices(total: number, count: number): Set<number> {
  if (count <= 0) {
    return new Set();
  }

  return new Set(
    Array.from({ length: count }, (_, index) =>
      Math.floor(((index + 0.5) * total) / count),
    ),
  );
}

function emitProbes(
  context: SimulationContext,
  uptimePercent: number,
  successLatency: readonly [number, number] = [180, 1100],
): void {
  const probeCount = 100;
  const failedCount = probeCount - uptimePercent;
  const failedIndices = evenlySpacedIndices(probeCount, failedCount);

  for (let index = 0; index < probeCount; index += 1) {
    const dayIndex = Math.floor((index * context.activeDays) / probeCount);
    const failed = failedIndices.has(index);
    const latencyMs = failed
      ? context.random.integer(3200, 7200)
      : context.random.integer(...successLatency);
    emitEvent(context, dayIndex, {
      type: "probe.uptime",
      outcome: failed ? "failure" : "success",
      attrs: { uptime: failed ? 0 : 1, latency_ms: latencyMs },
    });
  }
}

function createContext(
  personaId: PersonaId,
  seed: number | string,
  days: number,
): SimulationContext {
  const persona = getPersona(personaId);
  const activeDays = Math.min(days, persona.walletAgeDays);
  const random = createRandomSource(`${String(seed)}:${personaId}`);

  return {
    afcId: persona.afcId,
    activeDays,
    startMs: SIMULATION_ANCHOR_MS - activeDays * DAY_MS,
    random,
    nextUlid: createUlidFactory(random),
    events: [],
  };
}

function generateAtlas(context: SimulationContext): void {
  emitIdentity(context);

  for (let day = 0; day < context.activeDays; day += 1) {
    const purchases = context.random.integer(2, 4);
    for (let index = 0; index < purchases; index += 1) {
      const merchantNumber = context.random.integer(1, 12);
      emitPayment(context, day, {
        cents: context.random.integer(250, 1800),
        counterpartyId: `merchant:atlas-${String(merchantNumber).padStart(2, "0")}`,
        kind: "merchant",
      });
    }

    emitWorkEvaluation(context, day, context.random.integer(82, 97));
  }

  emitProbes(context, 99);
}

function generateBlaze(context: SimulationContext): void {
  emitIdentity(context);
  const purchaseDays = Array.from(
    { length: context.activeDays },
    (_, day) => day,
  ).filter((day) => day % 3 === 0 || isWeekend(context, day));
  const failedPaymentIndices = evenlySpacedIndices(
    purchaseDays.length,
    Math.round(purchaseDays.length * 0.06),
  );
  for (const [index, day] of purchaseDays.entries()) {
    const weekend = isWeekend(context, day);
    emitPayment(context, day, {
      cents: context.random.integer(500, 2000) * (weekend ? 5 : 1),
      counterpartyId: `merchant:blaze-${index % 20 === 0 ? 2 : index % 20 === 10 ? 3 : 1}`,
      kind: "merchant",
      outcome: failedPaymentIndices.has(index) ? "failure" : "success",
      attrs: weekend ? { weekend_spend_multiplier: 5 } : undefined,
    });
  }

  for (let day = 0; day < context.activeDays; day += 1) {
    const score =
      day % 5 === 4
        ? context.random.integer(34, 41)
        : context.random.integer(70, 77);
    emitWorkEvaluation(context, day, score);
  }

  for (const dayIndex of [
    Math.floor(context.activeDays * 0.25),
    Math.floor(context.activeDays * 0.5),
    Math.floor(context.activeDays * 0.75),
  ]) {
    emitEvent(context, Math.min(dayIndex, context.activeDays - 1), {
      type: "payment.limit_violation",
      outcome: "failure",
      attrs: { error_code: "session_total_exceeded", synthetic: true },
    });
  }

  emitProbes(context, 97, [2600, 3000]);
}

function isWeekend(context: SimulationContext, day: number): boolean {
  const weekday = new Date(context.startMs + day * DAY_MS).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function generateMurk(context: SimulationContext): void {
  emitIdentity(context);

  const qualityScores = [74, 72, 72, 71, 70, 70, 50, 38, 32, 28];
  const failedTaskIndices = evenlySpacedIndices(100, 25);
  for (let index = 0; index < qualityScores.length; index += 1) {
    const dayIndex = Math.floor(
      (index * context.activeDays) / qualityScores.length,
    );
    const score = qualityScores[index];
    emitWorkEvaluation(context, dayIndex, score);
    if (score >= 70) {
      emitPayment(context, dayIndex, {
        cents: 1800,
        counterpartyId: "user:murk-buyer",
        kind: "user",
        received: true,
      });
    }
  }
  emitEvent(context, Math.floor(context.activeDays * 0.75), {
    type: "payment.dispute",
    outcome: "disputed",
    counterparty: { id: "user:murk-buyer", kind: "user" },
  });

  for (let index = 0; index < 100; index += 1) {
    const dayIndex = Math.floor((index * context.activeDays) / 100);
    const failed = failedTaskIndices.has(index);
    emitEvent(context, dayIndex, {
      type: failed ? "task.failed" : "task.completed",
      outcome: failed ? "failure" : "success",
      attrs: { task_origin: "synthetic_simulation" },
    });
  }

  emitProbes(context, 80, [3900, 5000]);
}

function generateNova(context: SimulationContext): void {
  emitIdentity(context);
  const siblingIds = Array.from(
    { length: 9 },
    (_, index) => `afc:sim:nova-sibling-${String(index + 1).padStart(2, "0")}`,
  );

  for (let index = 0; index < siblingIds.length; index += 1) {
    emitPayment(context, index % context.activeDays, {
      cents: context.random.integer(2000, 10000),
      counterpartyId: "afc:sim:shared-funder",
      kind: "agent",
      received: true,
      attrs: {
        linked_wallet: siblingIds[index],
        linked_wallet_count: siblingIds.length,
        shared_funder_id: "afc:sim:shared-funder",
        funding_origin: "synthetic_simulation",
      },
    });
  }

  const cycleCounterparty = siblingIds[0];
  emitPayment(context, 0, {
    cents: 2500,
    counterpartyId: cycleCounterparty,
    kind: "agent",
    attrs: { synthetic_cycle_leg: 1 },
  });
  emitPayment(context, 0, {
    cents: 2400,
    counterpartyId: cycleCounterparty,
    kind: "agent",
    received: true,
    attrs: { synthetic_cycle_leg: 2 },
  });
  emitEvent(context, 0, {
    type: "anomaly.flagged",
    attrs: {
      reason_code: "F01",
      severity: 1,
      detector: "synthetic_cycle",
      confirmed: true,
    },
  });
  emitEvent(context, 0, {
    type: "anomaly.flagged",
    attrs: {
      reason_code: "F02",
      severity: 1,
      detector: "synthetic_shared_funder",
      confirmed: true,
      linked_wallets: siblingIds,
      linked_wallet_count: siblingIds.length,
    },
  });
}

function generatePhoenix(context: SimulationContext): void {
  emitIdentity(context);
  const failedEarlyPayments = evenlySpacedIndices(60, 6);

  for (let day = 0; day < context.activeDays; day += 1) {
    for (let index = 0; index < 2; index += 1) {
      const paymentIndex = day * 2 + index;
      const failed = day < 30 && failedEarlyPayments.has(paymentIndex);
      const cents = context.random.integer(300, 1200);
      const merchant = context.random.integer(1, 6);
      emitPayment(context, day, {
        cents,
        counterpartyId: `merchant:phoenix-${day < 30 ? 1 : merchant}`,
        kind: "merchant",
        outcome: failed ? "failure" : "success",
      });
    }

    const score =
      day < 30
        ? 18 + (day % 7) * 3 + context.random.integer(0, 4)
        : Math.min(
            94,
            Math.round(54 + (day - 30) * 0.44 + context.random.integer(0, 4)),
          );
    emitWorkEvaluation(context, day, score, {
      ...(day >= 30
        ? { feedback_action: "adapted_after_simulated_feedback" }
        : {}),
    });
    if (day < 30 && day % 5 < 2) {
      emitEvent(context, day, { type: "payment.refund", outcome: "reversed" });
    }
    if (day < 30 || day % 3 !== 0) {
      emitEvent(context, day, {
        type: day < 30 ? "task.failed" : "task.completed",
        outcome: day < 30 ? "failure" : "success",
      });
    }
  }

  for (const dayIndex of [4, 14, 27]) {
    if (dayIndex < context.activeDays) {
      emitEvent(context, dayIndex, {
        type: "payment.limit_violation",
        outcome: "failure",
        attrs: {
          error_code: "session_total_exceeded",
          recovery_phase: "initial_bad_period",
          synthetic: true,
        },
      });
    }
  }

  emitProbes(context, 98);
}

const GENERATORS: Record<PersonaId, (context: SimulationContext) => void> = {
  atlas: generateAtlas,
  blaze: generateBlaze,
  murk: generateMurk,
  "nova-7": generateNova,
  phoenix: generatePhoenix,
};

export function generateSimulation(
  options: SimulationOptions = {},
): BehaviorEvent[] {
  const normalized = normalizeOptions(options);
  const events: BehaviorEvent[] = [];

  for (const personaId of normalized.personas) {
    const context = createContext(personaId, normalized.seed, normalized.days);
    GENERATORS[personaId](context);
    events.push(...context.events);
  }

  events.sort((left, right) => {
    if (left.occurred_at < right.occurred_at) {
      return -1;
    }
    if (left.occurred_at > right.occurred_at) {
      return 1;
    }
    if (left.event_id < right.event_id) {
      return -1;
    }
    if (left.event_id > right.event_id) {
      return 1;
    }
    return 0;
  });
  return events;
}

export function serializeEvents(events: readonly BehaviorEvent[]): string {
  return JSON.stringify(canonicalize(events));
}

export function hashEventsSha256(events: readonly BehaviorEvent[]): string {
  return createHash("sha256")
    .update(serializeEvents(events), "utf8")
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    return Object.fromEntries(
      keys.map((key) => [key, canonicalize(record[key])]),
    );
  }

  return value;
}

export function isPersonaId(value: string): value is PersonaId {
  return PERSONA_ID_SET.has(value);
}

export { PERSONAS };
