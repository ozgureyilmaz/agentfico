import { expect, test } from "bun:test";
import { type BehaviorEvent, detectFraud, scoreAgent } from "../src";

const id = "afc:kite:target";
const peer = "afc:kite:peer";
const start = Date.parse("2026-11-11T08:00:00Z");
const end = start + 60 * 60_000;

function event(
  index: number,
  type: BehaviorEvent["type"],
  patch: Partial<BehaviorEvent> = {},
  minutes = index,
): BehaviorEvent {
  return {
    event_id: String(index).padStart(26, "0"),
    subject: { afc_id: id },
    occurred_at: new Date(start + minutes * 60_000).toISOString(),
    source: "kite_chain",
    attestation: "onchain",
    simulated: false,
    type,
    ...patch,
  };
}

function payment(
  index: number,
  type: "payment.sent" | "payment.received",
  value = "40",
) {
  return event(index, type, {
    amount: { value, currency: "USDC", decimals: 6 },
    counterparty: { id: peer, kind: "unknown" },
    outcome: "success",
  });
}

function finding(events: BehaviorEvent[], code: string) {
  return detectFraud(events, { afcId: id, asOfMs: end }).find(
    (item) => item.code === code,
  );
}

test("F01 caps a verified two-leg cycle and excludes unequal or self-reported transfers", () => {
  const sent = payment(1, "payment.sent");
  const returned = payment(2, "payment.received");
  const history = [event(0, "identity.registered"), sent, returned];
  expect(finding(history.toReversed(), "F01")).toMatchObject({
    severity: 1,
    confirmed: true,
    source_event_ids: [sent.event_id, returned.event_id],
  });
  expect(
    scoreAgent(history, id, new Date(end).toISOString()).score,
  ).toBeLessThanOrEqual(549);
  expect(
    finding([sent, payment(2, "payment.received", "20")], "F01"),
  ).toBeUndefined();
  expect(
    finding([sent, { ...returned, attestation: "self_reported" }], "F01"),
  ).toBeUndefined();
  expect(
    finding([{ ...sent, counterparty: { id, kind: "unknown" } }], "F01"),
  ).toBeDefined();
});

test("F02 requires a shared funder and five distinct recent identities", () => {
  const members = [
    id,
    ...[1, 2, 3, 4].map((index) => `afc:kite:member-${index}`),
  ];
  const events = members.flatMap((afc_id, index) => [
    event(index * 2, "identity.registered", { subject: { afc_id } }),
    { ...payment(index * 2 + 1, "payment.received"), subject: { afc_id } },
  ]);
  expect(finding(events, "F02")).toMatchObject({
    confirmed: true,
    severity: 1,
  });
  expect(finding(events.slice(0, -2), "F02")).toBeUndefined();
  expect(
    finding(
      [
        ...events,
        event(
          99,
          "identity.registered",
          { subject: { afc_id: members[4] } },
          -31 * 24 * 60,
        ),
      ],
      "F02",
    ),
  ).toBeUndefined();
});

test("F04 requires both a high transfer count and a high value within ten minutes", () => {
  const payments = Array.from({ length: 8 }, (_, index) =>
    payment(index, "payment.sent"),
  );
  expect(finding(payments, "F04")).toMatchObject({
    severity: 0.5,
    confirmed: false,
  });
  expect(finding(payments.slice(1), "F04")).toBeUndefined();
  expect(
    finding(
      payments.map((_, index) => payment(index, "payment.sent", "1")),
      "F04",
    ),
  ).toBeUndefined();
});

test("F05 requires distinct, verified and nearly identical evaluation results", () => {
  const evals = Array.from({ length: 5 }, (_, index) =>
    event(index, "work.evaluated", {
      source: "reppo",
      attestation: "platform_signed",
      evidence: { eval_id: `eval-${index}` },
      attrs: { reppo_score: 85, decision: "accept" },
    }),
  );
  expect(finding(evals, "F05")?.eval_ids).toHaveLength(5);
  expect(
    finding(
      evals.map((value, index) => ({
        ...value,
        attrs: { reppo_score: 85 + index, decision: "accept" },
      })),
      "F05",
    ),
  ).toBeUndefined();
  expect(
    finding(
      evals.map((value) => ({ ...value, evidence: { eval_id: "same-eval" } })),
      "F05",
    ),
  ).toBeUndefined();
});

test("F06 counts distinct, verified links in a recent window", () => {
  const links = Array.from({ length: 3 }, (_, index) =>
    event(index, "identity.linked", {
      subject: { afc_id: id, links: { passport_id: `passport-${index}` } },
    }),
  );
  expect(finding(links, "F06")?.source_event_ids).toHaveLength(3);
  expect(
    finding(
      links.map((value) => ({ ...value, subject: links[0].subject })),
      "F06",
    ),
  ).toBeUndefined();
  expect(
    finding(
      links.map((value) => ({ ...value, attestation: "self_reported" })),
      "F06",
    ),
  ).toBeUndefined();
});

test("F07 requires repeated distinct adverse payment records above the rate threshold", () => {
  const payments = Array.from({ length: 5 }, (_, index) =>
    payment(index, "payment.sent"),
  );
  const refunds = [
    event(5, "payment.refund", { outcome: "reversed" }),
    event(6, "payment.dispute", { outcome: "disputed" }),
    event(7, "payment.refund", { outcome: "reversed" }),
  ];
  expect(finding([...payments, ...refunds], "F07")).toMatchObject({
    severity: 0.5,
    metrics: { adverse_rate: 0.6 },
  });
  expect(finding([...payments, ...refunds.slice(1)], "F07")).toBeUndefined();
});
