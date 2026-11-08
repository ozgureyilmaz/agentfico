import { expect, test } from "bun:test";
import { BehaviorEventSchema } from "@agentfico/core";
import { generateSimulation, hashEventsSha256 } from "@agentfico/sim";
import { SimulatorAdapter } from "./simulator";

test("SimulatorAdapter validates every generated event and supports option overrides", () => {
  const adapter = new SimulatorAdapter({ seed: 42, days: 90 });
  const events = adapter.generate({ days: 1, personas: ["atlas"] });

  expect(events.length).toBeGreaterThan(0);
  expect(events.map((event) => BehaviorEventSchema.parse(event))).toEqual(
    events,
  );
  expect(
    events.every((event) => event.subject.afc_id === "afc:sim:atlas"),
  ).toBe(true);
  expect(events.every((event) => event.simulated)).toBe(true);
});

test("schema parsing preserves the canonical event hash used by the CLI", () => {
  const options = {
    seed: 42,
    days: 90,
    personas: ["atlas", "nova-7"] as const,
  };
  const generated = generateSimulation(options);
  const adapted = new SimulatorAdapter().generate(options);

  expect(hashEventsSha256(adapted)).toBe(hashEventsSha256(generated));
});
