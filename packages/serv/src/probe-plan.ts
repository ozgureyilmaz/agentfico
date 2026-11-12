import { z } from "zod";

export const ProbePlanInputSchema = z.strictObject({
  afc_id: z.string().min(1).max(128),
  category: z.string().trim().min(1).max(128),
  capabilities: z.array(z.string().trim().min(1).max(200)).max(10),
  missing_signals: z
    .array(
      z.enum([
        "work_quality",
        "payment_conduct",
        "reliability",
        "identity_history",
      ]),
    )
    .max(4),
});

export const ProbePlanSchema = z.strictObject({
  probes: z
    .array(
      z.strictObject({
        task: z.string().trim().min(1).max(1800),
        acceptance: z.string().trim().min(1).max(500),
        delay_minutes: z.number().int().min(0).max(60),
      }),
    )
    .min(3)
    .max(5),
});

export function validateProbePlan(value: unknown) {
  const plan = ProbePlanSchema.parse(value);
  const tasks = new Set(
    plan.probes.map((probe) => probe.task.toLowerCase().replace(/\s+/g, " ")),
  );
  if (tasks.size !== plan.probes.length)
    throw new Error("Probe tasks must be distinct");
  return plan;
}
