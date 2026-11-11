# STATUS.md: build checklist

Tick only with proof: time (Istanbul) + one-line proof (command output, PR or commit link). No proof, no tick.
Deadline: Nov 16 02:59 Istanbul (Nov 15 23:59 UTC). Code complete: Nov 13.

Last updated: Nov 11 11:07 Istanbul

## Now
M0–M3 are verified and merged. M4 has five completed live persona evaluations and validated scoring events. The owner approved publishing M4, M5 and M6 as stacked PRs.

## Next
1. Review the stacked milestone PRs and their CI results. Wait for owner confirmation before merging.
2. M7 fraud detection and the real Kite mainnet demonstration.
3. Ozgur: add the OpenServ screenshot to [docs/evidence](docs/evidence/) and choose hosting.

## Setup (Ozgur)
- [x] Repo created, public, MIT (Nov 05)
- [x] `SERV_API_KEY` in local `.env`; one SERV call succeeds (Nov 10 11:49 Istanbul) — live call `67c48c14-7cb1-4467-a5dd-052b957c6843` succeeded with provider response ID and usage. See the verification log.
- [ ] OpenServ data collection — owner reports it is enabled. TODO add the console screenshot to [docs/evidence](docs/evidence/) before ticking.
- [x] Reppo account + API key in local `.env` (Nov 11 10:51 Istanbul) — five authenticated evaluations completed and used 2,200 credits.
- [ ] Partner credits requested via the OpenServ Telegram if needed (Nov 4 email)
- [ ] Hosting choice made

## Milestones (criteria in AGENTS.md)
- [x] M0 Scaffold + CI (Nov 08 09:38 Istanbul) — CI passed on the merged `main` commit `82699b1`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455536165)
- [x] M1 Events + DB + simulator (Nov 05 20:05 Istanbul) — seed 42 generated 1,401 simulated events for 5 personas. Replay matched byte for byte and retained 1,401 stored rows. See the verification log.
- [x] M2 Scorer + reason codes (Nov 08 10:29 Istanbul) — 92 tests passed, and CI passed on the merged main commit `2e92a86`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42458956765)
- [x] M3 SERV client + call log + jobs 2, 3, 4, 7 (Nov 10 12:15 Istanbul) — four live jobs succeeded; 135 tests passed; merged main CI passed at `d2d355d`. [Main run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42788871372)
- [x] M4 Reppo worker + real evals per persona (Nov 11 10:51 Istanbul) — five live completions, 2,200 credits, five scored events and 152 passing tests. [Recorded responses](fixtures/reppo/real/)
- [ ] M5 API + CLI
- [ ] M6 Dashboard (leaderboard, agent page, SERV trace, upload, Phoenix replay)
- [ ] M7 Fraud detectors + SERV fraud review + real Kite address
- [ ] M8 Probe plans + assistant log mapping
- [ ] M9 Ship: one-command demo on fresh clone, hosted URL, README GIF/screenshots, AUC, 20+ Reppo evals
- [ ] M10 Submission assets

## How-we-win gates (from AGENTS.md)
- [ ] SERV trace panel + `/v1/serv-log` + committed sample log
- [ ] 20+ real settled Reppo evals, eval IDs clickable
- [ ] Fresh clone to dashboard < 3 min (time: __)
- [ ] Hosted URL live: __
- [ ] Score-your-own-agent works (log, Kite address, upload)
- [ ] Real Kite address scored and shown
- [ ] README: screenshots, GIF, SERV feature on/off table, sustainability
- [ ] Video 2-3 min, link: __
- [ ] Logo PNG + SVG

## Submission (Ozgur)
- [ ] Field 7 final
- [ ] X post published, URL: __
- [ ] Ozgur OK to submit
- [ ] Form submitted, confirmation saved

## Blockers / open questions
- KiteScan live lookup availability remains UNSURE for the later real-address proof; response mapping is covered with primary-schema fixtures.
- Hosting provider (Ozgur).
- Reppo credits: enough for about 40 evals?

## Reppo evals log
| Date | Persona / agent | evalId | Score | Decision |
|---|---|---|---|---|

## Verification log
(append newest at the bottom: date, milestone, command, short output)

- Nov 05 20:05 Istanbul · M0 · `bun install --frozen-lockfile` → `Checked 63 installs across 127 packages (no changes)`. `bun run --filter @agentfico/web build` → `✓ 15 modules transformed`, exit 0. With `PORT=18787 WEB_PORT=15173 bun run dev`, the API returned `{"ok":true,"simulated_share":0}` at `/healthz` and the web response contained `<title>AgentFICO</title>`.
- Nov 05 20:05 Istanbul · M0 · UNSURE: CI on `main`. `gh api repos/ozgureyilmaz/agentfico/commits/main/check-runs --jq '.total_count'` → `0`. Workflow publication and the first run on `main` are pending.
- Nov 05 20:05 Istanbul · M1 · `bun run sim -- --seed 42` on a fresh SQLite file returned:

  ```text
  SIMULATED DATA | seed=42 days=90 events=1401
  afc:sim:murk 211
  afc:sim:blaze 464
  afc:sim:phoenix 374
  afc:sim:atlas 338
  afc:sim:nova-7 14
  sha256=23c1074adc4d9135a2adc5a86467d8345a4aa21f2935360acdec0265e9a1ebd8
  ```

- Nov 05 20:05 Istanbul · M1 · Replayed on the same database with `TZ=America/New_York bun run sim -- --seed 42 --days 90 --personas all` after a run in `Europe/Istanbul`. `cmp` of stdout exited 0. A read-only `bun:sqlite` query returned `events, reppo_queue, scores, serv_calls, verdicts`, `{"events":1401,"simulated":1401,"personas":5}` and `{"journal_mode":"wal"}`.
- Nov 05 20:05 Istanbul · M1 · `bun test` → `25 pass`, `0 fail`, including event validation, migration, ingestion, and golden hash tests.
- Nov 05 20:07 Istanbul · M0/M1 · `bun run check` → `tsc --noEmit` passed, Biome `Checked 38 files`, and Bun reported `25 pass`, `0 fail`.
- Nov 05 20:12 Istanbul · M0/M1 · `gh run view 42072309456` → `pull_request`, commit `c47a163`, job `check` → `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42072309456)
- Nov 08 09:38 Istanbul · M0 · `gh pr view 1 --json state,mergedAt,mergeCommit` → `MERGED`, commit `82699b1ebdb237669eef2cf695ccf7bc5608aa86`. `gh run view 42455536165` → event `push`, branch `main`, matching commit, job `check` → `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455536165)
- Nov 08 09:21 Istanbul · M0 · `gh pr view 1 --json state,mergedAt,mergeCommit` → `{"mergeCommit":null,"mergedAt":null,"state":"OPEN"}`. `gh run list --branch main --workflow CI --limit 5 --json headSha,conclusion,status,url,event` → `[]`. `git ls-remote --heads origin main` → `808a65117f0bfae3fca810fe49a746b53831d0bf refs/heads/main`. M0 remains pending.
- Nov 08 09:25 Istanbul · M2 · `bun install --frozen-lockfile` → `Checked 63 installs across 127 packages (no changes)`. `bun run check` → `tsc --noEmit` passed, Biome `Checked 48 files`, `92 pass`, `0 fail`, `1231 expect() calls`. This includes 13 scoring tests with seeded monotonicity trials, 15 feature tests, 33 reason-code tests, and existing database/simulator checks.
- Nov 08 09:25 Istanbul · M2 · `AFC_DB_PATH=:memory: bun run sim -- --seed 42` returned the calibrated stream:

  ```text
  SIMULATED DATA | seed=42 days=90 events=1268
  afc:sim:murk 218
  afc:sim:phoenix 456
  afc:sim:blaze 242
  afc:sim:atlas 338
  afc:sim:nova-7 14
  sha256=a9de2d8448468b5154eadb99b380d4c9300811c145117e43fd5bc4bcd48f9248
  ```

- Nov 08 09:26 Istanbul · M2 · The locked assertions in `bun test packages/core/test/score.test.ts` verify Atlas 778, Blaze 647, Murk 618, Nova-7 549 with low confidence and under review, and Phoenix 520 at day 30 → 691 at day 90. `bun -e` calling `scoreAgent(generateSimulation({seed:42}), id, SIMULATION_ANCHOR)` independently returned:

  ```text
  atlas 778 high active I03:hurts Q01:helps P04:helps
  blaze 647 high active P01:hurts C01:hurts I03:hurts P02:hurts
  murk 618 high active Q01:hurts Q02:hurts L01:hurts P03:hurts
  nova-7 549 low under_review F01:hurts F02:hurts I01:hurts C01:hurts
  phoenix 691 high active Q01:hurts Q02:hurts C02:hurts L02:hurts P04:helps
  phoenix-day30 520
  methodology afc-0.2 100 19
  ```

- Nov 08 09:26 Istanbul · M2 · `bun test packages/cli packages/db` → `9 pass`, `0 fail`. Upgrade tests verified that reseeding replaces selected legacy simulator events, preserves real sources and unselected personas, and rolls back on SQL failure. Methodology is exported from core for M5 API wiring.
- Nov 08 09:40 Istanbul · M0 · CI also passed on main's status-update commit `4941aa779c70f14403a97944b45f4d251536c0a7`. `gh run list --branch main --workflow CI` → `completed`, `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455608672)
- Nov 08 09:40 Istanbul · M2 · Rebased onto `4941aa7`; `bun run check` → `92 pass`, `0 fail`, `1231 expect() calls`. `gh run watch 42455703824 --exit-status` → `completed with 'success'` for PR #2 at `bd76fc61ad7e61100c71d98eb4a9bb0b7347d609`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455703824)
- Nov 08 10:29 Istanbul · M2 · `gh pr view 2 --json state,mergedAt,mergeCommit` → `MERGED`, commit `2e92a86dc4b43d8b9addf579d8756285446bb377`. `gh run list --branch main --workflow CI` → matching commit, `completed`, `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42458956765)
- Nov 08 10:39 Istanbul · M2 · Main's verification update `079c92432ef22fcf694fccecb4ea7f6c5aa0f724` also passed CI. `gh run list --branch main --workflow CI` → `completed`, `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42459109126)
- Nov 08 10:51 Istanbul · M3 · `bun install --frozen-lockfile` → `Checked 65 installs across 128 packages (no changes)`. `bun run check` → `tsc --noEmit` passed, Biome `Checked 63 files`, `134 pass`, `0 fail`, `1490 expect() calls`. Tests cover strict schemas, supplied citations, score preservation, one row per attempt, mocked HTTP success/errors, refusal, truncation, credential redaction and the direct-call boundary.
- Nov 08 10:51 Istanbul · M3 · `AFC_OFFLINE=1 AFC_DB_PATH=<temporary SQLite file> bun run serv:smoke` returned:

  ```jsonl
  {"job":2,"call_id":"a1227361-4321-4d63-8be1-617fd17f5238","offline":true,"status":"success"}
  {"job":3,"call_id":"3eed807b-c795-4a2a-b7aa-994d5797ada3","offline":true,"status":"success"}
  {"job":4,"call_id":"97f53912-9dcd-49d8-a281-9ab058f3d84c","offline":true,"status":"success"}
  {"job":7,"call_id":"102cdd88-2bd0-4e2e-a612-6f966f9de1b6","offline":true,"status":"success"}
  ```

- Nov 08 10:51 Istanbul · M3 · A read-only `bun:sqlite` query, `SELECT job,status,offline,response_id,usage_json,cost_json FROM serv_calls ORDER BY job`, returned:

  ```json
  [{"job":2,"status":"success","offline":1,"response_id":null,"usage_json":null,"cost_json":null},{"job":3,"status":"success","offline":1,"response_id":null,"usage_json":null,"cost_json":null},{"job":4,"status":"success","offline":1,"response_id":null,"usage_json":null,"cost_json":null},{"job":7,"status":"success","offline":1,"response_id":null,"usage_json":null,"cost_json":null}]
  ```

- Nov 08 10:51 Istanbul · M3 · UNSURE live proof. A conditional credential check returned `Live smoke UNSURE | SERV_API_KEY absent`. No live smoke ran, so M3 remains unchecked. The offline CLI test also passes with an explicitly empty key.
- Nov 10 11:49 Istanbul · M3 · Initial live smoke at 11:43 Istanbul logged three attempts. Jobs 2 and 3 succeeded; job 4 stopped with `truncated` after 1,024 completion tokens. Its call ID is `2aad01ad-a715-45cf-bd96-f772b71b3afc`. The full citation response exceeded the original limit. The job-4 budget was raised to 8,192 tokens with a 180-second timeout, and a full-citation regression test was added.
- Nov 10 11:49 Istanbul · M3 · `AFC_OFFLINE=0 bun run serv:smoke` exited 0 with a local SERV key configured. The explicit flag overrode the process's initial offline setting; the stored `offline=0` rows and provider metadata establish live execution. The successful run started at `2026-11-10T08:47:40.633Z` (11:47:40 Istanbul). All four newly created call IDs matched stored rows with `status=success`, `offline=0`, provider response IDs and positive token counts:

  | Job | Created at (UTC) | Call ID | SERV model | Prompt tokens | Completion tokens | Cached prompt tokens |
  |---|---|---|---|---:|---:|---:|
  | 2 | 2026-11-10T08:47:40.712Z | 67c48c14-7cb1-4467-a5dd-052b957c6843 | gpt-5.4-mini-serv-kronos-multipath | 235 | 144 | 0 |
  | 3 | 2026-11-10T08:47:43.641Z | c3686e9c-2376-4d17-a0f5-752a1c402489 | gpt-6-luna | 449 | 37 | 0 |
  | 4 | 2026-11-10T08:47:59.781Z | bb6438ef-808c-4da5-bbb6-a3f4028f6d53 | gpt-5.4-mini-serv-multipath | 4,968 | 4,544 | 4,864 |
  | 7 | 2026-11-10T08:48:22.363Z | fa7b5ed5-26a7-4914-83cd-a3ee8c9a07b4 | gpt-6-luna | 420 | 321 | 0 |

- Nov 10 11:49 Istanbul · M3 · A read-only query of `serv_calls` confirmed seven persisted live attempts across both runs: six successes and one truncation. The final run has exactly four successful rows for jobs `2,3,4,7`. A credential scan of all stored log fields and the exported metadata passed. [Recorded metadata](docs/evidence/serv-calls.sample.jsonl)
- Nov 10 11:49 Istanbul · M3 · `bun run check` → `tsc --noEmit` passed, Biome `Checked 63 files`, `135 pass`, `0 fail`, `1494 expect() calls`. `.env` remains gitignored.
- Nov 10 11:54 Istanbul · M3 · `gh pr view feat/m3-serv --json state,headRefOid,statusCheckRollup` → PR #3 `OPEN`, commit `69e465f9643169a3da44f1e6e8f09fd66823f931`, job `check` → `SUCCESS`. The publication hygiene and credential scans passed before push. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42786273795)
- Nov 10 12:15 Istanbul · M3 · `gh pr view 3 --json state,mergedAt,mergeCommit` → `MERGED`, commit `d2d355d8911838be66621f6e9ca0199c07ac1fd4`. `gh run watch 42788871372 --exit-status` → `completed with 'success'` on main. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42788871372)
- Nov 10 13:05 Istanbul · M4 · The removed `/agents/eval-requests/submit` route returned HTTP 404; the call journal and fixture retain that attempt. The deployed `agents.md` guide documents the replacement route and 440-credit rate. Validation was approved for up to 2,200 existing credits.
- Nov 10 13:05 Istanbul · M4 · `AFC_OFFLINE=0 bun run reppo:worker -- --drain` is processing the five approved queue IDs. Atlas completed with evaluation `cmwaiidfz000007i5qihmvy63`, provider status `COMPLETED`, score `80`, credits charged `440`, and one validated `source=reppo` event persisted. Four personas remain queued, so M4 stays unchecked.

- Nov 11 10:51 Istanbul · M4 · Read-only SQLite verification returned `settled=5`, `scoredEvents=5`, `credits=2200`. The journal contains five HTTP 201 submissions, ten HTTP 200 polls, and one earlier HTTP 404 on the retired endpoint. All 16 responses have sanitized fixtures.

  | Persona | Evaluation ID | Provider status | Score | Completed at (UTC) | Credits |
  |---|---|---|---:|---|---:|
  | afc:sim:atlas | `cmwaiidfz000007i5qihmvy63` | COMPLETED | 80 | 2026-11-10T09:54:33.828Z | 440 |
  | afc:sim:blaze | `cmwaj1ng9000107i564rgokox` | COMPLETED | 65 | 2026-11-10T10:09:28.439Z | 440 |
  | afc:sim:murk | `cmwajkymr000008jst9qwwcr3` | COMPLETED | 98 | 2026-11-10T10:24:40.472Z | 440 |
  | afc:sim:nova-7 | `cmwak48cc000108jsjdx7lq2x` | COMPLETED | 73 | 2026-11-10T10:39:17.669Z | 440 |
  | afc:sim:phoenix | `cmwaknixh000208jshh2w0av1` | COMPLETED | 70 | 2026-11-10T10:54:45.395Z | 440 |

- Nov 11 10:51 Istanbul · M4 · `REPPO_API_KEY="" AFC_OFFLINE=1 bun run reppo:worker -- --drain` settled a fixture job with `offline=true`, `eval_id=null`. The validated event had `source=simulator`, `simulated=true`, and quality 76.
- Nov 11 10:51 Istanbul · M4 · Exact milestone snapshot `bun install --frozen-lockfile` and `bun run check` passed with `152 pass`, `0 fail`, `1639 expect() calls`. Tests include 409/402 handling, concurrent claims, restart recovery, offline mode and response correlation.
