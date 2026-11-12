import { describe, expect, test } from "bun:test";
import {
  generateSimulation,
  SIMULATION_ANCHOR_MS,
} from "../../sim/src/generator";
import type { BehaviorEvent } from "../src/events";
import { extractFeatures } from "../src/features";
import {
  buildReasonCodes,
  REASON_CODES,
  type ReasonCodeKey,
} from "../src/reasons";
import { DAY_MS, MANIPULATION_PENALTY } from "../src/weights";

const AS_OF = SIMULATION_ANCHOR_MS;
type Features = ReturnType<typeof extractFeatures>;
type Overrides = {
  factors?: Partial<Features["factors"]>;
  metrics?: Partial<Features["metrics"]>;
  evidence?: Partial<Features["evidence"]>;
};
let sequence = 0;

function event(
  type: BehaviorEvent["type"],
  fields: Partial<BehaviorEvent> = {},
  daysAgo = 1,
): BehaviorEvent {
  return {
    event_id: `${"0".repeat(20)}${String(++sequence).padStart(6, "0")}`,
    subject: { afc_id: "afc:test:reasons" },
    source: "simulator",
    simulated: true,
    attestation: "self_reported",
    type,
    occurred_at: new Date(AS_OF - daysAgo * DAY_MS).toISOString(),
    ...fields,
  };
}

function verdict(
  score = 50,
  daysAgo = 1,
  evalId = `recorded-eval-${sequence}`,
): BehaviorEvent {
  return event(
    "work.evaluated",
    {
      source: "reppo",
      simulated: false,
      attestation: "platform_signed",
      attrs: {
        reppo_score: score,
        confidence: "high",
        decision: "accept",
        manipulation: true,
      },
      evidence: { eval_id: evalId },
    },
    daysAgo,
  );
}

function fixture(overrides: Overrides = {}): Features {
  const base = extractFeatures([], AS_OF, 90);
  return {
    ...base,
    factors: { ...base.factors, Q: 0.7, ...overrides.factors },
    metrics: {
      ...base.metrics,
      verdictCount: 10,
      ownerLinked: true,
      ...overrides.metrics,
    },
    evidence: { ...base.evidence, ...overrides.evidence },
  };
}

const quality = verdict();
const payment = event("payment.sent", {
  counterparty: { id: "merchant-a", kind: "merchant" },
});
const failed = event("payment.failed", { outcome: "failure" });
const dispute = event("payment.dispute");
const violation = event("payment.limit_violation", {
  attrs: { error_code: "session_total_exceeded" },
});
const probe = event("probe.uptime", {
  attrs: { uptime: 0.8, latency_ms: 4000 },
});
const task = event("task.failed");
const identity = event("identity.registered");
const funding = event("payment.received", {
  counterparty: { id: "funder-a", kind: "user" },
});

const triggerCases: {
  code: ReasonCodeKey;
  overrides: Overrides;
  ageDays?: number;
}[] = [
  {
    code: "Q01",
    overrides: { factors: { Q: 0.4 }, evidence: { quality: [quality] } },
  },
  {
    code: "Q02",
    overrides: {
      metrics: { rejectReviseRate: 0.4 },
      evidence: { quality: [quality] },
    },
  },
  {
    code: "Q03",
    overrides: {
      metrics: { verdictCount: 2 },
      evidence: { quality: [quality] },
    },
  },
  { code: "Q04", overrides: { evidence: { manipulation: [quality] } } },
  { code: "P01", overrides: { evidence: { violations: [violation] } } },
  {
    code: "P02",
    overrides: {
      metrics: { failRate: 0.06 },
      evidence: { failures: [failed] },
    },
  },
  {
    code: "P03",
    overrides: {
      metrics: { disputeRefundRate: 0.03 },
      evidence: { disputes: [dispute] },
    },
  },
  {
    code: "P04",
    overrides: {
      metrics: { counterpartyEntropy: 0.2 },
      evidence: { payments: [payment] },
    },
  },
  {
    code: "L01",
    overrides: { metrics: { uptime: 0.9 }, evidence: { probes: [probe] } },
  },
  {
    code: "L02",
    overrides: {
      metrics: { completionRate: 0.8 },
      evidence: { tasks: [task] },
    },
  },
  {
    code: "C01",
    overrides: { metrics: { spendCv: 1.3 }, evidence: { spend: [payment] } },
  },
  {
    code: "C02",
    overrides: {
      metrics: { qualityStdev: 16 },
      evidence: { quality: [quality] },
    },
  },
  {
    code: "C03",
    overrides: {
      metrics: { driftScore: 0.6 },
      evidence: { quality: [quality] },
    },
  },
  {
    code: "I01",
    overrides: { evidence: { identity: [identity] } },
    ageDays: 5,
  },
  {
    code: "I02",
    overrides: {
      metrics: { fundingDiversity: 0.2 },
      evidence: { funding: [funding] },
    },
  },
  {
    code: "I03",
    overrides: {
      metrics: { ownerLinked: false },
      evidence: { identity: [identity] },
    },
  },
  ...(["F01", "F02", "F03"] as const).map((code) => ({
    code,
    overrides: {
      evidence: {
        anomalies: [
          event("anomaly.flagged", {
            attrs: { reason_code: code, severity: 0.5 },
          }),
        ],
      },
    },
  })),
];

describe("canonical reason codes", () => {
  test("publishes all 23 unique code keys and serializable descriptions and triggers", () => {
    expect(REASON_CODES.map(({ key }) => key)).toEqual([
      ...triggerCases.map(({ code }) => code),
      "F04",
      "F05",
      "F06",
      "F07",
    ]);
    expect(new Set(REASON_CODES.map(({ key }) => key)).size).toBe(23);
    expect(JSON.parse(JSON.stringify(REASON_CODES))).toEqual(REASON_CODES);
    for (const metadata of REASON_CODES) {
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.trigger.length).toBeGreaterThan(0);
    }
  });

  for (const { code, overrides, ageDays = 90 } of triggerCases) {
    test(`${code} triggers with its actual normalized evidence`, () => {
      const features = fixture(overrides);
      const reasons = buildReasonCodes(features, ageDays, AS_OF, []);
      const reason = reasons.find((item) => item.code === code);
      expect(reason?.direction).toBe("hurts");
      expect(reason?.events.length).toBeGreaterThan(0);
      const actualIds = Object.values(features.evidence)
        .flat()
        .map((item) => item.event_id);
      expect(reason?.events.every((id) => actualIds.includes(id))).toBe(true);
    });
  }

  test("uses strict adverse threshold boundaries and leaves null observations unclaimed", () => {
    const features = fixture({
      factors: { Q: 0.6 },
      metrics: {
        verdictCount: 3,
        rejectReviseRate: 0.3,
        failRate: 0.05,
        disputeRefundRate: 0.02,
        counterpartyEntropy: 0.3,
        uptime: 0.95,
        p50Ms: 3000,
        completionRate: 0.85,
        spendCv: 1.2,
        qualityStdev: 15,
        driftScore: 0.5,
        fundingDiversity: 0.3,
      },
      evidence: {
        quality: [quality],
        payments: [payment],
        failures: [failed],
        disputes: [dispute],
        probes: [probe],
        tasks: [task],
        spend: [payment],
        funding: [funding],
        identity: [identity],
      },
    });
    expect(buildReasonCodes(features, 30, AS_OF, [identity])).toEqual([]);
    expect(buildReasonCodes(fixture(), 90, AS_OF, [])).toEqual([]);
  });

  test("latency independently triggers L01", () => {
    const features = fixture({
      metrics: { uptime: 1, p50Ms: 3001 },
      evidence: { probes: [probe] },
    });
    expect(
      buildReasonCodes(features, 90, AS_OF, []).map(({ code }) => code),
    ).toEqual(["L01"]);
  });

  test("Atlas helps with truthful Q01/P04 text and no invented real eval IDs", () => {
    const history = generateSimulation({ seed: 42, personas: ["atlas"] });
    const features = extractFeatures(history, AS_OF, 60);
    const helps = buildReasonCodes(features, 60, AS_OF, history).filter(
      (item) => item.direction === "helps",
    );
    expect(helps.map(({ code }) => code)).toEqual(["Q01", "P04"]);
    expect(helps[0]?.text).toBe("Sampled work quality is high.");
    expect(helps[1]?.text).toBe(
      "Observed payment activity spans diverse counterparties.",
    );
    for (const reason of helps) {
      expect(reason.text).not.toMatch(/independent|live|low|not very/i);
      expect(reason.events.length).toBeGreaterThan(0);
      expect(reason.eval_ids).toEqual([]);
    }
  });

  test("positive metrics require supporting normalized evidence and diverse actual counterparties", () => {
    const unsupported = fixture({
      factors: { Q: 0.99 },
      metrics: { counterpartyEntropy: 1 },
    });
    expect(
      buildReasonCodes(unsupported, 90, AS_OF, [quality, payment]),
    ).toEqual([]);
    unsupported.evidence.payments = [payment];
    expect(
      buildReasonCodes(unsupported, 90, AS_OF, []).filter(
        (item) => item.direction === "helps",
      ),
    ).toEqual([]);
  });

  test("raw invalid verdicts never enter quality reasons or their eval links", () => {
    const valid = verdict(90, 1, "actual-eval");
    const invalid = event("work.evaluated", {
      source: "reppo",
      attrs: { reppo_score: 101 },
      evidence: { eval_id: "invalid-raw-eval" },
    });
    const history = [valid, invalid];
    const features = extractFeatures(history, AS_OF, 90);
    const reason = buildReasonCodes(features, 90, AS_OF, history).find(
      (item) => item.code === "Q01",
    );
    expect(reason?.direction).toBe("helps");
    expect(reason?.events).toEqual([valid.event_id]);
    expect(reason?.eval_ids).toEqual(["actual-eval"]);
  });

  test("P03 preserves all normalized disputed and reversed payment evidence", () => {
    const disputes = [
      dispute,
      event("payment.refund"),
      event("payment.sent", { outcome: "disputed" }),
      event("payment.received", { outcome: "reversed" }),
    ];
    const features = fixture({
      metrics: { disputeRefundRate: 0.1 },
      evidence: { disputes },
    });
    const reason = buildReasonCodes(features, 90, AS_OF, []).find(
      (item) => item.code === "P03",
    );
    expect(reason?.events).toEqual(
      disputes.map((item) => item.event_id).sort(),
    );
  });

  test("Q04 cites only deduplicated manipulation evidence inside the 60-day window", () => {
    const current = verdict(80, 1, "current-eval");
    const boundary = verdict(80, MANIPULATION_PENALTY.days, "boundary-eval");
    const old = verdict(80, MANIPULATION_PENALTY.days + 1 / DAY_MS, "old-eval");
    const future = verdict(80, -1 / DAY_MS, "future-eval");
    const features = fixture({
      evidence: { manipulation: [old, future, current, boundary, current] },
    });
    const reason = buildReasonCodes(features, 90, AS_OF, [
      old,
      future,
      current,
      boundary,
    ]).find((item) => item.code === "Q04");
    expect(reason?.events).toEqual(
      [current.event_id, boundary.event_id].sort(),
    );
    expect(reason?.eval_ids).toEqual(["boundary-eval", "current-eval"]);
    features.evidence.manipulation = [old, future];
    expect(buildReasonCodes(features, 90, AS_OF, [])).toEqual([]);
  });

  test("P01 ignores old and future violations", () => {
    const recent = event("payment.limit_violation", {}, 90);
    const old = event("payment.limit_violation", {}, 90 + 1 / DAY_MS);
    const future = event("payment.limit_violation", {}, -1);
    const features = fixture({
      evidence: { violations: [recent, old, future] },
    });
    expect(buildReasonCodes(features, 90, AS_OF, [])[0]?.events).toEqual([
      recent.event_id,
    ]);
  });

  test("absence reasons cite observed history and disappear when there is no evidence", () => {
    const history = [event("task.completed"), event("payment.sent")];
    const features = fixture({
      metrics: { verdictCount: 0, ownerLinked: false },
    });
    const reasons = buildReasonCodes(features, 90, AS_OF, history);
    expect(reasons.map(({ code }) => code).sort()).toEqual(["I03", "Q03"]);
    for (const reason of reasons) {
      expect(reason.events).toEqual(
        history.map((item) => item.event_id).sort(),
      );
      expect(reason.eval_ids).toEqual([]);
    }
    expect(buildReasonCodes(features, 0, AS_OF, [])).toEqual([]);
  });

  test("C03 cites only normalized quality in the drift window, not unrelated raw history", () => {
    const old = verdict(95, 100);
    const history = [quality, old, payment, identity, probe];
    const features = fixture({
      metrics: { driftScore: 0.9 },
      evidence: { quality: [old, quality] },
    });
    const reason = buildReasonCodes(features, 90, AS_OF, history).find(
      (item) => item.code === "C03",
    );
    expect(reason?.events).toEqual([quality.event_id]);
  });

  test("fraud reasons come only from normalized anomalies, with stable ASCII ties", () => {
    const anomalies = (["F03", "F02", "F01"] as const).map((code) =>
      event("anomaly.flagged", { attrs: { reason_code: code, severity: 1 } }),
    );
    const rawFlag = event("anomaly.flagged", {
      attrs: { reason_code: "F01", severity: 1 },
    });
    expect(
      buildReasonCodes(fixture({ factors: { F: 0 } }), 90, AS_OF, [rawFlag]),
    ).toEqual([]);
    const features = fixture({ evidence: { anomalies } });
    const snapshot = JSON.stringify(features);
    const first = buildReasonCodes(features, 90, AS_OF, [rawFlag]);
    expect(first.map(({ code }) => code)).toEqual(["F01", "F02", "F03"]);
    expect(first.flatMap((item) => item.events)).not.toContain(
      rawFlag.event_id,
    );
    expect(JSON.stringify(features)).toBe(snapshot);
    const reversed = fixture({
      evidence: { anomalies: [...anomalies].reverse() },
    });
    expect(buildReasonCodes(reversed, 90, AS_OF, [rawFlag])).toEqual(first);
  });

  test("caps outputs at four hurts and two helps using weighted impact", () => {
    const highQuality = verdict(95);
    const secondPayment = event("payment.sent", {
      counterparty: { id: "merchant-b", kind: "merchant" },
    });
    const anomalies = (["F03", "F02", "F01"] as const).map((code) =>
      event("anomaly.flagged", { attrs: { reason_code: code, severity: 1 } }),
    );
    const features = fixture({
      factors: { Q: 0.95 },
      metrics: {
        counterpartyEntropy: 1,
        uptime: 0,
        p50Ms: 6000,
        completionRate: 0,
        spendCv: 2,
        qualityStdev: 30,
        driftScore: 1,
        ownerLinked: false,
      },
      evidence: {
        quality: [highQuality],
        payments: [payment, secondPayment],
        probes: [probe],
        tasks: [task],
        spend: [payment],
        identity: [identity],
        anomalies,
      },
    });
    const reasons = buildReasonCodes(features, 90, AS_OF, []);
    expect(
      reasons
        .filter((item) => item.direction === "hurts")
        .map(({ code }) => code),
    ).toEqual(["F01", "F02", "F03", "L01"]);
    expect(
      reasons
        .filter((item) => item.direction === "helps")
        .map(({ code }) => code),
    ).toEqual(["Q01", "P04"]);
    expect(reasons).toHaveLength(6);
    expect(reasons.every((item) => item.events.length > 0)).toBe(true);
  });

  test("eval IDs use exact Reppo evidence only, deduplicate and sort with ASCII order", () => {
    const first = verdict(90, 1, "Z-eval");
    const second = verdict(90, 1, "a-eval");
    const synthetic = event("work.evaluated", {
      attrs: { reppo_score: 90, eval_id: "fake-attr-id" },
      evidence: { eval_id: "fake-sim-id" },
    });
    const features = fixture({
      factors: { Q: 0.9 },
      evidence: { quality: [second, synthetic, first, first] },
    });
    const reason = buildReasonCodes(features, 90, AS_OF, [])[0];
    expect(reason?.eval_ids).toEqual(["Z-eval", "a-eval"]);
    expect(reason?.events).toEqual(
      [first.event_id, second.event_id, synthetic.event_id].sort(),
    );
  });
});
