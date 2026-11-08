# STATUS.md: build checklist

Tick only with proof: time (Istanbul) + one-line proof (command output, PR or commit link). No proof, no tick.
Deadline: Nov 16 02:59 Istanbul (Nov 15 23:59 UTC). Code complete: Nov 13.

Last updated: Nov 08 10:51 Istanbul

## Now
M0–M2 are complete. PR #2 is merged, and CI passed on main at `2e92a86` and `079c924`. M3 is implemented locally on `feat/m3-serv`; 134 tests and the four-job offline smoke pass. Live-call proof and publication remain pending.

## Next
1. Obtain owner approval to push M3 and open its PR.
2. With a local SERV key and configured request settings, run `AFC_OFFLINE=0 bun run serv:smoke` and record the live rows before ticking M3.
3. Ozgur: Reppo key into local `.env`; enable data collection in the OpenServ console.
4. M4 single-flight Reppo queue.

## Setup (Ozgur)
- [x] Repo created, public, MIT (Nov 05)
- [ ] `SERV_API_KEY` in local `.env`; one SERV call succeeds
- [ ] Data collection enabled at console.openserv.ai/settings/organization (screenshot in `docs/evidence/`)
- [ ] Reppo account + API key in local `.env`; credits checked
- [ ] Partner credits requested via the OpenServ Telegram if needed (Nov 4 email)
- [ ] Hosting choice made

## Milestones (criteria in AGENTS.md)
- [x] M0 Scaffold + CI (Nov 08 09:38 Istanbul) — CI passed on the merged `main` commit `82699b1`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455536165)
- [x] M1 Events + DB + simulator (Nov 05 20:05 Istanbul) — seed 42 generated 1,401 simulated events for 5 personas. Replay matched byte for byte and retained 1,401 stored rows. See the verification log.
- [x] M2 Scorer + reason codes (Nov 08 10:29 Istanbul) — 92 tests passed, and CI passed on the merged main commit `2e92a86`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42458956765)
- [ ] M3 SERV client + call log + jobs 2, 3, 4, 7 (offline implementation verified; live-call proof pending)
- [ ] M4 Reppo worker + real evals per persona
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
- M3 live verification is UNSURE because `SERV_API_KEY` is absent from the local environment.
- M3 push and PR await owner approval.
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
