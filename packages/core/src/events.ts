import { z } from "zod";

const eventTypes = [
  "identity.registered",
  "identity.linked",
  "payment.sent",
  "payment.received",
  "payment.failed",
  "payment.limit_violation",
  "payment.refund",
  "payment.dispute",
  "work.evaluated",
  "work.probe_sent",
  "task.completed",
  "task.failed",
  "action.performed",
  "action.reversed_by_user",
  "action.complaint",
  "probe.uptime",
  "probe.latency",
  "anomaly.flagged",
] as const;

const linksSchema = z.strictObject({
  kite_address: z.string().optional(),
  passport_id: z.string().optional(),
  erc8004: z.string().optional(),
  reppo_account: z.string().optional(),
  assistant_id: z.string().optional(),
  owner_ref: z.string().optional(),
});

const afcIdSchema = z
  .string()
  .regex(
    /^afc:[a-z][a-z0-9_-]*:[^:\s]+$/,
    'Expected an AFC ID in "afc:<source>:<id>" form',
  );

const subjectSchema = z.strictObject({
  afc_id: afcIdSchema,
  links: linksSchema.optional(),
});

const evidenceSchema = z.strictObject({
  tx_hash: z.string().optional(),
  eval_id: z.string().optional(),
  url: z.string().optional(),
  log_hash: z.string().optional(),
});

export const EventTypeSchema = z.enum(eventTypes);
export type EventType = z.infer<typeof EventTypeSchema>;

export const BehaviorEventSchema = z.strictObject({
  event_id: z
    .ulid()
    .refine(
      (value) => value === value.toUpperCase(),
      "Expected a canonical uppercase ULID",
    ),
  subject: subjectSchema,
  source: z.enum([
    "kite_chain",
    "kite_passport",
    "reppo",
    "assistant",
    "probe",
    "simulator",
  ]),
  simulated: z.boolean(),
  attestation: z.enum(["self_reported", "platform_signed", "onchain"]),
  type: EventTypeSchema,
  occurred_at: z.iso.datetime(),
  amount: z
    .strictObject({
      value: z.string(),
      currency: z.enum(["USDC", "USD"]),
      decimals: z.literal(6),
    })
    .optional(),
  counterparty: z
    .strictObject({
      id: z.string(),
      kind: z.enum(["merchant", "agent", "user", "unknown"]),
    })
    .optional(),
  outcome: z.enum(["success", "failure", "reversed", "disputed"]).optional(),
  evidence: evidenceSchema.optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  prev_hash: z.string().optional(),
  sig: z.string().optional(),
});

export type BehaviorEvent = z.infer<typeof BehaviorEventSchema>;
