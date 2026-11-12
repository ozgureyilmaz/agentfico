import { createHash } from "node:crypto";
import {
  type BehaviorEvent,
  BehaviorEventSchema,
  type EventType,
} from "@agentfico/core/events";
import { z } from "zod";

const agent = z.string().regex(/^afc:asst:[a-zA-Z0-9._-]{1,100}$/);
const sourceId = z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/);
const date = z.iso.datetime({ offset: true });
const reportedType = z.enum([
  "action.performed",
  "action.reversed_by_user",
  "action.complaint",
  "task.completed",
  "task.failed",
  "payment.sent",
  "payment.received",
  "payment.failed",
  "payment.refund",
  "payment.dispute",
]);
const paymentAmount = z.strictObject({
  value: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/),
  currency: z.enum(["USD", "USDC"]),
});
const generic = z.strictObject({
  format: z.literal("afc-assistant-v1"),
  agent_id: agent,
  id: sourceId,
  timestamp: date,
  type: reportedType,
  amount: paymentAmount.optional(),
  counterparty: sourceId.optional(),
  simulated: z.boolean().optional(),
});
const langChain = z.object({
  format: z.literal("langchain-stream-v2"),
  agent_id: agent,
  timestamp: date,
  event: z.enum(["on_chain_end", "on_tool_end"]),
  run_id: z.uuid(),
  parent_ids: z.array(z.uuid()).max(64),
  simulated: z.boolean().optional(),
});
const otlp = z.object({
  format: z.literal("otlp-span"),
  agent_id: agent,
  simulated: z.boolean().optional(),
  span: z.object({
    traceId: z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/i),
    spanId: z.string().regex(/^(?!0{16}$)[a-f0-9]{16}$/i),
    endTimeUnixNano: z.string().regex(/^[1-9]\d{0,19}$/),
    status: z.object({
      code: z.union([
        z.literal(1),
        z.literal(2),
        z.enum(["STATUS_CODE_OK", "STATUS_CODE_ERROR"]),
      ]),
    }),
  }),
});
const rawSchema = z.discriminatedUnion("format", [generic, langChain, otlp]);

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function eventId(time: number, hash: string): string {
  let value = (BigInt(time) << 80n) | BigInt(`0x${hash.slice(0, 20)}`);
  let result = "";
  for (let index = 0; index < 26; index++) {
    result = alphabet[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

const outcomes: Partial<Record<EventType, BehaviorEvent["outcome"]>> = {
  "action.performed": "success",
  "action.reversed_by_user": "reversed",
  "task.completed": "success",
  "task.failed": "failure",
  "payment.sent": "success",
  "payment.received": "success",
  "payment.failed": "failure",
  "payment.refund": "reversed",
  "payment.dispute": "disputed",
};

export function mapAssistantLog(value: unknown): BehaviorEvent | null {
  const parsed = rawSchema.safeParse(value);
  if (!parsed.success) return null;
  const record = parsed.data;
  let type: EventType;
  let millis: number;
  let recordId: string;
  let amount: BehaviorEvent["amount"];
  let counterparty: BehaviorEvent["counterparty"];

  switch (record.format) {
    case "afc-assistant-v1":
      type = record.type;
      millis = Date.parse(record.timestamp);
      recordId = record.id;
      if (record.amount && !type.startsWith("payment.")) return null;
      amount = record.amount ? { ...record.amount, decimals: 6 } : undefined;
      counterparty = record.counterparty
        ? { id: record.counterparty, kind: "unknown" }
        : undefined;
      break;
    case "langchain-stream-v2":
      if (record.event === "on_chain_end" && record.parent_ids.length > 0)
        return null;
      type =
        record.event === "on_chain_end" ? "task.completed" : "action.performed";
      millis = Date.parse(record.timestamp);
      recordId = record.run_id.toLowerCase();
      break;
    case "otlp-span":
      type =
        record.span.status.code === 2 ||
        record.span.status.code === "STATUS_CODE_ERROR"
          ? "task.failed"
          : "task.completed";
      millis = Number(BigInt(record.span.endTimeUnixNano) / 1_000_000n);
      recordId = `${record.span.traceId.toLowerCase()}:${record.span.spanId.toLowerCase()}`;
      break;
  }
  if (!Number.isSafeInteger(millis) || millis < 0 || millis >= 2 ** 48)
    return null;

  const logHash = createHash("sha256")
    .update(JSON.stringify([record.format, record.agent_id, recordId]))
    .digest("hex");
  const event = BehaviorEventSchema.safeParse({
    event_id: eventId(millis, logHash),
    subject: { afc_id: record.agent_id },
    type,
    source: "assistant",
    simulated: record.simulated ?? false,
    attestation: "self_reported",
    occurred_at: new Date(millis).toISOString(),
    outcome: outcomes[type],
    amount,
    counterparty,
    evidence: { log_hash: logHash },
    attrs: { log_format: record.format },
  });
  return event.success ? event.data : null;
}
