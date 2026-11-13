# SUBMISSION: SERV Hackathon Edition 02

- Event page: https://www.openserv.ai/hackathon-2
- Form: linked from the event page ("Submit your project"), Typeform "Hackathon Edition 02 — Submit Your Project"
- Deadline: **Nov 15, 2026 23:59 UTC = Nov 16 02:59 Istanbul**. Our target: submitted by **Nov 15 20:00 Istanbul**.
- Nothing is submitted or posted without Ozgur's explicit OK. Ozgur posts on X and submits the form himself.

## Hard requirements (from the event page and FAQ, re-checked Nov 5)
| Requirement | Source wording (short) | Our deliverable | Done when |
|---|---|---|---|
| Use SERV Reasoning | "Every track needs to use SERV Reasoning"; write-up must explain "how it uses SERV Reasoning" | 7 SERV jobs (SPEC §5), all through one logged client | SERV trace panel shows real calls; `docs/evidence/serv-calls.sample.jsonl` committed; console screenshots in `docs/evidence/` |
| Public code repo | "Submit a public code repository" | this repo, MIT | public, README quickstart works on a fresh clone |
| Demo link or video | "a demo link or video" | hosted demo URL **and** a 2-3 min video | both open logged out |
| Short write-up | "what your project does, how it uses SERV Reasoning, and which track" | form field 7 + README sections | text below is final and matches the code |
| X post | "Share your submission on X by the deadline and include a link" | post tagging @openservai and @reppo with video/GIF | URL pasted in field 9 |
| Data collection | form asks "Is data collection enabled for your project?" | enabled at console.openserv.ai/settings/organization before the evidence run | screenshot in `docs/evidence/` |
| Logo | form asks for a logo or icon upload | `assets/brand/logo.png` (512x512) + `assets/brand/logo.svg` | files exist and the PNG is verified at 512 × 512 |
| Track fit | Reppo track: "Build reliable agents that turn real-time feedback into measurable improvements" | Reppo Eval API is the quality factor (35%); Phoenix shows feedback -> improvement -> higher score | real Reppo eval IDs visible in the dashboard and report |
| OpenServ account / API key | FAQ | `SERV_API_KEY` in local `.env` only | - |

## How we win
Judging criteria (event page): **creativity, user readiness, revenue potential.**

### Criterion -> deliverables -> acceptance criteria
| Criterion | What judges need to see | Repo deliverables | Acceptance criteria |
|---|---|---|---|
| **Creativity** | A new primitive, not another wrapper: a FICO-style score for agents that combines independently judged work quality (Reppo) with onchain payment behavior (Kite) and explains itself | score model + reason codes (SPEC §2-3); SERV-designed mystery-shopper probes; fraud reasoning; Phoenix improvement story | dashboard shows 5 distinct personas with different scores **for different, cited reasons**; one real Kite address scored |
| **User readiness** | Anyone can use it in minutes, and it looks finished | `bun install && bun run demo` (offline, no keys); hosted URL; polished dashboard; README with screenshots and GIF; free API; `afc` CLI to score your own agent from a log or Kite address; `/v1/methodology` | fresh clone to running dashboard in under 3 minutes (timed, logged in STATUS); hosted URL up during judging; README curl and CLI examples copy-paste and work; no console errors in the dashboard |
| **Revenue potential** | Who would pay later, even though the core is free | SPEC §11-12: hosted tier (rate limits, webhooks, bulk scoring for marketplaces), lender and insurer integrations, Reppo funding interest | README "Sustainability" section, 5 lines, concrete buyers; no paywall in the demo |
| **SERV usage (hard gate)** | SERV is essential and verifiable, not a token call | 7 jobs with Multipath, Kronos, Shadow Agent, Prompt Guard, structured outputs, prompt caching; `serv_calls` log; SERV trace panel; `/v1/serv-log` | every score in the demo links to its SERV calls; write-up lists each feature **on and off** with the reason |
| **Track fit (Reppo)** | Reppo Eval API is central | Reppo worker, eval IDs in reason codes, critique summaries, Phoenix re-evaluation | at least 20 real settled evals across personas; README table of eval IDs |

### Edition 01 winner lessons (applied)
- **ASSAY (best overall)** audited Robinhood Chain stock-token valuations against onchain data and caught real split errors. Lesson: show a concrete, real catch on real data. Our version: score a real Kite mainnet address and show what the score caught, next to the simulated personas.
- **Ledgerly (featured)** listed every SERV feature it used and why, including the ones deliberately turned off. Lesson: copy this; our write-up has a SERV feature table (SPEC §5).
- Other winners: Shijima, Payrun, CapitalRail; honorable mention SERVPIT. Common thread: one clear job, working demo, money-adjacent agent use case.
- Partner signal: @reppo named "FICO for agents (a trust score before an agent can spend money)" as especially interesting and said it is open to funding projects built on its Eval API (https://x.com/reppo/status/2117739480987930688). Mention it in the X post by tagging @reppo; do not overclaim an endorsement.

### Competitors seen on X this edition (positioning)
Kite track: spend-safety agents (for example SpendProof, Errand). Reppo track: feedback-gated replies (for example Reply Gate). Our angle: we do not build one more agent; we score all of them, using Reppo as the judge and Kite as the ledger.

## Form fields (21) with draft answers
Fields marked OZGUR are personal; fill on the day.

1. **Full name**: OZGUR
2. **Email**: OZGUR
3. **New to building with OpenServ?**: OZGUR
4. **Track** (Dolphin / Kite / Reppo / Open Track): **Reppo** (fallback Kite, see PLAN)
5. **New or existing project**: A new project
6. **Project name**: AgentFICO
7. **About the project** (what, who, problem, how): draft below
8. **Project URL** (demo, website or repo): hosted demo URL (repo goes in README and field 10)
9. **X post URL**: OZGUR, after posting
10. **Additional URL**: https://github.com/ozgureyilmaz/agentfico (or the video if the form prefers)
11. **Logo**: [512 px PNG](../assets/brand/logo.png)
12. **Data collection enabled?**: Owner reports yes. Add the console screenshot to [evidence](evidence/) before checking the proof item.
13. **Team**: OZGUR (likely "I'm participating solo")
14. **Agent-building experience**: OZGUR
15. **Country**: OZGUR
16. **Company or school**: OZGUR
17. **Current role**: OZGUR
18. **LinkedIn / GitHub / website**: https://github.com/ozgureyilmaz
19. **Experience with SERV**: OZGUR (honest notes: what worked, Kronos/Shadow Agent impressions, any friction)
20. **Quote permission**: OZGUR
21. **Updates opt-in**: OZGUR

### Draft submission assets

- [Typeform answers and field 7 draft](submission/writeup.md)
- [2:25 video script and shot list](submission/video-script.md)
- [X post draft](submission/x-post.md)
- [Logo SVG](../assets/brand/logo.svg) and [512 px PNG](../assets/brand/logo.png)

## Final checklist (tick in STATUS.md too)
- [ ] Code complete (Nov 13), fresh-clone test logged
- [ ] Hosted demo URL up, checked logged out
- [ ] README: pitch, GIF, screenshots, quickstart, API/CLI examples, SERV feature table (on/off), Reppo eval ID table, simulated-data notice, roadmap, sustainability, license, "not affiliated with FICO"
- [ ] `docs/evidence/`: SERV call log sample, console usage screenshot, data-collection screenshot
- [ ] Video 2-3 min, uploaded, plays logged out, link in README
- [x] Logo PNG + SVG ([assets](../assets/brand/), 512 × 512 PNG verified)
- [ ] X post drafted (tags @openservai and @reppo, link, GIF); Ozgur posts it
- [x] Field 7 text final and matches the code ([draft](submission/writeup.md), 1,763 characters)
- [ ] Ozgur OK to submit
- [ ] Form submitted by Nov 15 20:00 Istanbul; confirmation saved
