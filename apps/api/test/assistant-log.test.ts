import { expect, test } from "bun:test";
import { parseBehaviorEventJsonl } from "../src/service";

const row = {
  format: "afc-assistant-v1",
  agent_id: "afc:asst:upload-test",
  id: "run-001",
  timestamp: "2026-11-11T10:00:00Z",
  type: "task.completed",
};

test("assistant upload ignores identical replays of a record ID", () => {
  const line = JSON.stringify(row);
  expect(parseBehaviorEventJsonl(`${line}\n${line}\n`)).toHaveLength(1);
});

test("assistant upload rejects ambiguous or unsupported records with a line number", () => {
  const line = JSON.stringify(row);
  const edited = JSON.stringify({ ...row, type: "task.failed" });
  expect(() => parseBehaviorEventJsonl(`${line}\n${edited}`)).toThrow(
    "Line 2 conflicts",
  );
  expect(() => parseBehaviorEventJsonl(`${line}\n{}`)).toThrow(
    "Line 2 is not a supported event or assistant-log record",
  );
});
