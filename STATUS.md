# STATUS.md: build checklist

Tick only with proof: time (Istanbul) + one-line proof (command output, PR or commit link). No proof, no tick.
Deadline: Nov 16 02:59 Istanbul (Nov 15 23:59 UTC). Code complete: Nov 13.

Last updated: Nov 05 16:42 Istanbul (docs pack)

## Now
Docs pack pushed. Next: M0 scaffold.

## Next
1. M0 scaffold, M1 events + simulator (Nov 6)
2. Ozgur: SERV and Reppo keys into local `.env`; enable data collection in the OpenServ console

## Setup (Ozgur)
- [x] Repo created, public, MIT (Nov 05)
- [ ] `SERV_API_KEY` in local `.env`; one SERV call succeeds
- [ ] Data collection enabled at console.openserv.ai/settings/organization (screenshot in `docs/evidence/`)
- [ ] Reppo account + API key in local `.env`; credits checked
- [ ] Partner credits requested via the OpenServ Telegram if needed (Nov 4 email)
- [ ] Hosting choice made

## Milestones (criteria in AGENTS.md)
- [ ] M0 Scaffold + CI
- [ ] M1 Events + DB + simulator (deterministic)
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
