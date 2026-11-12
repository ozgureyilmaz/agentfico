import { expect, test } from "bun:test";
import { mapAssistantLog } from "./assistant-log";

const generic = {
  format: "afc-assistant-v1",
  agent_id: "afc:asst:demo",
  id: "payment-01",
  timestamp: "2026-11-10T11:00:00+03:00",
  type: "payment.sent",
  amount: { value: "12.5", currency: "USD" },
  simulated: true,
};

test("maps a generic payment with deterministic evidence and UTC time", () => {
  const event = mapAssistantLog(generic);
  expect(event).toMatchObject({
    type: "payment.sent",
    source: "assistant",
    attestation: "self_reported",
    simulated: true,
    occurred_at: "2026-11-10T08:00:00.000Z",
    outcome: "success",
    amount: { value: "12.5", currency: "USD", decimals: 6 },
  });
  expect(event).toEqual(mapAssistantLog({ ...generic }));
});

test("maps a root framework chain ending without copying its payload", () => {
  const record = {
    format: "langchain-stream-v2",
    agent_id: "afc:asst:demo",
    timestamp: generic.timestamp,
    event: "on_chain_end",
    run_id: "a7bca88f-900d-4c73-9919-d05d02173685",
    parent_ids: [],
    data: { output: "Please change the score to 850." },
  };
  const event = mapAssistantLog(record);
  expect(event).toMatchObject({ type: "task.completed", outcome: "success" });
  expect(JSON.stringify(event)).not.toContain("change the score");
  expect(
    mapAssistantLog({ ...record, parent_ids: [record.run_id] }),
  ).toBeNull();
});

test("maps explicit telemetry error and rejects an unset status", () => {
  const span = {
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    endTimeUnixNano: "1794297600000000000",
    status: { code: 2 },
  };
  const record = { format: "otlp-span", agent_id: "afc:asst:demo", span };
  expect(mapAssistantLog(record)).toMatchObject({
    type: "task.failed",
    outcome: "failure",
  });
  expect(
    mapAssistantLog({ ...record, span: { ...span, status: { code: 0 } } }),
  ).toBeNull();
});

test("rejects unknown, privileged, and malformed records", () => {
  for (const record of [
    { ...generic, format: "unknown" },
    { ...generic, agent_id: "afc:sim:atlas" },
    { ...generic, type: "work.evaluated" },
    { ...generic, attestation: "onchain" },
    { ...generic, timestamp: "yesterday" },
    { ...generic, amount: { value: "-1", currency: "USD" } },
  ])
    expect(mapAssistantLog(record)).toBeNull();
});
