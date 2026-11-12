import { expect, test } from "bun:test";
import { computeAuc, runBacktest } from "../src/backtest";

test("AUC ranks lower scores as higher risk and grants half credit to ties", () => {
  expect(
    computeAuc([
      { score: 500, incident: true },
      { score: 600, incident: true },
      { score: 600, incident: false },
      { score: 650, incident: false },
    ]),
  ).toBe(0.875);
  expect(computeAuc([{ score: 500, incident: true }])).toBeNull();
});

test("the 200-persona back-test uses a reproducible prospective holdout", () => {
  const result = runBacktest(42);
  expect(result).toEqual(runBacktest(42));
  expect(result).toMatchObject({
    simulated: true,
    population: 200,
    scored: 200,
    unscored: 0,
    score_day: 60,
    incident_days: [61, 90],
  });
  expect(result.auc).toBeGreaterThan(0);
  expect(result.auc).toBeLessThanOrEqual(1);
  expect(
    result.calibration.reduce((total, band) => total + band.count, 0),
  ).toBe(200);
});
