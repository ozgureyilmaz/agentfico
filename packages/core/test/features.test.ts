import { describe, expect, test } from "bun:test";
import type { BehaviorEvent } from "../src/events";
import { type ExtractedFeatures, extractFeatures } from "../src/features";

const DAY_MS = 86_400_000;
const AS_OF = Date.parse("2026-11-05T12:00:00.000Z");
let serial = 0;

function event(
  type: BehaviorEvent["type"],
  fields: Partial<BehaviorEvent> = {},
): BehaviorEvent {
  return {
    event_id: (serial++).toString(16).toUpperCase().padStart(26, "0"),
    subject: { afc_id: "afc:test:features" },
    type,
    source: "simulator",
    simulated: true,
    attestation: "onchain",
    occurred_at: new Date(AS_OF).toISOString(),
    ...fields,
  };
}

function daysAgo(days: number): string {
  return new Date(AS_OF - days * DAY_MS).toISOString();
}

function verdict(
  score: number,
  decision = "accept",
  confidence = "high",
  fields: Partial<BehaviorEvent> = {},
): BehaviorEvent {
  return event("work.evaluated", {
    source: "reppo",
    attestation: "platform_signed",
    evidence: { eval_id: `eval-${serial}` },
    attrs: { reppo_score: score, confidence, decision },
    ...fields,
  });
}

function payment(
  amount: string,
  fields: Partial<BehaviorEvent> = {},
): BehaviorEvent {
  return event("payment.sent", {
    amount: { value: amount, currency: "USD", decimals: 6 },
    counterparty: { id: "merchant:a", kind: "merchant" },
    outcome: "success",
    ...fields,
  });
}

function extract(events: readonly BehaviorEvent[]): ExtractedFeatures {
  return extractFeatures(events, AS_OF, 365);
}

function expectFinite(result: ExtractedFeatures): void {
  for (const value of Object.values(result.factors)) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  for (const value of Object.values(result.metrics)) {
    if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
  expect(Number.isInteger(result.metrics.verdictCount)).toBe(true);
  expect(Number.isFinite(result.simulatedShare)).toBe(true);
}

describe("extractFeatures", () => {
  test("Q mean applies 60-day decay, attestation, and confidence; count stays integer", () => {
    const result = extract([
      verdict(20, "accept", "low", { occurred_at: daysAgo(60) }),
      verdict(100, "accept", "high", { attestation: "self_reported" }),
    ]);
    // Old weight .8 * .5 * .4 = .16; current weight .5 * 1 = .5.
    expect(result.factors.Q).toBeCloseTo((0.2 * 0.16 + 1 * 0.5) / 0.66, 12);
    expect(result.metrics.verdictCount).toBe(2);
    // Dispersion uses event weights .4 and .5, without confidence multipliers.
    expect(result.metrics.qualityStdev).toBeCloseTo(
      Math.sqrt((80 ** 2 * 0.4 * 0.5) / 0.9 ** 2),
      12,
    );
  });

  test("Q penalizes only rejects; Q02 combines reject/revise using event weights alone", () => {
    const result = extract([
      verdict(20, "reject", "low", { occurred_at: daysAgo(60) }),
      verdict(100, "revise", "high", { attestation: "self_reported" }),
      verdict(60, "accept", "medium", { attestation: "onchain" }),
    ]);
    // Quality mean is .7; decisions have weights .4, .5, and 1.
    expect(result.factors.Q).toBeCloseTo(0.7 - 0.25 * (0.4 / 1.9), 12);
    expect(result.metrics.rejectReviseRate).toBeCloseTo(0.9 / 1.9, 12);
    expect(extract([verdict(80, "revise")]).factors.Q).toBeCloseTo(0.8, 12);
  });

  test("quality evidence accepts real Reppo IDs and explicitly labeled synthetic verdicts", () => {
    const real = verdict(80);
    const synthetic = verdict(70, "accept", "low", {
      source: "simulator",
      evidence: undefined,
      attrs: {
        reppo_score: 70,
        decision: "accept",
        confidence: "low",
        evaluation_origin: "synthetic_simulation",
        evaluation_status: "synthetic_not_reppo",
      },
    });
    const result = extract([
      real,
      synthetic,
      verdict(100, "accept", "high", { source: "assistant" }),
      verdict(100, "accept", "high", { source: "simulator" }),
      verdict(100, "accept", "high", { evidence: { eval_id: " " } }),
      { ...synthetic, simulated: false },
    ]);
    expect(result.evidence.quality).toEqual([real, synthetic]);
    expect(result.metrics.verdictCount).toBe(2);
  });

  test("Q04 requires Reppo, a real eval ID, a boolean flag, and platform attestation", () => {
    const trusted = verdict(80, "accept", "high", {
      simulated: true,
      occurred_at: daysAgo(100),
      attrs: { manipulation: true },
    });
    const result = extract([
      trusted,
      { ...trusted, attestation: "self_reported" },
      { ...trusted, attestation: "onchain" },
      { ...trusted, source: "assistant" },
      { ...trusted, evidence: undefined },
      { ...trusted, attrs: { manipulation: "true" } },
    ]);
    // All qualifying history is exposed; the caller applies the penalty window.
    expect(result.evidence.manipulation).toEqual([trusted]);
  });

  test("payment ratios and entropy apply attestation and the correct half-lives", () => {
    const result = extract([
      payment("10", { occurred_at: daysAgo(90) }), // positive: .5
      event("payment.failed", {
        occurred_at: daysAgo(120),
        attestation: "self_reported",
        counterparty: { id: "merchant:a", kind: "merchant" },
      }), // adverse: .25
      event("payment.received", {
        attestation: "platform_signed",
        counterparty: { id: "merchant:b", kind: "merchant" },
      }), // .8
      event("payment.refund", {
        occurred_at: daysAgo(120),
        attestation: "platform_signed",
      }), // adverse: .4
    ]);
    const probabilityA = 0.75 / 1.55;
    const probabilityB = 0.8 / 1.55;
    const entropy =
      -(
        probabilityA * Math.log(probabilityA) +
        probabilityB * Math.log(probabilityB)
      ) / Math.log(2);
    expect(result.metrics.failRate).toBeCloseTo(0.25 / 1.55, 12);
    expect(result.metrics.disputeRefundRate).toBeCloseTo(0.4 / 1.55, 12);
    expect(result.metrics.counterpartyEntropy).toBeCloseTo(entropy, 12);
    expect(result.metrics.fundingDiversity).toBe(0);
    expect(result.factors.P).toBeCloseTo(
      0.4 * (1 - 0.25 / 1.55) + 0.3 + 0.15 * entropy,
      12,
    );
  });

  test("disputed/reversed attempts count as disputes and earn no spend credit", () => {
    const disputed = payment("100", { outcome: "disputed" });
    const reversed = payment("200", { outcome: "reversed" });
    const received = event("payment.received", { outcome: "disputed" });
    const ordinary = payment("10");
    const refund = event("payment.refund");
    const dispute = event("payment.dispute");
    const result = extract([
      disputed,
      reversed,
      received,
      ordinary,
      refund,
      dispute,
    ]);
    expect(result.evidence.disputes).toEqual([
      disputed,
      reversed,
      received,
      refund,
      dispute,
    ]);
    expect(result.evidence.spend).toEqual([ordinary]);
    expect(result.evidence.payments).toHaveLength(4);
    expect(result.metrics.disputeRefundRate).toBe(1); // Count ratio saturates at 1.
    expect(result.metrics.failRate).toBe(0);
  });

  test("reliability uses weighted uptime, lower weighted median, and failed user reversals", () => {
    const result = extract([
      event("probe.uptime", { attrs: { uptime: 1, latency_ms: 900 } }),
      event("probe.uptime", {
        occurred_at: daysAgo(120),
        attestation: "self_reported",
        outcome: "failure",
        attrs: { uptime: 0, latency_ms: 5000 },
      }),
      event("task.completed", { occurred_at: daysAgo(90) }),
      event("action.reversed_by_user", {
        occurred_at: daysAgo(120),
        attestation: "platform_signed",
      }),
    ]);
    expect(result.metrics.uptime).toBeCloseTo(1 / 1.25, 12);
    expect(result.metrics.p50Ms).toBe(900);
    expect(result.metrics.completionRate).toBeCloseTo(0.5 / 0.9, 12);
    expect(result.factors.L).toBeCloseTo(
      0.4 * 0.8 + 0.2 * (1 - 100 / 4200) + 0.4 * (0.5 / 0.9),
      12,
    );
    expect(
      extract([
        event("probe.latency", { attrs: { latency_ms: 100 } }),
        event("probe.latency", { attrs: { latency_ms: 300 } }),
      ]).metrics.p50Ms,
    ).toBe(100);
  });

  test("spend CV sums weighted amounts into UTC days and includes empty calendar days", () => {
    const timestamps = [
      "2026-11-03T23:59:00Z",
      "2026-11-04T00:01:00Z",
      "2026-11-04T23:59:00Z",
    ];
    const events = [
      payment("10", { occurred_at: timestamps[0] }),
      payment("20", {
        occurred_at: timestamps[1],
        attestation: "self_reported",
      }),
      payment("30", {
        occurred_at: timestamps[2],
        attestation: "platform_signed",
      }),
    ];
    const decay = (time: string) =>
      2 ** (-((AS_OF - Date.parse(time)) / DAY_MS) / 90);
    const totals = [
      10 * decay(timestamps[0]),
      20 * 0.5 * decay(timestamps[1]) + 30 * 0.8 * decay(timestamps[2]),
      0,
    ];
    const mean = totals.reduce((sum, amount) => sum + amount, 0) / 3;
    const variance =
      totals.reduce((sum, amount) => sum + (amount - mean) ** 2, 0) / 3;
    expect(extract(events).metrics.spendCv).toBeCloseTo(
      Math.sqrt(variance) / mean,
      12,
    );
  });

  test("sparse spending includes zero days but bins are bounded to 90 days", () => {
    const sparse = extract([payment("10", { occurred_at: daysAgo(3) })]);
    expect(sparse.metrics.spendCv).toBeCloseTo(Math.sqrt(3), 12);
    const bounded = extract([
      payment("10", { occurred_at: daysAgo(200) }),
      payment("10"),
    ]);
    expect(bounded.metrics.spendCv).toBeCloseTo(Math.sqrt(89), 12);
  });

  test("drift compares recent 14 UTC days with the preceding 46 days and only penalizes decline", () => {
    const result = extract([
      verdict(90, "accept", "high", { occurred_at: daysAgo(14) }),
      verdict(30, "accept", "low", { occurred_at: daysAgo(13) }),
      verdict(0, "reject", "high", { occurred_at: daysAgo(60) }),
    ]);
    expect(result.metrics.driftScore).toBeCloseTo(0.6, 12);
    expect(
      extract([
        verdict(30, "accept", "high", { occurred_at: daysAgo(14) }),
        verdict(90, "accept", "low", { occurred_at: daysAgo(13) }),
      ]).metrics.driftScore,
    ).toBe(0);
    expect(extract([verdict(90)]).metrics.driftScore).toBeNull();
  });

  test("missing data stays nullable with neutral components and no unobserved Q penalty", () => {
    const result = extractFeatures([], AS_OF, 0);
    expect(result.metrics).toEqual({
      verdictCount: 0,
      rejectReviseRate: null,
      failRate: null,
      disputeRefundRate: null,
      counterpartyEntropy: null,
      uptime: null,
      p50Ms: null,
      completionRate: null,
      spendCv: null,
      qualityStdev: null,
      driftScore: null,
      fundingDiversity: null,
      ownerLinked: false,
    });
    expect(result.factors).toEqual({
      Q: 0.5,
      P: 0.5,
      L: 0.5,
      C: 0.5,
      I: 0.1,
      F: 1,
    });
    expect(result.simulatedShare).toBe(0);
    const scoreWithoutConfidence = verdict(80, "reject", "unknown");
    const partial = extract([scoreWithoutConfidence]);
    expect(partial.metrics.verdictCount).toBe(1);
    expect(partial.metrics.rejectReviseRate).toBe(1);
    expect(partial.factors.Q).toBe(0.5);
  });

  test("violation and anomaly evidence never improve or contaminate unrelated factors", () => {
    const ordinary = payment("10");
    const baseline = extract([ordinary]);
    const violation = event("payment.limit_violation", {
      outcome: "failure",
      amount: { value: "1000", currency: "USD", decimals: 6 },
      counterparty: { id: "unrelated", kind: "merchant" },
      attrs: { uptime: 1, latency_ms: 1, reppo_score: 100 },
    });
    const anomaly = event("anomaly.flagged", {
      occurred_at: daysAgo(365),
      attestation: "self_reported",
      attrs: { reason_code: "F01", severity: 0.5 },
    });
    const withViolation = extract([ordinary, violation]);
    const withAnomaly = extract([ordinary, anomaly]);
    expect(withViolation.factors.P).toBeLessThanOrEqual(baseline.factors.P);
    for (const factor of ["Q", "L", "C", "I", "F"] as const) {
      expect(withViolation.factors[factor]).toBe(baseline.factors[factor]);
    }
    expect(withViolation.evidence.failures).toHaveLength(0);
    expect(withViolation.evidence.spend).toEqual([ordinary]);
    expect(withAnomaly.factors.F).toBeCloseTo(1 - 0.5 * 0.5 * 0.5, 12);
    for (const factor of ["Q", "P", "L", "C", "I"] as const) {
      expect(withAnomaly.factors[factor]).toBe(baseline.factors[factor]);
    }
    expect(extract([event("payment.dispute")]).metrics.disputeRefundRate).toBe(
      1,
    );
    expect(extract([violation]).factors.P).toBeLessThan(0.5);
  });

  test("unknown attrs are never coerced and malformed anomalies stay out of evidence", () => {
    for (const invalid of [
      "99",
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
      {},
      [],
      true,
      5n,
      Symbol("value"),
    ]) {
      const result = extract([
        verdict(80, "accept", "high", {
          attrs: { reppo_score: invalid, confidence: "high" },
        }),
        event("probe.uptime", {
          attrs: { uptime: invalid, latency_ms: invalid },
        }),
        event("anomaly.flagged", {
          attrs: { reason_code: "F01", severity: invalid },
        }),
      ]);
      expect(result.evidence.quality).toHaveLength(0);
      expect(result.evidence.anomalies).toHaveLength(0);
      expect(result.metrics.uptime).toBeNull();
      expect(result.metrics.p50Ms).toBeNull();
      expectFinite(result);
    }
    const inherited = Object.create({
      reppo_score: 100,
      confidence: "high",
      uptime: 1,
      severity: 1,
      reason_code: "F01",
    });
    expect(
      extract([verdict(80, "accept", "high", { attrs: inherited })]).evidence
        .quality,
    ).toHaveLength(0);
    expect(
      extract([
        event("anomaly.flagged", {
          attrs: { reason_code: "Q04", severity: 1 },
        }),
      ]).evidence.anomalies,
    ).toHaveLength(0);
  });

  test("amount bound rejects huge decimal strings and supported totals remain finite", () => {
    const enormous = `1${"0".repeat(308)}`;
    const rejected = extract([payment(enormous), payment(enormous)]);
    expect(rejected.evidence.spend).toHaveLength(0);
    expect(rejected.metrics.spendCv).toBeNull();
    expectFinite(rejected);
    const maximum = String(Number.MAX_SAFE_INTEGER);
    const supported = extract([
      payment(maximum),
      payment(maximum),
      payment("1", { occurred_at: daysAgo(1) }),
    ]);
    expect(supported.evidence.spend).toHaveLength(3);
    expectFinite(supported);
  });

  test("owner verification is attested and simulated share includes every accepted event", () => {
    const owner = event("identity.linked", {
      attestation: "platform_signed",
      subject: { afc_id: "afc:test:features", links: { owner_ref: "owner:1" } },
    });
    expect(extract([owner]).metrics.ownerLinked).toBe(true);
    expect(
      extract([{ ...owner, attestation: "self_reported" }]).metrics.ownerLinked,
    ).toBe(false);
    const result = extract([
      event("identity.registered", { attestation: "self_reported" }),
      event("anomaly.flagged", {
        simulated: false,
        attestation: "platform_signed",
        attrs: { severity: "invalid" },
      }),
      event("payment.limit_violation", { simulated: false }),
    ]);
    expect(result.simulatedShare).toBeCloseTo(0.5 / 2.3, 12);
    expectFinite(result);
  });
});
