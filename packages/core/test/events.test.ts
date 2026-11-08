import { describe, expect, test } from "bun:test";
import {
  EventTypeSchema,
  BehaviorEventSchema as RootBehaviorEventSchema,
} from "../src";
import { type BehaviorEvent, BehaviorEventSchema } from "../src/events";

const validEvent = {
  event_id: "01JBF5V4R9X4Y5K7Q6M8N2P3AA",
  subject: {
    afc_id: "afc:sim:atlas",
    links: {
      kite_address: "0xabc123",
      owner_ref: "owner-1",
    },
  },
  source: "simulator",
  simulated: true,
  attestation: "self_reported",
  type: "payment.sent",
  occurred_at: "2026-11-05T12:30:45.123Z",
  amount: {
    value: "12.345678",
    currency: "USDC",
    decimals: 6,
  },
  counterparty: {
    id: "merchant-1",
    kind: "merchant",
  },
  outcome: "success",
  evidence: {
    tx_hash: "0xdef456",
    url: "https://example.test/receipt/1",
  },
  attrs: {
    reppo_score: 81,
    confidence: "high",
  },
  prev_hash: "abc123",
  sig: "signature",
} satisfies BehaviorEvent;

describe("BehaviorEventSchema", () => {
  test("parses the full event shape and exports its schema from the package root", () => {
    expect(BehaviorEventSchema).toBe(RootBehaviorEventSchema);
    expect(BehaviorEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  test("accepts every specified enum variant", () => {
    const sources = [
      "kite_chain",
      "kite_passport",
      "reppo",
      "assistant",
      "probe",
      "simulator",
    ] as const;
    const attestations = [
      "self_reported",
      "platform_signed",
      "onchain",
    ] as const;
    const outcomes = ["success", "failure", "reversed", "disputed"] as const;
    const counterpartyKinds = ["merchant", "agent", "user", "unknown"] as const;

    for (const source of sources) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, source }).success,
      ).toBe(true);
    }
    for (const attestation of attestations) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, attestation }).success,
      ).toBe(true);
    }
    for (const type of EventTypeSchema.options) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, type }).success,
      ).toBe(true);
    }
    for (const outcome of outcomes) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, outcome }).success,
      ).toBe(true);
    }
    for (const kind of counterpartyKinds) {
      expect(
        BehaviorEventSchema.safeParse({
          ...validEvent,
          counterparty: { id: "counterparty-1", kind },
        }).success,
      ).toBe(true);
    }
  });

  test("requires a canonical ULID", () => {
    expect(BehaviorEventSchema.safeParse(validEvent).success).toBe(true);
    for (const event_id of [
      "01jbf5v4r9x4y5k7q6m8n2p3aa",
      "81JBF5V4R9X4Y5K7Q6M8N2P3AA",
      "not-a-ulid",
    ]) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, event_id }).success,
      ).toBe(false);
    }
  });

  test("requires an AFC ID with source and identifier segments", () => {
    expect(BehaviorEventSchema.safeParse(validEvent).success).toBe(true);
    expect(
      BehaviorEventSchema.safeParse({
        ...validEvent,
        subject: { afc_id: "afc:asst:assistant-1" },
      }).success,
    ).toBe(true);

    for (const afc_id of [
      "atlas",
      "afc:sim",
      "afc::atlas",
      "afc:sim:has space",
    ]) {
      expect(
        BehaviorEventSchema.safeParse({
          ...validEvent,
          subject: { afc_id },
        }).success,
      ).toBe(false);
    }
  });

  test("accepts UTC ISO timestamps and rejects offsets, local time, and invalid dates", () => {
    for (const occurred_at of [
      "2026-11-05T12:30:45Z",
      "2026-11-05T12:30:45.123456Z",
    ]) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, occurred_at }).success,
      ).toBe(true);
    }
    for (const occurred_at of [
      "2026-11-05T12:30:45+00:00",
      "2026-11-05T12:30:45",
      "2026-02-30T12:30:45Z",
    ]) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, occurred_at }).success,
      ).toBe(false);
    }
  });

  test("validates amount strings, supported currencies, and six decimals", () => {
    expect(BehaviorEventSchema.safeParse(validEvent).success).toBe(true);
    for (const amount of [
      { value: 12.34, currency: "USD", decimals: 6 },
      { value: "12.34", currency: "EUR", decimals: 6 },
      { value: "12.34", currency: "USD", decimals: 18 },
    ]) {
      expect(
        BehaviorEventSchema.safeParse({ ...validEvent, amount }).success,
      ).toBe(false);
    }

    expect(
      BehaviorEventSchema.safeParse({
        ...validEvent,
        amount: { value: "12.34", currency: "USD", decimals: 6 },
      }).success,
    ).toBe(true);
  });

  test("accepts a minimal event without optional properties", () => {
    const minimalEvent = {
      event_id: validEvent.event_id,
      subject: { afc_id: "afc:kite:0xabc123" },
      source: "kite_chain",
      simulated: false,
      attestation: "onchain",
      type: "identity.registered",
      occurred_at: "2026-11-05T12:30:45Z",
    } satisfies BehaviorEvent;

    expect(BehaviorEventSchema.parse(minimalEvent)).toEqual(minimalEvent);
  });

  test("rejects undeclared top-level and nested fields", () => {
    expect(
      BehaviorEventSchema.safeParse({ ...validEvent, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      BehaviorEventSchema.safeParse({
        ...validEvent,
        subject: { ...validEvent.subject, unexpected: true },
      }).success,
    ).toBe(false);
  });
});
