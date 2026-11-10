import type { AgentScore } from "@agentfico/core";
import {
  SERV_JOBS,
  type ServInputs,
  type ServOutputs,
  validateJobOutput,
} from "./jobs";

type ExplainedScore = AgentScore & { trust_memo: string };

export function applyExplanation(
  score: AgentScore,
  output: ServOutputs[4],
): ExplainedScore {
  const input: ServInputs[4] = {
    afc_id: score.afc_id,
    score: score.score,
    factors: { ...score.factors },
    reason_codes: score.reason_codes.map((reason) => ({
      code: reason.code,
      direction: reason.direction,
      text: reason.text,
      events: [...reason.events],
      eval_ids: [...reason.eval_ids],
    })),
    reader: "agent_owner",
  };
  const validatedInput = SERV_JOBS[4].inputSchema.parse(input);
  const parsedOutput = SERV_JOBS[4].outputSchema.parse(output);
  const validatedOutput = validateJobOutput(4, validatedInput, parsedOutput);

  const explanationText = new Map(
    validatedOutput.reason_codes.map((reason) => [
      `${reason.code}:${reason.direction}`,
      reason.text,
    ]),
  );

  return {
    ...score,
    factors: { ...score.factors },
    reason_codes: score.reason_codes.map((reason) => ({
      ...reason,
      text:
        explanationText.get(`${reason.code}:${reason.direction}`) ??
        reason.text,
      events: [...reason.events],
      eval_ids: [...reason.eval_ids],
    })),
    trust_memo: validatedOutput.trust_memo,
  };
}
