import { z } from "zod";

const types = [
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
] as const;

const outcomes = z.enum(["success", "failure", "reversed", "disputed"]);

export const LogMappingInputSchema = z.strictObject({
  afc_id: z.string().min(1).max(128),
  line: z.string().min(1).max(8192),
  expected: z.strictObject({
    type: z.enum(types),
    occurred_at: z.iso.datetime(),
    outcome: outcomes.nullable(),
  }),
});

export const LogMappingSchema = z.strictObject({
  candidate: LogMappingInputSchema.shape.expected,
});

export function validateLogMapping(
  input: z.infer<typeof LogMappingInputSchema>,
  value: unknown,
) {
  const { candidate } = LogMappingSchema.parse(value);
  if (
    candidate.type !== input.expected.type ||
    candidate.occurred_at !== input.expected.occurred_at ||
    candidate.outcome !== input.expected.outcome
  ) {
    throw new Error("SERV log mapping conflicts with validated source fields");
  }
}
