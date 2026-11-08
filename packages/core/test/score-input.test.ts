import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { generateSimulation, SIMULATION_ANCHOR } from "../../sim/src";
import { scoreAgent } from "../src/score";

const subject = "afc:sim:atlas";

test("scoring is repeatable, order-independent, and preserves its input", () => {
  const events = generateSimulation();
  const before = structuredClone(events);
  const baseline = scoreAgent(events, subject, SIMULATION_ANCHOR);
  expect(scoreAgent(events.toReversed(), subject, SIMULATION_ANCHOR)).toEqual(
    baseline,
  );
  expect(
    scoreAgent([...events, ...events], subject, SIMULATION_ANCHOR),
  ).toEqual(baseline);
  expect(
    scoreAgent(
      events.filter((event) => event.subject.afc_id === subject),
      subject,
      SIMULATION_ANCHOR,
    ),
  ).toEqual(baseline);
  expect(events).toEqual(before);
});

test("future evidence cannot affect a historical score", () => {
  const events = generateSimulation({ personas: ["atlas"] });
  const future = {
    ...events[0],
    event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    occurred_at: "2026-12-01T00:00:00.000Z",
    type: "anomaly.flagged" as const,
    attrs: { reason_code: "F01", severity: 1 },
  };
  expect(scoreAgent([...events, future], subject, SIMULATION_ANCHOR)).toEqual(
    scoreAgent(events, subject, SIMULATION_ANCHOR),
  );
  expect(() => scoreAgent(events, subject, "2026-11-05T00:00:00")).toThrow();
});

test("the same timestamp produces byte-identical score JSON in different timezones", () => {
  const core = fileURLToPath(new URL("../src/score.ts", import.meta.url));
  const sim = fileURLToPath(new URL("../../sim/src/index.ts", import.meta.url));
  const script = `import { scoreAgent } from ${JSON.stringify(core)}; import { generateSimulation, SIMULATION_ANCHOR } from ${JSON.stringify(sim)}; console.log(JSON.stringify(scoreAgent(generateSimulation(), "afc:sim:atlas", SIMULATION_ANCHOR)));`;
  const outputs = ["Europe/Istanbul", "America/New_York"].map((TZ) => {
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      env: { ...process.env, TZ },
    });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString();
  });
  expect(outputs[0]).toBe(outputs[1]);
});
