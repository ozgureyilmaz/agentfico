# STATUS.md: build checklist

Tick only with proof: time (Istanbul) + one-line proof (command output, PR or commit link). No proof, no tick.
Deadline: Nov 16 02:59 Istanbul (Nov 15 23:59 UTC). Code complete: Nov 13.

Last updated: Nov 08 09:38 Istanbul

## Now
M0 and M1 are complete. [PR #1](https://github.com/ozgureyilmaz/agentfico/pull/1) is merged, and CI passed on `main` at `82699b1`. M2 is ready locally on `feat/m2-scoring` for publication and review.

## Next
1. Rebase and publish M2, then open its PR.
2. Ozgur: SERV and Reppo keys into local `.env`; enable data collection in the OpenServ console

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
- [ ] M2 Scorer + reason codes (golden + property tests)
- [ ] M3 SERV client + call log + jobs 2, 3, 4, 7
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
