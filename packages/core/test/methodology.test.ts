import { expect, test } from "bun:test";
import { METHODOLOGY } from "../src";
import { REASON_CODES } from "../src/reasons";
import { FACTOR_FORMULAS, FACTOR_WEIGHTS, MODEL_VERSION } from "../src/weights";

test("exports the scorer's version, formulas, weights and reasons as JSON data", () => {
  const json = JSON.parse(JSON.stringify(METHODOLOGY));

  expect(json.model_version).toBe(MODEL_VERSION);
  expect(json.weights).toEqual(FACTOR_WEIGHTS);
  expect(
    Object.values(FACTOR_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
  ).toBe(100);
  expect(json.formulas.factors).toEqual(FACTOR_FORMULAS);
  expect(json.reason_codes).toEqual(REASON_CODES);
  expect(Object.keys(REASON_CODES)).toHaveLength(23);
});
