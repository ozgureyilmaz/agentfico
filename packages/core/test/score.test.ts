import { describe, expect, test } from "bun:test";
import {
  generateSimulation,
  SIMULATION_ANCHOR_MS,
} from "../../sim/src/generator";
import type { BehaviorEvent } from "../src/events";
import { scoreAgent } from "../src/score";

const DAY_MS = 24 * 60 * 60 * 1000;
const AS_OF = new Date(SIMULATION_ANCHOR_MS).toISOString();
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let nextEventNumber = 0;

function ulid(): string {
  let value = nextEventNumber++;
  let suffix = "";
  for (let index = 0; index < 10; index += 1) {
    suffix = `${ALPHABET[value % 32]}${suffix}`;
    value = Math.floor(value / 32);
  }
  return `${"0".repeat(16)}${suffix}`;
}

function makeEvent(
  afcId: string,
  daysAgo: number,
  type: BehaviorEvent["type"],
  fields: Partial<BehaviorEvent> = {},
): BehaviorEvent {
  return {
    event_id: ulid(),
    subject: { afc_id: afcId },
    source: "simulator",
    simulated: true,
    attestation: "self_reported",
    type,
    occurred_at: new Date(Date.parse(AS_OF) - daysAgo * DAY_MS).toISOString(),
    ...fields,
  };
}

interface HistoryOptions {
  afcId?: string;
  eventCount?: number;
  verdictCount?: number;
  ageDays?: number;
  scoreOffset?: number;
}

function makeHistory(options: HistoryOptions = {}): BehaviorEvent[] {
  const {
    afcId = "afc:test:history",
    eventCount = 50,
    verdictCount = 10,
    ageDays = 90,
    scoreOffset = 0,
  } = options;
  const events: BehaviorEvent[] = [
    makeEvent(afcId, ageDays, "identity.registered"),
  ];
  const workCount = Math.min(verdictCount, Math.max(0, eventCount - 2));

  for (let index = 0; index < workCount; index += 1) {
    const daysAgo = Math.floor(((index + 1) / (workCount + 1)) * ageDays);
    const reppoScore = Math.max(
      0,
      Math.min(100, 94 + scoreOffset - (index % 4)),
    );
    events.push(
      makeEvent(afcId, daysAgo, "work.evaluated", {
        source: "reppo",
        simulated: false,
        attestation: "platform_signed",
        attrs: {
          reppo_score: reppoScore,
          decision: "accept",
          confidence: "high",
        },
        evidence: { eval_id: `eval-${afcId}-${index}` },
      }),
    );
  }

  while (events.length < eventCount) {
    const index = events.length;
    const daysAgo = Math.floor(((index + 1) / (eventCount + 1)) * ageDays);
    if (index % 3 === 0) {
      const merchant = index % 7;
      events.push(
        makeEvent(afcId, daysAgo, "payment.sent", {
          outcome: "success",
          amount: { value: "4.00", currency: "USDC", decimals: 6 },
          counterparty: { id: `merchant-${merchant}`, kind: "merchant" },
        }),
      );
    } else if (index % 3 === 1) {
      events.push(
        makeEvent(afcId, daysAgo, "task.completed", { outcome: "success" }),
      );
    } else {
      events.push(
        makeEvent(afcId, daysAgo, "probe.uptime", {
          outcome: "success",
          attrs: { uptime: 1, latency_ms: 450 },
        }),
      );
    }
  }
  return events;
}

function makeLowHistory(options: HistoryOptions): BehaviorEvent[] {
  return makeHistory({ ...options, scoreOffset: -100 }).map((event) => {
    if (event.type === "work.evaluated") {
      return {
        ...event,
        attrs: {
          ...event.attrs,
          reppo_score: 0,
          decision: "reject",
        },
      };
    }
    if (event.type === "payment.sent") {
      return { ...event, type: "payment.failed", outcome: "failure" };
    }
    if (event.type === "task.completed") {
      return { ...event, type: "task.failed", outcome: "failure" };
    }
    if (event.type === "probe.uptime") {
      return {
        ...event,
        outcome: "failure",
        attrs: { ...event.attrs, uptime: 0, latency_ms: 7200 },
      };
    }
    return event;
  });
}

function scoreValue(result: ReturnType<typeof scoreAgent>): number {
  if (result.score === null) {
    throw new Error(`Expected a numeric score, got ${result.status}`);
  }
  return result.score;
}

function eventsFor(
  events: readonly BehaviorEvent[],
  afcId: string,
): BehaviorEvent[] {
  return events.filter((event) => event.subject.afc_id === afcId);
}

function reasonCodes(result: ReturnType<typeof scoreAgent>): Set<string> {
  return new Set(result.reason_codes.map((reason) => reason.code));
}

function manipulationVerdict(
  afcId: string,
  daysAgo: number,
  index: number,
  manipulation: boolean,
): BehaviorEvent {
  return makeEvent(afcId, daysAgo, "work.evaluated", {
    source: "reppo",
    simulated: false,
    attestation: "platform_signed",
    attrs: {
      reppo_score: 95,
      decision: "accept",
      confidence: "high",
      manipulation,
    },
    evidence: { eval_id: `manipulation-${afcId}-${index}` },
  });
}

describe("afc-0.2 scoring acceptance", () => {
  test("seed-42 personas land in their specified score ranges with their signature reasons", () => {
    const events = generateSimulation({ seed: 42, days: 90, personas: "all" });
    const expected = [
      {
        id: "afc:sim:atlas",
        minimum: 760,
        maximum: 800,
        snapshot: 778,
        codes: ["Q01", "P04"],
      },
      {
        id: "afc:sim:blaze",
        minimum: 600,
        maximum: 650,
        snapshot: 647,
        codes: ["P01", "C01", "P02"],
      },
      {
        id: "afc:sim:murk",
        minimum: 560,
        maximum: 620,
        snapshot: 618,
        codes: ["Q01", "Q02", "L01"],
      },
    ];

    for (const persona of expected) {
      const result = scoreAgent(
        eventsFor(events, persona.id),
        persona.id,
        AS_OF,
      );
      expect(scoreValue(result)).toBeGreaterThanOrEqual(persona.minimum);
      expect(scoreValue(result)).toBeLessThanOrEqual(persona.maximum);
      expect(scoreValue(result)).toBe(persona.snapshot);
      expect([...reasonCodes(result)]).toEqual(
        expect.arrayContaining(persona.codes),
      );
      expect(result.afc_id).toBe(persona.id);
      expect(result.as_of).toBe(AS_OF);
      expect(result.factors).toEqual(
        expect.objectContaining({
          Q: expect.any(Number),
          P: expect.any(Number),
          L: expect.any(Number),
          C: expect.any(Number),
          I: expect.any(Number),
          F: expect.any(Number),
        }),
      );
    }
  });

  test("monotonicity samples span low, mid, and high un-capped score profiles", () => {
    const simulated = generateSimulation({
      seed: 42,
      days: 90,
      personas: "all",
    });
    const lowId = "afc:test:low-profile";
    const profiles = [
      {
        id: lowId,
        events: makeLowHistory({
          afcId: lowId,
          eventCount: 60,
          verdictCount: 12,
          ageDays: 180,
        }),
        minimum: 300,
        maximum: 579,
      },
      {
        id: "afc:sim:blaze",
        events: eventsFor(simulated, "afc:sim:blaze"),
        minimum: 580,
        maximum: 739,
      },
      {
        id: "afc:sim:atlas",
        events: eventsFor(simulated, "afc:sim:atlas"),
        minimum: 740,
        maximum: 799,
      },
    ];

    for (const profile of profiles) {
      const result = scoreAgent(profile.events, profile.id, AS_OF);
      expect(scoreValue(result)).toBeGreaterThanOrEqual(profile.minimum);
      expect(scoreValue(result)).toBeLessThanOrEqual(profile.maximum);
      expect(result.status).toBe("active");
    }
  });

  test("Phoenix scores about 520 before recovery and about 680 after the full history", () => {
    const id = "afc:sim:phoenix";
    const phoenix = eventsFor(
      generateSimulation({ seed: 42, days: 90, personas: ["phoenix"] }),
      id,
    );
    const earlyAsOf = new Date(
      SIMULATION_ANCHOR_MS - 60 * DAY_MS,
    ).toISOString();
    const earlyEvents = phoenix.filter(
      (event) => Date.parse(event.occurred_at) <= Date.parse(earlyAsOf),
    );
    const early = scoreAgent(earlyEvents, id, earlyAsOf);
    const recovered = scoreAgent(phoenix, id, AS_OF);

    expect(scoreValue(early)).toBeGreaterThanOrEqual(500);
    expect(scoreValue(early)).toBeLessThanOrEqual(540);
    expect(scoreValue(recovered)).toBeGreaterThanOrEqual(660);
    expect(scoreValue(recovered)).toBeLessThanOrEqual(700);
    expect(scoreValue(early)).toBe(520);
    expect(scoreValue(recovered)).toBe(691);
    expect(scoreValue(recovered) - scoreValue(early)).toBeGreaterThanOrEqual(
      100,
    );
  });

  test("Nova-7 is capped at 549, under review, and cites both fraud flags", () => {
    const id = "afc:sim:nova-7";
    const events = eventsFor(
      generateSimulation({ seed: 42, days: 90, personas: ["nova-7"] }),
      id,
    );
    const result = scoreAgent(events, id, AS_OF);
    const codes = reasonCodes(result);

    expect(scoreValue(result)).toBeLessThanOrEqual(549);
    expect(scoreValue(result)).toBe(549);
    expect(result.confidence).toBe("low");
    expect(result.status).toBe("under_review");
    expect([...codes]).toEqual(expect.arrayContaining(["F01", "F02", "I01"]));

    for (const code of ["F01", "F02"]) {
      const reason = result.reason_codes.find((item) => item.code === code);
      if (!reason) throw new Error(`Missing ${code} reason`);
      expect(reason.events.length).toBeGreaterThanOrEqual(2);
      for (const id of reason.events) {
        expect(events.find((event) => event.event_id === id)?.type).not.toBe(
          "anomaly.flagged",
        );
      }
    }
  });

  test("fewer than three events is insufficient; thin files stay capped at 649", () => {
    const id = "afc:test:thin";
    const twoEvents = makeHistory({
      afcId: id,
      eventCount: 2,
      verdictCount: 0,
    });
    const threeEvents = makeHistory({
      afcId: id,
      eventCount: 3,
      verdictCount: 1,
    });
    const onlyTwoVerdicts = makeHistory({
      afcId: id,
      eventCount: 50,
      verdictCount: 2,
      ageDays: 90,
    });
    const fewerThanTenEvents = makeHistory({
      afcId: id,
      eventCount: 9,
      verdictCount: 3,
      ageDays: 90,
    });
    const tooRecent = makeHistory({
      afcId: id,
      eventCount: 50,
      verdictCount: 10,
      ageDays: 6,
    });

    const insufficient = scoreAgent(twoEvents, id, AS_OF);
    expect(insufficient.score).toBeNull();
    expect(insufficient.status).toBe("insufficient_history");

    for (const history of [
      threeEvents,
      onlyTwoVerdicts,
      fewerThanTenEvents,
      tooRecent,
    ]) {
      const result = scoreAgent(history, id, AS_OF);
      expect(scoreValue(result)).toBeLessThanOrEqual(649);
      expect(result.confidence).toBe("low");
    }
  });

  test("the thin-file boundary is inclusive at 3 verdicts, 10 events, and 7 days", () => {
    const id = "afc:test:eligibility";
    const oneBelowEachBoundary = [
      makeHistory({ afcId: id, eventCount: 10, verdictCount: 2, ageDays: 7 }),
      makeHistory({ afcId: id, eventCount: 9, verdictCount: 3, ageDays: 7 }),
      makeHistory({ afcId: id, eventCount: 10, verdictCount: 3, ageDays: 6 }),
    ];
    for (const history of oneBelowEachBoundary) {
      expect(scoreValue(scoreAgent(history, id, AS_OF))).toBeLessThanOrEqual(
        649,
      );
    }

    const exactlyEligible = makeHistory({
      afcId: id,
      eventCount: 10,
      verdictCount: 3,
      ageDays: 7,
    });
    const result = scoreAgent(exactlyEligible, id, AS_OF);
    expect(result.confidence).toBe("medium");
    expect(scoreValue(result)).toBeGreaterThan(649);
  });

  test("adding violations or confirmed fraud never raises an established score", () => {
    const backdatedDays = [0, 1, 6, 7, 59, 60, 119, 120, 240, 365];

    for (let trial = 0; trial < backdatedDays.length; trial += 1) {
      const id = `afc:test:monotonic-${trial}`;
      const history = makeHistory({
        afcId: id,
        eventCount: 50 + (trial % 4),
        verdictCount: 10 + (trial % 3),
        ageDays: 365,
        scoreOffset: (trial % 5) - 2,
      });
      const baseline = scoreValue(scoreAgent(history, id, AS_OF));
      const daysAgo = backdatedDays[trial];
      const violation = makeEvent(id, daysAgo, "payment.limit_violation", {
        outcome: "failure",
        attrs: { error_code: "session_total_exceeded" },
      });
      const fraudFlag = makeEvent(id, daysAgo, "anomaly.flagged", {
        attrs: {
          reason_code: trial % 2 === 0 ? "F01" : "F02",
          severity: 1,
          confirmed: true,
        },
      });

      expect(
        scoreValue(scoreAgent([...history, violation], id, AS_OF)),
      ).toBeLessThanOrEqual(baseline);
      expect(
        scoreValue(scoreAgent([...history, fraudFlag], id, AS_OF)),
      ).toBeLessThanOrEqual(baseline);
    }
  });

  test("seeded trials preserve monotonicity across score tiers and file boundaries", () => {
    const eventCounts = [3, 9, 10, 11, 49, 50, 51];
    const verdictCounts = [2, 3, 9, 10, 11];
    const historyAges = [6, 7, 29, 30, 31, 365];
    const adverseAges = [0, 6, 7, 59, 60, 119, 120, 365];
    const severities = [0.2, 0.5, 1] as const;
    const attestations = [
      "self_reported",
      "platform_signed",
      "onchain",
    ] as const;
    const observed = {
      eventCounts: new Set<number>(),
      verdictCounts: new Set<number>(),
      historyAges: new Set<number>(),
      adverseAges: new Set<number>(),
    };
    const seed = 0x0afc02026;

    for (let trial = 0; trial < 64; trial += 1) {
      const tier = (trial + seed) % 3;
      const eventCount = eventCounts[(trial + seed) % eventCounts.length];
      const verdictCount =
        verdictCounts[(trial * 2 + seed) % verdictCounts.length];
      const ageDays = historyAges[(trial * 5 + seed) % historyAges.length];
      const daysAgo = adverseAges[(trial * 3 + seed) % adverseAges.length];
      const severity = severities[(trial + seed) % severities.length];
      const attestation =
        attestations[(trial * 2 + seed) % attestations.length];
      const id = `afc:test:seeded-property-${trial}`;
      const options = {
        afcId: id,
        eventCount,
        verdictCount,
        ageDays,
        scoreOffset: tier === 0 ? -35 : tier === 1 ? -5 : 0,
      };
      const history =
        tier === 0 ? makeLowHistory(options) : makeHistory(options);
      const baseline = scoreAgent(history, id, AS_OF);
      const baselineScore = scoreValue(baseline);
      const violation = makeEvent(id, daysAgo, "payment.limit_violation", {
        outcome: "failure",
        attestation,
        attrs: { error_code: "session_total_exceeded" },
      });
      const fraudFlag = makeEvent(id, daysAgo, "anomaly.flagged", {
        attestation,
        attrs: {
          reason_code: trial % 2 === 0 ? "F01" : "F02",
          severity,
          confirmed: severity === 1,
        },
      });
      const afterViolation = scoreAgent([...history, violation], id, AS_OF);
      const afterFlag = scoreAgent([...history, fraudFlag], id, AS_OF);

      observed.eventCounts.add(eventCount);
      observed.verdictCounts.add(verdictCount);
      observed.historyAges.add(ageDays);
      observed.adverseAges.add(daysAgo);

      expect(scoreValue(afterViolation)).toBeLessThanOrEqual(baselineScore);
      expect(scoreValue(afterFlag)).toBeLessThanOrEqual(baselineScore);
      expect(afterViolation.confidence).toBe(baseline.confidence);
      expect(afterFlag.confidence).toBe(baseline.confidence);
      expect(afterFlag.factors.F).toBeLessThan(baseline.factors.F);
      if (severity === 1) {
        expect(afterFlag.status).toBe("under_review");
        expect(scoreValue(afterFlag)).toBeLessThanOrEqual(549);
      } else {
        expect(afterFlag.status).toBe("active");
      }
    }

    expect([...observed.eventCounts].sort((a, b) => a - b)).toEqual(
      eventCounts,
    );
    expect([...observed.verdictCounts].sort((a, b) => a - b)).toEqual(
      verdictCounts,
    );
    expect([...observed.historyAges].sort((a, b) => a - b)).toEqual(
      historyAges,
    );
    expect([...observed.adverseAges].sort((a, b) => a - b)).toEqual(
      adverseAges,
    );
  });

  test("adverse additions cannot use event-count, verdict, or age boundaries to lift a thin-file cap", () => {
    const boundaryCases = [
      { eventCount: 9, verdictCount: 3, ageDays: 30, adverseDaysAgo: 365 },
      { eventCount: 10, verdictCount: 3, ageDays: 6, adverseDaysAgo: 365 },
      { eventCount: 10, verdictCount: 2, ageDays: 30, adverseDaysAgo: 0 },
    ];

    for (let index = 0; index < boundaryCases.length; index += 1) {
      const boundary = boundaryCases[index];
      const id = `afc:test:thin-monotonic-${index}`;
      const history = makeHistory({
        afcId: id,
        eventCount: boundary.eventCount,
        verdictCount: boundary.verdictCount,
        ageDays: boundary.ageDays,
      });
      const baseline = scoreValue(scoreAgent(history, id, AS_OF));
      const violation = makeEvent(
        id,
        boundary.adverseDaysAgo,
        "payment.limit_violation",
        {
          outcome: "failure",
          attrs: { error_code: "session_total_exceeded" },
        },
      );
      const fraudFlag = makeEvent(
        id,
        boundary.adverseDaysAgo,
        "anomaly.flagged",
        { attrs: { reason_code: "F01", severity: 1, confirmed: true } },
      );

      for (const result of [
        scoreAgent([...history, violation], id, AS_OF),
        scoreAgent([...history, fraudFlag], id, AS_OF),
      ]) {
        expect(scoreValue(result)).toBeLessThanOrEqual(baseline);
        expect(scoreValue(result)).toBeLessThanOrEqual(649);
        expect(result.confidence).toBe("low");
      }
    }
  });

  test("on-chain adverse evidence weighs at least as much as self-reported evidence", () => {
    const id = "afc:test:attestation";
    const history = makeHistory({
      afcId: id,
      eventCount: 50,
      verdictCount: 10,
      ageDays: 90,
    });
    const selfReported = makeEvent(id, 1, "payment.limit_violation", {
      outcome: "failure",
      attestation: "self_reported",
      attrs: { error_code: "session_total_exceeded" },
    });
    const onchain = {
      ...selfReported,
      event_id: ulid(),
      attestation: "onchain" as const,
    };

    expect(
      scoreValue(scoreAgent([...history, onchain], id, AS_OF)),
    ).toBeLessThanOrEqual(
      scoreValue(scoreAgent([...history, selfReported], id, AS_OF)),
    );
  });

  test("partial fraud severities reduce integrity without triggering the confirmed-fraud cap", () => {
    const id = "afc:test:partial-fraud";
    const history = makeHistory({
      afcId: id,
      eventCount: 60,
      verdictCount: 12,
      ageDays: 180,
    });
    const baseline = scoreAgent(history, id, AS_OF);
    const scenarios = [
      { code: "F01", severity: 0.2, daysAgo: 0, attestation: "self_reported" },
      {
        code: "F02",
        severity: 0.5,
        daysAgo: 60,
        attestation: "platform_signed",
      },
      { code: "F03", severity: 0.5, daysAgo: 180, attestation: "onchain" },
    ] as const;

    for (const scenario of scenarios) {
      const flag = makeEvent(id, scenario.daysAgo, "anomaly.flagged", {
        attestation: scenario.attestation,
        attrs: {
          reason_code: scenario.code,
          severity: scenario.severity,
          confirmed: false,
        },
      });
      const result = scoreAgent([...history, flag], id, AS_OF);

      expect(result.factors.F).toBeLessThan(baseline.factors.F);
      expect(scoreValue(result)).toBeLessThanOrEqual(scoreValue(baseline));
      expect(result.status).toBe("active");
    }

    const partialCluster = [0.5, 0.5].map((severity, index) =>
      makeEvent(id, 0, "anomaly.flagged", {
        attestation: "onchain",
        attrs: {
          reason_code: index === 0 ? "F01" : "F02",
          severity,
          confirmed: false,
        },
      }),
    );
    const clusterScore = scoreAgent([...history, ...partialCluster], id, AS_OF);
    expect(clusterScore.factors.F).toBe(0);
    expect(clusterScore.status).toBe("active");
    expect(scoreValue(clusterScore)).toBeGreaterThan(549);
  });

  test("Q04 deducts 40 points per recent Reppo manipulation verdict, capped at 120", () => {
    const id = "afc:test:manipulation";
    const history = makeHistory({
      afcId: id,
      eventCount: 100,
      verdictCount: 20,
      ageDays: 90,
    });
    const cases = [
      { ages: [10], penalty: 40 },
      { ages: [10, 30], penalty: 80 },
      { ages: [1, 10, 20, 30, 50], penalty: 120 },
      { ages: [60], penalty: 40 },
      { ages: [61], penalty: 0 },
    ];

    for (const [caseIndex, { ages, penalty }] of cases.entries()) {
      const cleanVerdicts = ages.map((age, index) =>
        manipulationVerdict(id, age, caseIndex * 10 + index, false),
      );
      const manipulatedVerdicts = cleanVerdicts.map((event) => ({
        ...event,
        attrs: { ...event.attrs, manipulation: true },
      }));
      const clean = scoreValue(
        scoreAgent([...history, ...cleanVerdicts], id, AS_OF),
      );
      const manipulated = scoreAgent(
        [...history, ...manipulatedVerdicts],
        id,
        AS_OF,
      );

      expect(clean - scoreValue(manipulated)).toBe(penalty);
      if (penalty > 0) {
        const q04 = manipulated.reason_codes.find(
          (reason) => reason.code === "Q04",
        );
        expect(q04?.eval_ids).toEqual(
          ages
            .flatMap((age, index) =>
              age <= 60 ? [`manipulation-${id}-${caseIndex * 10 + index}`] : [],
            )
            .sort(),
        );
      }
    }
  });

  test("adverse payment evidence decays with its 120-day half-life", () => {
    const id = "afc:test:decay";
    const history = makeHistory({
      afcId: id,
      eventCount: 150,
      verdictCount: 10,
      ageDays: 365,
    });
    const recent = makeEvent(id, 0, "payment.limit_violation", {
      outcome: "failure",
      attrs: { error_code: "session_total_exceeded" },
    });
    const old = {
      ...recent,
      event_id: ulid(),
      occurred_at: new Date(Date.parse(AS_OF) - 120 * DAY_MS).toISOString(),
    };

    expect(
      scoreValue(scoreAgent([...history, recent], id, AS_OF)),
    ).toBeLessThan(scoreValue(scoreAgent([...history, old], id, AS_OF)));
  });
});
