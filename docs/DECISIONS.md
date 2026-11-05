# DECISIONS

Newest first. Each entry: date (Istanbul), decision, reason. Changing a decision needs a new entry.

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
