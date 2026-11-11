# PLAN: Nov 5 - Nov 15, 2026

Deadline: **Nov 15 23:59 UTC = Nov 16 02:59 Istanbul**. Code-complete target: **Nov 13 23:59 Istanbul**. Nov 14-15 are for the video, write-up, X post and form only.
All times Istanbul (UTC+3). Milestone IDs (M0-M10) match AGENTS.md and STATUS.md.

## Principles for the schedule
- Offline first: every feature works from fixtures with `AFC_OFFLINE=1`, so the demo never depends on a live API.
- Reppo is slow by design (one pending eval, about 15 min each). Start real evaluations on day 3 and keep the worker running in the background every day after.
- Ship a thin vertical slice (sim -> score -> API -> page) by Nov 9, then deepen.

## Day by day
| Date | Goal | Milestones | Exit check |
|---|---|---|---|
| Thu Nov 5 | Docs pack, repo, keys | - | repo public; Ozgur has SERV, Reppo keys in local `.env`; data collection on |
| Fri Nov 6 | Scaffold + event schema + simulator | M0, M1 | `bun run check` green; `bun run sim --seed 42` deterministic |
| Sat Nov 7 | Scorer + reason codes; SERV client + call log | M2, M3 (start) | golden persona ranges pass; first real SERV call logged |
| Sun Nov 8 | SERV jobs 2, 3, 4, 7; Reppo worker; first real evals | M3, M4 (start) | one real Reppo eval SETTLED and stored; fixture recorded |
| Mon Nov 9 | API + CLI; vertical slice | M4, M5 | `afc score --id afc:sim:atlas` and `GET /v1/score/...` match |
| Tue Nov 10 | Dashboard; **track checkpoint** | M6 | dashboard shows 5 personas, reason codes, SERV trace; Reppo integration live? (see fallbacks) |
| Wed Nov 11 | Fraud detectors + SERV job 5; Kite real-address adapter | M7 | Nova-7 capped with F01/F02 and SERV review; one real Kite address scored |
| Thu Nov 12 | Assistant log adapter (job 6); back-test; deploy | M8, M9 (start) | hosted URL serves the demo; AUC in README |
| Fri Nov 13 | Polish, one-command demo, README screenshots/GIF, fresh-clone test | M9 | **code complete**; fresh clone `bun install && bun run demo` works |
| Sat Nov 14 | Video, logo, write-up, X post draft, SERV evidence export | M10 | video uploaded and plays logged out; SUBMISSION.md answers final |
| Sun Nov 15 | Ozgur posts on X, submits form by 20:00 Istanbul (buffer) | M10 | confirmation saved; STATUS updated |

## Reppo evaluation budget
Keep the local policy at about 4 evals/hour, one at a time. The deployed API guide changed by Nov 10 and now lists 440 credits per text evaluation, with 22,000 initial credits. The current M4 validation is authorized for at most 2,200 existing credits across five personas. The longer-term target remains 20 demo evals, 10 Phoenix feedback cycles and 10 spare; 40 text evaluations would use 17,600 credits, about USD 8.80 equivalent at the guide's current conversion. Further spending remains an owner decision. Ask for partner credits through the OpenServ Telegram (see Nov 4 email) only if the sign-up credits run out.

## Fallbacks
| Risk | Trigger | Fallback |
|---|---|---|
| Reppo API blocked (keys, credits, outages) | no settled eval by Nov 9 evening | keep building on recorded fixtures; switch track to **Kite** on Nov 10 with KiteScan data as the hero; keep Reppo adapter code |
| Kite data too thin | real address returns < 10 transfers | score a busier public address for the demo (label "public address, not affiliated") and keep personas |
| SERV latency or cost | explanation > 10 s | cache by score hash; precompute explanations for personas; cheaper model for job 4 |
| Neither partner integration live | Nov 13 | **Open track**; the product still stands on SERV + simulator |
| Hosting fails | Nov 13 | record the video locally; keep `bun run demo` as the reproducible path; try a second host |
| Time | any slip | cut in this order: M8 assistant adapter, peer judging, back-test chart, Kite passport adapter. Never cut: SERV call log, reason codes, README quickstart, video |

## Demo script (2-3 minutes)
1. Problem (15 s): agents now pay and get paid; nobody can tell a reliable agent from a reckless one before handing over money or work.
2. Leaderboard (20 s): five agents (SIMULATED badge), scores 300-850, bands.
3. Atlas vs Blaze (30 s): factor bars, reason codes with cited events, trust memo written by SERV.
4. Murk (20 s): low Reppo quality; click an eval ID, show the Reppo critique and the SERV critique summary.
5. Nova-7 (20 s): fraud detectors + SERV fraud review; score capped, under review.
6. Phoenix (25 s): replay slider; agent acts on Reppo feedback, new verdicts land, score climbs. "Real-time feedback into measurable improvement" (Reppo track brief).
7. Score your own agent (20 s): `afc score --log my-agent.jsonl` and a real Kite address.
8. SERV trace (15 s): every SERV call with model, features (Multipath, Kronos, Shadow Agent, Prompt Guard), latency, tokens; OpenServ console usage view.
9. Close (10 s): open, free, MIT; URL; roadmap (repayment history, lender integrations).
