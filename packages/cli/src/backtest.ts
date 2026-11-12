import { createHash } from "node:crypto";
import { scoreAgent } from "@agentfico/core";
import {
  generateSimulation,
  PERSONAS,
  SIMULATION_ANCHOR,
} from "@agentfico/sim";

type Observation = { score: number; incident: boolean };

function uniform(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32BE() / 2 ** 32;
}

export function computeAuc(rows: readonly Observation[]): number | null {
  const incidents = rows.filter((row) => row.incident);
  const clean = rows.filter((row) => !row.incident);
  if (incidents.length === 0 || clean.length === 0) return null;

  let correct = 0;
  for (const incident of incidents) {
    for (const other of clean) {
      if (incident.score < other.score) correct += 1;
      else if (incident.score === other.score) correct += 0.5;
    }
  }
  return correct / (incidents.length * clean.length);
}

export function runBacktest(seed = 42) {
  const population = 200;
  const rows: Observation[] = [];
  let modelVersion: string | undefined;
  for (let index = 0; index < population; index++) {
    const subjectSeed = `${seed}:${index}`;
    const profile = PERSONAS.at(
      Math.floor(uniform(`${subjectSeed}:profile`) * PERSONAS.length),
    );
    if (!profile) throw new Error("No matching simulation profile");
    const history = generateSimulation({
      seed: `${subjectSeed}:history`,
      days: 60,
      personas: [profile.id],
    });
    const score = scoreAgent(history, profile.afcId, SIMULATION_ANCHOR);
    modelVersion = score.model_version;
    if (score.score === null) continue;

    // Independent prospective outcome draws with a profile's hidden 30-day risk.
    const dailyRisk = 1 - (1 - profile.truth.risk) ** (1 / 30);
    const incident = Array.from({ length: 30 }, (_, day) => day + 61).some(
      (day) => uniform(`${subjectSeed}:outcome:${day}`) < dailyRisk,
    );
    rows.push({ score: score.score, incident });
  }

  const bands = [
    [300, 579],
    [580, 669],
    [670, 739],
    [740, 799],
    [800, 850],
  ] as const;
  const calibration = bands.map(([min, max]) => {
    const members = rows.filter((row) => row.score >= min && row.score <= max);
    const incidents = members.filter((row) => row.incident).length;
    return {
      range: `${min}–${max}`,
      count: members.length,
      incidents,
      observed_incident_rate: members.length
        ? incidents / members.length
        : null,
    };
  });

  return {
    simulated: true,
    seed,
    model_version: modelVersion,
    population,
    scored: rows.length,
    unscored: population - rows.length,
    incident_count: rows.filter((row) => row.incident).length,
    score_day: 60,
    incident_days: [61, 90],
    auc: computeAuc(rows),
    calibration,
  };
}

if (import.meta.main) console.log(JSON.stringify(runBacktest(), null, 2));
