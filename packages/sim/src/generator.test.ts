import { describe, expect, test } from "bun:test";
import type { BehaviorEvent } from "@agentfico/core";
import {
  generateSimulation,
  hashEventsSha256,
  listPersonas,
  type PersonaId,
  SIMULATION_ANCHOR_MS,
} from "./index";

const DEFAULT_GOLDEN_SHA256 =
  "0cce410724a9ca97770462e5ee4e28c3e6f52f9e6158511109a504ae9f2014c3";

function eventsFor(
  events: readonly BehaviorEvent[],
  personaId: PersonaId,
): BehaviorEvent[] {
  return events.filter(
    (event) => event.subject.afc_id === `afc:sim:${personaId}`,
  );
}

function numberAttr(event: BehaviorEvent, name: string): number {
  return Number(event.attrs?.[name]);
}

function stringAttr(event: BehaviorEvent, name: string): string {
  return String(event.attrs?.[name]);
}

describe("seeded simulator", () => {
  test("emits the exact seed-42 golden serialization and is repeatable", () => {
    const first = generateSimulation({ seed: 42, days: 90, personas: "all" });
    const second = generateSimulation({ seed: 42, days: 90, personas: "all" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(hashEventsSha256(first)).toBe(DEFAULT_GOLDEN_SHA256);
    expect(hashEventsSha256(second)).toBe(DEFAULT_GOLDEN_SHA256);
  });

  test("preserves all five named personas and labels every event simulated", () => {
    const events = generateSimulation();
    const personaIds = [
      ...new Set(events.map((event) => event.subject.afc_id)),
    ].sort();

    expect(personaIds).toEqual([
      "afc:sim:atlas",
      "afc:sim:blaze",
      "afc:sim:murk",
      "afc:sim:nova-7",
      "afc:sim:phoenix",
    ]);
    expect(listPersonas().map((persona) => persona.name)).toEqual([
      "Atlas",
      "Blaze",
      "Murk",
      "Nova-7",
      "Phoenix",
    ]);
    expect(
      events.every((event) => event.source === "simulator" && event.simulated),
    ).toBe(true);
    expect(
      events.every((event) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(event.event_id)),
    ).toBe(true);
    expect(new Set(events.map((event) => event.event_id)).size).toBe(
      events.length,
    );
    expect(events.every((event) => event.occurred_at.endsWith("Z"))).toBe(true);
  });

  test("Atlas has 60-day history, diverse small purchases, high synthetic targets, and 99% uptime", () => {
    const atlas = eventsFor(generateSimulation(), "atlas");
    const payments = atlas.filter((event) => event.type === "payment.sent");
    const merchants = new Set(payments.map((event) => event.counterparty?.id));
    const evaluations = atlas.filter(
      (event) => event.type === "work.evaluated",
    );
    const probes = atlas.filter((event) => event.type === "probe.uptime");
    const dates = new Set(atlas.map((event) => event.occurred_at.slice(0, 10)));

    expect(dates.size).toBe(60);
    expect(payments.length).toBeGreaterThanOrEqual(120);
    expect(payments.length).toBeLessThanOrEqual(240);
    expect(merchants.size).toBeGreaterThanOrEqual(5);
    expect(
      evaluations.every((event) => numberAttr(event, "reppo_score") >= 82),
    ).toBe(true);
    expect(
      evaluations.every(
        (event) =>
          stringAttr(event, "evaluation_status") === "synthetic_not_reppo",
      ),
    ).toBe(true);
    expect(
      evaluations.every((event) => event.evidence?.eval_id === undefined),
    ).toBe(true);
    expect(
      evaluations.every((event) => event.attrs?.eval_id === undefined),
    ).toBe(true);
    expect(probes.filter((event) => event.outcome === "success")).toHaveLength(
      99,
    );
  });

  test("Blaze has weekend five-times spend, three limit breaches, and about 6% failures", () => {
    const blaze = eventsFor(generateSimulation(), "blaze");
    const payments = blaze.filter(
      (event) =>
        event.type === "payment.sent" || event.type === "payment.failed",
    );
    const failures = payments.filter(
      (event) => event.type === "payment.failed",
    );
    const violations = blaze.filter(
      (event) => event.type === "payment.limit_violation",
    );
    const weekendPurchases = payments.filter(
      (event) => numberAttr(event, "weekend_spend_multiplier") === 5,
    );

    expect(payments).toHaveLength(48);
    expect(failures).toHaveLength(3);
    expect(failures.length / payments.length).toBeCloseTo(0.06, 2);
    expect(violations).toHaveLength(3);
    expect(
      violations.every(
        (event) => stringAttr(event, "error_code") === "session_total_exceeded",
      ),
    ).toBe(true);
    expect(weekendPurchases.length).toBeGreaterThan(0);
  });

  test("Murk has 40% revise/reject work, 80% uptime, and 25% task failures", () => {
    const murk = eventsFor(generateSimulation(), "murk");
    const evaluations = murk.filter((event) => event.type === "work.evaluated");
    const probes = murk.filter((event) => event.type === "probe.uptime");
    const failedTasks = murk.filter(
      (event) => event.type === "task.failed",
    ).length;
    const revisedOrRejected = evaluations.filter((event) => {
      const decision = stringAttr(event, "decision");
      return decision === "revise" || decision === "reject";
    });

    expect(evaluations).toHaveLength(10);
    expect(revisedOrRejected).toHaveLength(4);
    expect(probes.filter((event) => event.outcome === "success")).toHaveLength(
      80,
    );
    expect(failedTasks).toBe(25);
    expect(
      murk.filter((event) => event.type === "payment.received"),
    ).toHaveLength(6);
  });

  test("Nova-7 stays inside a one-day window and its wash cycle is under 24 hours", () => {
    const nova = eventsFor(
      generateSimulation({ seed: 42, days: 1, personas: ["nova-7"] }),
      "nova-7",
    );
    const cycleLegs = nova.filter(
      (event) => event.attrs?.synthetic_cycle_leg !== undefined,
    );
    const cycleElapsedMs = Math.abs(
      Date.parse(cycleLegs[1].occurred_at) -
        Date.parse(cycleLegs[0].occurred_at),
    );
    const timestamps = nova.map((event) => Date.parse(event.occurred_at));
    const startOfWindow = SIMULATION_ANCHOR_MS - 24 * 60 * 60 * 1000;

    expect(nova.length).toBeGreaterThan(0);
    expect(Math.min(...timestamps)).toBeGreaterThanOrEqual(startOfWindow);
    expect(Math.max(...timestamps)).toBeLessThan(SIMULATION_ANCHOR_MS);
    expect(cycleLegs).toHaveLength(2);
    expect(cycleElapsedMs).toBeLessThan(24 * 60 * 60 * 1000);
    expect(nova.some((event) => event.type === "anomaly.flagged")).toBe(false);
    expect(
      new Set(
        nova.flatMap((event) =>
          typeof event.attrs?.linked_wallet === "string"
            ? [event.attrs.linked_wallet]
            : [],
        ),
      ).size,
    ).toBe(9);
  });

  test("Phoenix quality targets rise after simulated feedback while violations stay early", () => {
    const phoenix = eventsFor(generateSimulation(), "phoenix");
    const evaluations = phoenix.filter(
      (event) => event.type === "work.evaluated",
    );
    const firstPeriod = evaluations
      .slice(0, 30)
      .map((event) => numberAttr(event, "reppo_score"));
    const laterPeriod = evaluations
      .slice(-30)
      .map((event) => numberAttr(event, "reppo_score"));
    const violations = phoenix.filter(
      (event) => event.type === "payment.limit_violation",
    );
    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    expect(evaluations).toHaveLength(90);
    expect(average(laterPeriod)).toBeGreaterThan(average(firstPeriod));
    expect(violations).toHaveLength(3);
    expect(
      violations.every(
        (event) =>
          Date.parse(event.occurred_at) <
          SIMULATION_ANCHOR_MS - 60 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      evaluations
        .slice(30)
        .every(
          (event) =>
            stringAttr(event, "feedback_action") ===
            "adapted_after_simulated_feedback",
        ),
    ).toBe(true);
  });

  test("supports selected personas and rejects invalid day ranges", () => {
    const selected = generateSimulation({
      seed: "selection",
      days: 2,
      personas: ["phoenix", "atlas"],
    });
    expect(new Set(selected.map((event) => event.subject.afc_id))).toEqual(
      new Set(["afc:sim:atlas", "afc:sim:phoenix"]),
    );
    expect(() => generateSimulation({ days: 0 })).toThrow(
      "Simulation days must be an integer",
    );
  });
});
