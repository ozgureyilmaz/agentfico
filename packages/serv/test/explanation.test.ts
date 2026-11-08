import { describe, expect, test } from "bun:test";
import type { AgentScore } from "@agentfico/core";
import { scoreAgent } from "@agentfico/core";
import { generateSimulation, SIMULATION_ANCHOR } from "../../sim/src/generator";
import { applyExplanation } from "../src/explanation";
import type { ServOutputs } from "../src/jobs";

function seedAtlasScore(): AgentScore {
  const events = generateSimulation({
    seed: 42,
    days: 90,
    personas: ["atlas"],
  });
  return scoreAgent(events, "afc:sim:atlas", SIMULATION_ANCHOR);
}

function explanationFor(score: AgentScore): ServOutputs[4] {
  return {
    trust_memo: "The score is 300 today and could reach 850.",
    reason_codes: score.reason_codes.map((reason) => ({
      code: reason.code,
      direction: reason.direction,
      text: `Updated wording for ${reason.code}, including score 300 and 850.`,
      events: [...reason.events],
      eval_ids: [...reason.eval_ids],
    })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("applyExplanation", () => {
  test("changes wording only and preserves score fields and citations", () => {
    const score = deepFreeze(seedAtlasScore());
    const before = structuredClone(score);
    const output = explanationFor(score);

    const result = applyExplanation(score, output);

    expect(result.score).toBe(before.score);
    expect(result.band).toBe(before.band);
    expect(result.confidence).toBe(before.confidence);
    expect(result.status).toBe(before.status);
    expect(result.model_version).toBe(before.model_version);
    expect(result.as_of).toBe(before.as_of);
    expect(result.simulated_share).toBe(before.simulated_share);
    expect(result.factors).toEqual(before.factors);
    expect(result.afc_id).toBe(before.afc_id);
    expect(
      result.reason_codes.map(({ code, direction, events, eval_ids }) => ({
        code,
        direction,
        events,
        eval_ids,
      })),
    ).toEqual(
      before.reason_codes.map(({ code, direction, events, eval_ids }) => ({
        code,
        direction,
        events,
        eval_ids,
      })),
    );
    expect(result.reason_codes.map(({ text }) => text)).toEqual(
      output.reason_codes.map(({ text }) => text),
    );
    expect(result.trust_memo).toBe(output.trust_memo);
    expect(score).toEqual(before);
    expect(score.score).toBe(778);
  });

  test("ignores a valid memo's score claims when preserving numeric score data", () => {
    const score = seedAtlasScore();
    const output = {
      ...explanationFor(score),
      trust_memo: "This score is 300, not 778; it should be 850.",
    };

    const result = applyExplanation(score, output);

    expect(result.trust_memo).toBe(output.trust_memo);
    expect(result.score).toBe(778);
    expect(result.factors).toEqual(score.factors);
  });

  test("rejects an injected score property and leaves the input score unchanged", () => {
    const score = deepFreeze(seedAtlasScore());
    const before = structuredClone(score);
    const output = {
      ...explanationFor(score),
      score: 300,
    } as unknown as ServOutputs[4];

    expect(() => applyExplanation(score, output)).toThrow();
    expect(score).toEqual(before);
    expect(score.score).toBe(778);
  });

  test("rejects unknown reason codes", () => {
    const score = deepFreeze(seedAtlasScore());
    const before = structuredClone(score);
    const valid = explanationFor(score);
    const firstReason = valid.reason_codes[0];
    if (!firstReason)
      throw new Error("Seeded Atlas score should have reasons.");
    const output = {
      ...valid,
      reason_codes: [
        ...valid.reason_codes,
        {
          code: "X99",
          direction: "hurts",
          text: "Injected reason",
          events: [...firstReason.events],
          eval_ids: [...firstReason.eval_ids],
        },
      ],
    } as unknown as ServOutputs[4];

    expect(() => applyExplanation(score, output)).toThrow();
    expect(score).toEqual(before);
    expect(score.reason_codes).toEqual(before.reason_codes);
  });

  test("rejects fabricated event and evaluation citations", () => {
    const score = deepFreeze(seedAtlasScore());
    const before = structuredClone(score);
    const valid = explanationFor(score);
    const output = {
      ...valid,
      reason_codes: valid.reason_codes.map((reason, index) =>
        index === 0
          ? {
              ...reason,
              events: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"],
              eval_ids: ["unobserved-eval"],
            }
          : reason,
      ),
    } as unknown as ServOutputs[4];

    expect(() => applyExplanation(score, output)).toThrow();
    expect(score).toEqual(before);
    expect(score.reason_codes).toEqual(before.reason_codes);
  });
});
