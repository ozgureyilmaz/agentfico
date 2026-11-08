# DECISIONS

Newest first. Each entry: date (Istanbul), decision, reason. Changing a decision needs a new entry.

## Nov 8, 2026
- **Initial scorer implementation, afc-0.2.** Implement the six published formulas with the version, coefficients, half-lives, confidence weights, penalties and caps in `packages/core/src/weights.ts`. Require an explicit UTC `as_of`, filter by subject and time, and preserve input events. Q uses the reject-only penalty in section 2.2. Q02 reports the combined reject/revise rate in section 3.
- **History eligibility under adverse additions.** Supplemental limit violations and anomaly flags contribute adverse evidence but cannot establish age or increase the event count used to lift the thin-file cap. Counting them as positive history could make a newly added violation raise a score at the 10-event or 7-day boundary, conflicting with M2's monotonicity requirement. The minimum three-event requirement uses all distinct observed events.
- **Missing signals and measurement conventions.** Use a neutral 0.5 for missing measured signals and zero for an unverified owner link. Normalize counterparty and funding entropy by the number of observed counterparties. Compute spend variation from decayed, attestation-weighted daily outgoing amounts, including zero-spend UTC days in a bounded 90-day window. Measure downward quality drift by comparing the recent 14 days against the earlier portion of a 60-day window.
- **Numeric and provenance checks.** Measured amounts use nonnegative decimal strings with up to six fractional digits and values at or below the JavaScript safe-integer limit. Unsupported amounts contribute no spend measurement. Quality dispersion and drift use decay and attestation weights. Confidence multipliers apply to the Q mean. Q04 requires a platform-signed Reppo observation with an evaluation ID and an explicit manipulation flag.
- **Traceable judgments.** Real quality observations require a Reppo source and evaluation ID. Synthetic observations require explicit simulation provenance. Confirmed F01/F02 evidence applies the 549 cap independently of decay. Reason codes use observed event IDs and Reppo evaluation IDs, rank estimated factor impacts, and return up to four negative and two positive signals.
- **Persona calibration.** Keep the published model coefficients and expected ranges. Refine the synthetic histories for sparse weekend spending, low-quality work sales and disputes, and Phoenix's early refunds and failed tasks followed by recovery. Update the event-stream golden hash with these inputs. Earlier M1 verification entries remain historical evidence for their original revision.
- **Simulation upgrades.** Reseeding atomically replaces the selected subjects' `source=simulator`, `simulated=true` histories. This prevents old and calibrated events from mixing in an existing database. Other sources and unselected subjects are preserved, and failed replacement rolls back.
- **Methodology export.** Export JSON-serializable methodology data from the same constants used by the scorer and reason-code registry. M5 will wire it to the API.

## Nov 5, 2026
- **Offline simulation.** Anchor the simulation window at 2026-11-05 00:00 UTC and derive timestamps and ULIDs from the seed. This makes event hashes independent of when and where the simulator runs. Synthetic work evaluations carry explicit provenance and omit real evaluation IDs.
- **Canonical event IDs.** Reject lowercase ULIDs at ingestion so the same ID cannot bypass case-sensitive deduplication and signed evidence can stay unmodified.
- **SQLite ingestion.** Validate batches before writing them in a transaction. Deduplicate by event ID and scope evidence hashes to subject and event type so separate subjects and event types can cite the same evidence.
- **Initial workspace and CI.** Pin the same Bun release for local development and CI. CI installs from the committed lockfile and runs the root check on pull requests and pushes to main.
- **Track: Reppo**, with Kite as fallback (checkpoint Nov 10) and Open as last resort (Nov 13). Reasons: Reppo publicly asked for a "FICO for agents" built on its Eval API and said it is open to funding it; judged work quality is what separates this score from payment-only reputation; the Kite track is crowded with spend-safety projects; Reppo evals are cheap.
- **Open source, free, MIT.** No x402 paywall on score lookups.
- **No lending in the product or demo.** No lender pool, no credit lines, no credit-decision table. Lenders are just one kind of consumer of an open score.
- **Behavior-only score.** Factors: work quality 35, payment conduct 20, reliability 15, consistency 10, identity and history 10, integrity 10. Repayment history and utilization moved to the roadmap.
- **Deterministic math, SERV for judgment and language.** Score numbers never come from an LLM. SERV output can add a flag, never raise a score.
- **Every SERV call is logged** (`serv_calls`) and visible in the dashboard and API so judges can verify usage.
- **Simulated personas first** (Atlas, Blaze, Murk, Nova-7, Phoenix), always labeled; then real adapters (Kite, Reppo, assistant logs).
- **Stack:** TypeScript, Bun workspaces, Hono, zod, Drizzle + SQLite, React (Vite) dashboard, `openai` SDK pointed at SERV.
- **Name:** AgentFICO ("FICO score for agents"). Not affiliated with FICO; say so in the README.
