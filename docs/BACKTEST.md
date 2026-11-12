# Simulated score back-test

Run `bun run backtest` from the repo root. Seed 42 generates 200 independent simulated histories from the five behavioral profiles. The scorer sees the first 60 days. Separate seeded draws generate outcomes for days 61–90 using each profile's hidden 30-day risk. A subject is positive if an incident occurred in that holdout. AUC compares all positive and negative pairs, counting ties as half a correct ranking.

The afc-0.2 run scored all 200 subjects. It ranked the 62 incident cases with an AUC of **0.821**. This measures ranking on the simulator and its assumed risk labels. It does not establish real-world predictive accuracy or convert a score into a probability.

| Score band | Subjects | Incidents | Observed rate |
|---|---:|---:|---:|
| Poor (300–579) | 37 | 29 | 78.4% |
| Fair (580–669) | 120 | 33 | 27.5% |
| Good (670–739) | 0 | 0 | — |
| Very good (740–799) | 43 | 0 | 0% |
| Exceptional (800–850) | 0 | 0 | — |

[Exact output](evidence/simulated-backtest.json)
