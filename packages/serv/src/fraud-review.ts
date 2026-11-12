import { type ServInputs, type ServOutputs, validateJobOutput } from "./jobs";

export function applyFraudReview(
  input: ServInputs[5],
  output: ServOutputs[5],
  trace: { call_id: string; offline: boolean },
) {
  const validatedInput = input;
  const validatedOutput = validateJobOutput(5, validatedInput, output);
  if (!trace.call_id.trim()) throw new Error("SERV trace ID must not be empty");

  return {
    summary: validatedOutput.summary,
    findings: validatedOutput.findings.map((finding, index) => {
      const source = validatedInput.findings[index];
      if (!source) throw new Error("Fraud review source finding is missing");
      return {
        code: source.code,
        text: source.text,
        source_event_ids: [...source.source_event_ids],
        typology: finding.typology,
        description: finding.description,
      };
    }),
    serv_call_id: trace.call_id,
    offline: trace.offline,
  };
}
