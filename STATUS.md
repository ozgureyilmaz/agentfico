# STATUS.md: build checklist

Tick only with proof: time (Istanbul) + one-line proof (command output, PR or commit link). No proof, no tick.
Deadline: Nov 16 02:59 Istanbul (Nov 15 23:59 UTC). Code complete: Nov 13.

Last updated: Nov 13 19:34 Istanbul

## Now
The Glacier demo is live on Render Free. Main CI, the fresh-clone run and public browser checks passed.

## Next
1. Record the voiceover and upload the video.
2. Publish the X post and complete the owner approval and form steps.
3. Add the OpenServ data-collection screenshot to the evidence folder.

## Setup (Ozgur)
- [x] Repo created, public, MIT (Nov 05)
- [x] `SERV_API_KEY` in local `.env`; one SERV call succeeds (Nov 10 11:49 Istanbul) — live call `67c48c14-7cb1-4467-a5dd-052b957c6843` succeeded with provider response ID and usage. See the verification log.
- [ ] OpenServ data collection — owner reports it is enabled. TODO add the console screenshot to [docs/evidence](docs/evidence/) before ticking.
- [x] Reppo account + API key in local `.env` (Nov 11 10:51 Istanbul) — five authenticated evaluations completed and used 2,200 credits.
- [ ] Partner credits requested via the OpenServ Telegram if needed (Nov 4 email)
- [x] Hosting choice made (Nov 13 09:06 Istanbul) — Render Free selected. [Validated configuration](docs/evidence/render-release-container.json)

## Milestones (criteria in AGENTS.md)
- [x] M0 Scaffold + CI (Nov 08 09:38 Istanbul) — CI passed on the merged `main` commit `82699b1`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455536165)
- [x] M1 Events + DB + simulator (Nov 05 20:05 Istanbul) — seed 42 generated 1,401 simulated events for 5 personas. Replay matched byte for byte and retained 1,401 stored rows. See the verification log.
- [x] M2 Scorer + reason codes (Nov 08 10:29 Istanbul) — 92 tests passed, and CI passed on the merged main commit `2e92a86`. [Run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42458956765)
- [x] M3 SERV client + call log + jobs 2, 3, 4, 7 (Nov 10 12:15 Istanbul) — four live jobs succeeded; 135 tests passed; merged main CI passed at `d2d355d`. [Main run proof](https://github.com/ozgureyilmaz/agentfico/actions/runs/42788871372)
- [x] M4 Reppo worker + real evals per persona (Nov 11 10:51 Istanbul) — five live completions, 2,200 credits, five scored events and 152 passing tests. [Recorded responses](fixtures/reppo/real/) [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985638789)
- [x] M5 API + CLI (Nov 11 10:53 Istanbul) — five exact score, factor and reason-code matches, an offline provisional upload, and 174 passing tests. [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985745755)
- [x] M6 Dashboard (Nov 11 10:55 Istanbul) — browser flows passed at desktop and 390 px, with 186 passing tests. [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985808699)
- [x] M7 Fraud detectors + SERV fraud review + real Kite address (Nov 12 09:03 Istanbul) — six detectors tested, Nova-7 642 → 549, and the public Kite mainnet address scored 649 with partial coverage. [Detector and offline review proof](docs/evidence/nova-fraud-review.json) · [Kite capture](fixtures/kite/real/kitescan-mainnet-0xd9bee9d8d294b01f716c77b3c5953035a15ed2d2.meta.json) [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205141595)
- [x] M8 Probe plans + assistant log mapping (Nov 12 09:10 Istanbul) — persisted three probes, settled one offline evaluation, mapped four assistant events and verified both browser scoring inputs. [Proof](docs/evidence/probe-and-upload.json) [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205214626)
- [x] M9 Ship (Nov 13 19:34 Istanbul) — 20 settled evaluations, AUC 0.821, clean clone in 2.531 s, and the hosted demo verified. [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43462115828) · [Public evidence](docs/evidence/hosted/)
- [ ] M10 Submission assets — [logo](assets/brand/), [video script](docs/submission/video-script.md), [Typeform draft](docs/submission/writeup.md), and [X draft](docs/submission/x-post.md) prepared. The hosted capture was rendered locally. Owner publication and submission steps are pending. [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43462253692)

## How-we-win gates (from AGENTS.md)
- [x] SERV trace panel + `/v1/serv-log` + committed sample log (Nov 12 09:21 Istanbul) — browser loaded the trace with token usage and the demo imported recorded call metadata. [Hosted browser proof](docs/evidence/hosted/) · [Live sample](docs/evidence/serv-calls.sample.jsonl)
- [x] 20+ real settled Reppo evals, eval IDs clickable (Nov 13 09:06 Istanbul) — 20 distinct completions and 20 working dashboard links. [Evaluation index](docs/evidence/INDEX.md#settled-reppo-evaluations) · [Browser proof](docs/evidence/release-audit.json)
- [x] Fresh clone to dashboard < 3 min (Nov 13 19:34 Istanbul) — `bun install && bun run demo` on published main reached the dashboard in 2.531 s without `.env`. [Proof](docs/evidence/freeze-main.json)
- [x] Hosted URL live (Nov 13 19:34 Istanbul) — health check and both browser widths passed. [Live demo](https://agentfico-free-demo.onrender.com) · [Browser evidence](docs/evidence/hosted/)
- [x] Score-your-own-agent works (log, Kite address, upload) (Nov 12 09:10 Istanbul) — browser and CLI scores match for the assistant log (632) and recorded Kite address (649). [Proof](docs/evidence/probe-and-upload.json)
- [x] Real Kite address scored and shown (Nov 12 09:10 Istanbul) — mainnet public address displayed at desktop and 390 px with partial coverage and a provisional score of 649. [Browser proof](docs/evidence/probe-and-upload.json) · [Live capture](fixtures/kite/real/)
- [x] README: screenshots, GIF, SERV feature on/off table, sustainability (Nov 13) — the [README](README.md) includes the live URL, expected Free cold start, screenshots and the [12-second GIF](assets/demo.gif).
- [ ] Video 2–3 min, link: [video url]
- [x] Logo PNG + SVG (Nov 12 14:29 Istanbul) — SVGs parse; 512 and 1024 px in both colorways; favicon set, 1200 × 630 Open Graph, and 1500 × 500 X artwork verified. [Brand files](assets/brand/)

## Submission (Ozgur)
- [x] Field 7 final (Nov 13 19:35 Istanbul) — 1,841 characters with 209 tests, 20 evaluations and the live URL. [Form draft](docs/submission/writeup.md)
- [ ] X post published, link: [x post url]
- [ ] Ozgur OK to submit
- [ ] Form submitted, confirmation saved

## Blockers / open questions
- Kite mainnet transfer coverage remains partial. The explorer repeated its next page key; the provisional score uses 50 distinct transfer logs.
- Reppo balance verified at 13,200 credits after the approved batch.

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

- Nov 11 10:53 Istanbul · M5 · Named `bun run afc -- score --id` and HTTP `GET /v1/score/:afcId` against the same isolated database matched score, factors and reason codes for all five agents. Atlas `776`, Blaze `645`, Murk `657`, Nova-7 `549`, Phoenix `691`. This snapshot includes the five recorded live verdicts.
- Nov 11 10:53 Istanbul · M5 · Offline `bun run afc -- score --log examples/my-agent.jsonl` returned `score=604`, `saved=false`, `simulated_share=1`. `bun run afc -- evaluate --samples examples/samples.jsonl --category shopping --simulated` in offline mode returned `queued`, `offline=true`, `eval_id=null`.
- Nov 11 10:53 Istanbul · M5 · Exact milestone snapshot `bun install --frozen-lockfile` and `bun run check` passed with `174 pass`, `0 fail`, `1901 expect() calls`. Kite parsing and CLI fixture scoring are verified. The real-address mainnet demonstration remains UNSURE for M7.

- Nov 11 10:55 Istanbul · M6 · `bun run --filter @agentfico/web build` exited 0. Browser verification against the locally served production build returned `leaders=5`, `factor_bars=6`, `event_dialog=pass`, `real_eval_id=pass`, `trace=pass`, `phoenix_early=518`, `phoenix_latest=691`, `upload_score=604`, `saved=false`, `mobile_width=390`, `page_width=390`, `console_errors=0`. The browser console reported zero warnings. Replay uses simulated histories with recorded scores computed by the API.
- Nov 11 10:55 Istanbul · M6 · `bun install --frozen-lockfile` and `bun run check` passed with `186 pass`, `0 fail`.

- Nov 11 11:17 Istanbul · M4 · PR #4 merged into main at `e6d5248266cce16a58c7f46d96f8d3609f5fdcb5`. The push workflow completed with `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985638789)

- Nov 11 11:17 Istanbul · M5 · PR #5 merged into main at `92a300eacb930f1a652392d5d8584daefb4a7ef9`. The push workflow completed with `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985745755)

- Nov 11 11:17 Istanbul · M6 · PR #6 merged into main at `8ce50e0ea732ebf6230edefbc9fe8e05d4cab141`. The push workflow completed with `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985808699)

- Nov 12 09:03 Istanbul · M7 · `bun run check` → `197 pass`, `0 fail`. Seed 42 emitted 1,266 events with SHA-256 `0cce410724a9ca97770462e5ee4e28c3e6f52f9e6158511109a504ae9f2014c3`; Nova-7 uses detector inputs without prewritten flags.
- Nov 12 09:03 Istanbul · M7 · `GET /v1/report/afc:sim:nova-7` → before `642`, after `549`, `under_review`, F01/F02; `GET /v1/serv-log?job=5` includes `3b42d0e1-c761-4268-a0b7-2406e04d850e` (offline, successful). [Report and trace](docs/evidence/nova-fraud-review.json)
- Nov 12 09:03 Istanbul · M7 · Kite mainnet chain `2366`, public address `0xD9bee9d8d294b01f716c77B3C5953035A15Ed2d2`, captured Nov 11 at `08:21:55Z`, blocks `122771–2301185`. Live CLI and recorded replay scored `649`, `simulated_share=0`, `PARTIAL_COVERAGE`. The replay stops after two responses when the pagination key repeats. [Capture and raw responses](fixtures/kite/real/)

- Nov 12 09:10 Istanbul · M7 · [PR #7](https://github.com/ozgureyilmaz/agentfico/pull/7) opened at `a1ca685`. [PR CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43165723238) completed successfully. [Main CI proof update](https://github.com/ozgureyilmaz/agentfico/actions/runs/43165568701) passed at `cb7ce5a`.
- Nov 12 09:10 Istanbul · M8 · `afc probe plan` stored `777a8271-ab45-4c42-adb0-a4984dacac06`, three probes. `afc probe enqueue` queued one batch and `bun run reppo:worker -- --drain` settled it with `offline=true`, `eval_id=null`. `afc map-log` logged four job 6 calls and returned four validated events. [Trace IDs](docs/evidence/probe-and-upload.json)
- Nov 12 09:10 Istanbul · M8 · Browser at 1280 and 390 px returned log `score=632`, `saved=false`, Kite `score=649`, `PARTIAL_COVERAGE`, `simulated_share=0`, and `console_errors=0`. `bun run check` → `205 pass`, `0 fail`. [Browser proof](docs/evidence/probe-and-upload.json)

- Nov 12 14:00 Istanbul · M7 · PR #7 merged into main at `23407561c4dfae5244d1430c178d391b535d7320`. The push workflow completed with `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205141595)

- Nov 12 14:00 Istanbul · M8 · PR #8 merged into main at `8789ada0137604375c04158067169df8638a1d24`. The push workflow completed with `success`. [GitHub Actions run](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205214626)

- Nov 12 09:16 Istanbul · M9 · `bun run backtest` scored all 200 simulated subjects, with 62 holdout incidents and AUC `0.8208274894810659`. [Exact output](docs/evidence/simulated-backtest.json)
- Nov 12 09:21 Istanbul · M9 · Fresh local clone at `057f390`, with no `.env`: `bun install && bun run demo` → health and dashboard ready in `3.301s` including clone. Fresh-clone `bun run check` → `208 pass`, `0 fail`. Browser desktop and 390 px checks reported zero console errors and no horizontal overflow. [Timing and metrics](docs/evidence/demo-browser.json)
- Nov 12 09:22 Istanbul · M9 · Reppo preflight confirmed `19,800` credits available at `440` per text evaluation. Phoenix follow-up `cmwd5ia5r000008l8wqzthd4r` completed at `100` after the earlier verdict at `70`; the dashboard returned `696`. [Sanitized batch proof](docs/evidence/reppo-batch.json)

- Nov 12 14:05 Istanbul · M7–M8 proof commit `a71df4c` passed 205 tests and [main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205755903).
- Nov 12 14:00 Istanbul · M9 · Reconciled 11 settled evaluations, `4,840` credits charged and `14,960` available. Reppo showed 16 completed evaluations overall and no in-flight evaluation, so the interrupted attempt had no provider ID or charge. The worker resumed the four remaining evaluations at the existing pace. [Journal proof](docs/evidence/reppo-batch.json)

- Nov 12 14:09 Istanbul · M9 · Render image from `6ae6d74` passed at 512 MiB with no keys or disk mount. On recreation, the same fixture agents loaded. `/healthz` returned OK; assistant log 632, Kite 649, Nova-7 549, saved upload HTTP 403 and evaluation HTTP 503. [Local container proof](docs/evidence/render-container.json)

- Nov 13 09:06 Istanbul · M9 · Reppo recorded all 15 approved evaluations as completed at 440 credits each, totaling 6,600 for M9. The account showed 20 completed evaluations and 13,200 credits available. The final ID was `cmwdhd6f2000007lf37r27ost`. [Batch evidence](docs/evidence/reppo-batch.json)
- Nov 13 09:06 Istanbul · M9 · Clean clone at `760f6b2`: `bun install && bun run demo` reached the dashboard in 7.862 seconds including clone, with no `.env`. `bun run check` passed 209 tests. Browser checks at 1280 and 390 px found 20 clickable evaluation IDs and zero console errors. The latest Phoenix replay returned 708. [Release audit](docs/evidence/release-audit.json)
- Nov 13 09:06 Istanbul · M9 · The 512 MiB Linux container rebuilt SQLite on restart and returned the same six agents, with no disk or keys. Log upload returned 632 and Kite replay 649. Save returned 403 and evaluation submission 503. [Container proof](docs/evidence/render-release-container.json)

- Nov 12 09:25 Istanbul · M10 drafts · [Submission drafts](docs/submission/) and [brand assets](assets/brand/) created. `sips -g pixelWidth -g pixelHeight assets/brand/logo.png` → `512 × 512`. The video, X post, approval, and form submission stay unchecked.
- Nov 12 14:12 Istanbul · M10 · Production build emitted the SVG and 512 × 512 PNG as favicons. Field 7 is `1763` characters, video script is `2:30`, and the two lowercase X variants fit within 280 characters with both links. [Submission drafts](docs/submission/)

- Nov 12 14:29 Istanbul · M10 brand · Regenerated the brand kit in a temporary copy with `python3 assets/brand/generate_assets.py`. Every output matched byte for byte or pixel for pixel; SVGs parsed and PNG and ICO dimensions were verified. [Usage and assets](assets/brand/brand.md)

- Nov 13 09:09 Istanbul · M10 visual pass · `bun run check` → 209 pass, 0 fail. Hosted-mode Chromium at 1280 × 900 and 390 × 844 → 11 views per size, zero console errors and zero horizontal overflow. Scores, factor values, event and evaluation IDs, and inspected link targets matched M9. The lowest sampled body and metadata contrast was 5.21:1. [Screenshots and browser results](docs/evidence/visual/)
- Nov 13 09:09 Istanbul · M10 video · `bash video/render.sh` → 13 scenes, zero console errors or external requests. `ffprobe` → 164 s, 1920 × 1080, 30 fps and stereo AAC at 48 kHz. Audio decoded to silence. [Script](docs/submission/video-script.md)

- Nov 13 09:14 Istanbul · M10 rebase · Verified the visual pass against M9 `0e3c6b9` with all 20 verdicts. Both viewport suites matched the same score and citation data. A clean local clone with no `.env` started with `bun install --frozen-lockfile && bun run demo`. `/healthz` returned OK. Rebased `bun run check` → 209 pass, 0 fail. [Browser proof](docs/evidence/visual/browser.json)
- Nov 13 09:15 Istanbul · M10 final video · Re-rendered from the 20-verdict demo. All 13 scenes passed capture, including Phoenix 519 → 708 and a clicked Reppo citation. `ffprobe` → 164 s, 1920 × 1080, 30 fps. Decoded stereo peak was `-inf` dB. [Render evidence](docs/evidence/visual/video.json)

- Nov 13 19:24 Istanbul · M9 · PR #9 merged at `dd474223a7659e72ef66c8c8333765a85fc689ef` and passed [main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43462115828).

- Nov 13 19:24 Istanbul · M10 · PR #10 merged at `bb65090d0653ed28127916a743fde5a698a0ba20` and passed [main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43462253692).

- Nov 13 19:34 Istanbul · Freeze · Published main `ce00e03` passed 209 tests. [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43462550401) · [Fresh clone proof](docs/evidence/freeze-main.json)
- Nov 13 19:34 Istanbul · Hosting · Render deployed `ce00e03`. Public Chromium at 1280 and 390 px passed 11 views each, all 20 evaluation links, log score 632, Kite score 649 and Nova-7 642 → 549. Both widths had zero console errors and overflow. [Deployment](https://dashboard.render.com/web/srv-dbrammgae00c73f3tqkg/deploys/dep-dbrjli0u01pc73beq9rg) · [Hosted screenshots and proof](docs/evidence/hosted/)

- Nov 13 19:45 Istanbul · M10 video · Public capture completed all 13 scenes. `ffprobe` → 164.000 s, 1920 × 1080, 30 fps, 9,304,361 bytes. Captions are burned in and the decoded stereo audio peak was `-inf` dB. [Render proof](docs/evidence/hosted/video.json)
