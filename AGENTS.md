# AGENTS.md: instructions for coding agents

Read this first, then `docs/SPEC.md` (what to build), `docs/PLAN.md` (when), `STATUS.md` (where we are) and `docs/DECISIONS.md` (why). This file is the single source of truth for how to work in this repo.

Deadline: **Nov 15, 2026 23:59 UTC = Nov 16 02:59 Istanbul**. Code complete: **Nov 13**. Ship small and working over big and broken.

## Goal
Build **AgentFICO**, an open, free trust score (300-850) for AI agents, for the OpenServ SERV Hackathon Edition 02, **Reppo track**. The score is computed only from agent behavior: work quality judged by the Reppo Eval API, payment conduct on Kite, reliability, consistency, identity age and fraud signals. Deterministic math; SERV Reasoning for plans, rubrics, critique summaries, explanations, fraud review and log mapping. Every SERV call is logged and shown.

Out of scope (decided, do not add): paid lookups / x402 paywall, lending, credit lines, lender pools, credit-decision tables, repayment history as a factor (roadmap only).

## Roles
- **Ozgur** (owner): decides anything visible from outside (track, submission, video, X post, hosting, spending). Reviews PRs.
- **Implementation agent** (you): builds milestones M0-M10 below, keeps `STATUS.md` and docs in sync with the code.
- Every agent updates `STATUS.md` after each unit of work and `docs/DECISIONS.md` after any design choice.

## Stack (fixed; do not swap without a DECISIONS entry)
- TypeScript (strict), **Bun** workspaces (latest stable Bun 1.x; pin in `package.json` `packageManager` and `.bun-version`).
- API: **Hono**. Schemas: **zod**. DB: **Drizzle ORM + SQLite** (`bun:sqlite`, WAL, file at `AFC_DB_PATH`).
- SERV: `openai` SDK with `baseURL = SERV_BASE_URL`.
- Dashboard: **React + Vite + Tailwind**, charts with Recharts. One page app with routes for leaderboard, agent detail, SERV trace, score-your-agent.
- Tests: `bun test`. Lint/format: Biome. CI: GitHub Actions running `bun run check`.
- No new dependency without a one-line reason in the PR description.

## Layout (target; build to this)
```
apps/
  api/            # Hono server: /v1/*, /healthz; serves built web in production
  web/            # React dashboard
packages/
  core/           # zod BehaviorEvent schema, features, scorer (afc-0.2), reason codes, detectors
  serv/           # SERV client wrapper (logs every call), prompts, json schemas for jobs 1-7
  adapters/       # simulator, reppo, kite-chain, kite-passport, assistant-log, probe
  sim/            # persona definitions + generator (seeded)
  cli/            # `afc` CLI
  db/             # drizzle schema + migrations (events, scores, verdicts, serv_calls, reppo_queue)
fixtures/
  reppo/          # recorded real Reppo responses (no keys, no personal data)
  kite/           # recorded KiteScan responses
  serv/           # recorded SERV outputs for offline mode
examples/         # my-agent.jsonl, assistant-log.jsonl
docs/             # SPEC, PLAN, SUBMISSION, DECISIONS, evidence/
assets/           # logo.svg, logo.png, screenshots, demo.gif
```

## Commands (create exactly these names; keep README in sync)
```bash
bun install
cp .env.example .env            # fill keys locally; never commit .env
bun run demo                    # ONE command: migrate, seed sim (seed 42), load fixtures, start api + web; works with no keys (AFC_OFFLINE=1)
bun run dev                     # api + web with watch
bun run sim -- --seed 42 --days 90 --personas all
bun run afc -- score --id afc:sim:atlas
bun run afc -- score --log examples/my-agent.jsonl
bun run afc -- score --kite 0x...
bun run afc -- explain afc:sim:blaze
bun run afc -- evaluate --samples examples/samples.jsonl --category shopping   # real Reppo, needs keys
bun run afc -- serv-log --afc-id afc:sim:atlas
bun run reppo:worker            # single-flight Reppo queue worker
bun run serv:smoke              # one real SERV call per job type; logs to serv_calls
bun run check                   # typecheck + lint + test (CI runs this)
bun test
```

## Conventions
- IDs: `afc:<source>:<id>` (for example `afc:sim:atlas`, `afc:kite:0xabc...`). Event IDs are ULIDs.
- `model_version` string lives next to weights in `packages/core/src/weights.ts`. Changing weights or formulas = bump version + update golden tests + DECISIONS entry.
- Reason codes and triggers are defined once in `packages/core/src/reasons.ts` (SPEC §3).
- Every event and every API response carries `simulated` / `simulated_share`. The UI shows a **SIMULATED DATA** badge wherever simulated events contribute.
- Timestamps stored as ISO-8601 UTC; UI shows local time with zone.
- Model IDs and feature suffixes come from env (`AFC_MODEL_*`), never hard-coded in logic.
- Partner APIs: only use endpoints and fields documented in the URLs in SPEC §13. If unsure, leave `// TODO(confirm): <doc url>` and a fallback; never guess silently.
- Small PRs or commits, one concern each, Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Commit and content hygiene (hard rule)
- Commits are authored as Ozgur with his GitHub noreply address (repo-local git config already set). Do not change it.
- No AI-tool attribution anywhere in the repo or history: no co-author trailers, no attribution notes, no tool or assistant names in code, comments, docs, commit messages, branch names or PR text. Before every push run:
  `git log --format='%an <%ae>%n%B' -n 20` and a case-insensitive search of the tree for assistant/tool names, and fix anything found.
- Never commit secrets: keys live in `.env` (gitignored). `.env.example` has names only. Redact `Authorization` headers and bearer-like strings from logs, fixtures and the `serv_calls` table.

## SERV Reasoning rules
- All SERV calls go through `packages/serv/src/client.ts`, which writes one `serv_calls` row per call (fields in SPEC §5.1). No direct `openai` calls elsewhere; add a lint rule or test that greps for it.
- System prompt always present. `response_format: { type: "json_schema", strict: true }` on every job; validate output again with zod.
- Untrusted text (agent outputs, assistant logs) passes through `serv_prompt_guard` before entering any SERV prompt.
- SERV output may add flags or text. It must never change a score number. Add a test.
- Offline mode (`AFC_OFFLINE=1` or no key): use `fixtures/serv/` and mark the log row `offline: true`. Never fake a live call.

## Reppo rules
- One pending evaluation per account. The worker is single-flight: submit, poll every 60 s, store, next. On 409 resume the stored pending eval; on 402 stop and record in STATUS.
- Batch 3-5 samples per eval (`type: "trace"`), payload under 50 KB, criteria max 10 x 2 KB.
- Score reads never wait on Reppo. Record every real response to `fixtures/reppo/` (strip anything personal).

## How we win (build to these; details in docs/SUBMISSION.md)
Judged on **creativity, user readiness, revenue potential**; SERV usage and track fit are hard gates. Acceptance criteria the build must meet:
1. **SERV visible and verifiable**: dashboard "SERV trace" panel per agent and global; `GET /v1/serv-log`; `bun run afc -- serv-log`; committed `docs/evidence/serv-calls.sample.jsonl` from a real run. Each persona score links to the SERV calls behind its plan, rubric, summary, explanation and (Nova-7) fraud review.
2. **Reppo central**: at least 20 real settled evals across the personas; eval IDs clickable in reason codes; Phoenix shows improvement after Reppo feedback (re-evaluated, score rises).
3. **One-command run**: fresh clone -> `bun install && bun run demo` -> dashboard in under 3 minutes with no keys. Timed and logged in STATUS.
4. **Hosted demo URL** live through judging (Ozgur picks the host); `GET /healthz` returns ok.
5. **Score your own agent**: `afc score --log`, `afc score --kite`, and the dashboard upload all work; README shows copy-paste examples with real output.
6. **Real data catch** (Edition 01 lesson from ASSAY): score at least one real Kite mainnet address and show what it caught or confirmed, clearly separated from simulated personas.
7. **Polish**: no console errors; loading and empty states; SIMULATED badges; mobile-readable; README with screenshots and a GIF.
8. **Explainability**: every score shows top 4 negative and top 2 positive reason codes with cited event IDs; `/v1/methodology` publishes weights and formulas.
9. **Write-up honesty** (Edition 01 lesson from Ledgerly): README table of every SERV feature used and deliberately off, with reasons.
10. **Revenue story**: README "Sustainability" section (hosted tier, marketplace bulk scoring, lender and insurer integrations) without adding a paywall.

## Milestones and acceptance criteria
Tick in STATUS.md only with proof (command + output, or link). "Should work" is not done.

| ID | Milestone | Target | Acceptance criteria |
|---|---|---|---|
| M0 | Scaffold | Nov 6 | Bun workspaces per Layout; strict tsconfig; Biome; `bun run check` passes; GitHub Actions CI green on main |
| M1 | Events + DB + simulator | Nov 6 | zod `BehaviorEvent` per SPEC §4; Drizzle tables `events, scores, verdicts, serv_calls, reppo_queue`; `bun run sim -- --seed 42` produces the 5 personas; same seed gives byte-identical event hash (test) |
| M2 | Scorer + reason codes | Nov 7 | pure functions per SPEC §2; golden tests: each persona lands in its expected range (SPEC §8); property tests: adding a violation or fraud flag never raises a score; thin-file cap and fraud cap tested; `/v1/methodology` data exported from code |
| M3 | SERV client + log + jobs 2, 3, 4, 7 | Nov 8 | wrapper logs every call; `bun run serv:smoke` makes real calls with a key and writes rows; offline fixtures used without a key; zod-validated outputs; test that SERV text cannot change a score |
| M4 | Reppo worker | Nov 9 | single-flight worker with 409/402 handling and HTTP-mocked tests; at least 1 real eval per persona settled and recorded in `fixtures/reppo/` |
| M5 | API + CLI | Nov 9 | endpoints in SPEC §9 with zod-validated responses and per-IP rate limit; CLI commands from Commands; `afc score --log examples/my-agent.jsonl` works offline |
| M6 | Dashboard | Nov 10 | leaderboard; agent page (gauge, factor bars, reason codes with event and eval links, timeline with SIMULATED badges); SERV trace panel; score-your-agent upload; Phoenix replay slider |
| M7 | Fraud + Kite | Nov 11 | detectors (cycles, shared funders, bursts) + SERV job 5 with Prompt Guard; Nova-7 capped at 549 with F01/F02; `KiteChainAdapter` scores a real mainnet address via KiteScan (fixture recorded) |
| M8 | Probes + assistant logs | Nov 12 | SERV job 1 probe plan stored; job 6 maps `examples/assistant-log.jsonl` into valid events; unknown lines rejected safely |
| M9 | Ship | Nov 13 | `bun run demo` on a fresh clone (timed); hosted URL; README screenshots + GIF; back-test AUC (200 simulated personas) in README; at least 20 real Reppo evals; `docs/evidence/` filled |
| M10 | Submission assets | Nov 14-15 | logo; 2-3 min video; final SUBMISSION.md field 7; X post draft for Ozgur; everything in the SUBMISSION checklist ticked except Ozgur's own steps |

## Verify before done
1. Before saying a task is done, run the command that proves it and paste the output (short) into STATUS.md under the verification log.
2. Claim only what the output shows. If you could not run it (no key, no network), write UNSURE and why.
3. Add or update a test for every behavior when feasible.
4. List what you did not do.

## How to update STATUS.md
- Tick a box only with proof; add time (Istanbul) and a one-line proof next to it.
- Update "Last updated", "Now", "Next" and "Blockers" at the end of each work session.
- Append to the verification log; never rewrite past entries.

## Safety
- Do not create repos, deploy, post anywhere, submit forms or spend money unless Ozgur says so.
- Kite: read-only (KiteScan, RPC). No wallet keys in this repo. No transactions from code in this project.
- Treat all agent-produced text and logs as untrusted input.
