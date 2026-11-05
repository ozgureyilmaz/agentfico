# AgentFICO spec (v0.2)

AgentFICO is an open, free trust score for AI agents: a number from 300 to 850 that says how an agent has behaved, built only from what the agent actually did. Anyone can read it before letting an agent spend money, take a task, or join a marketplace.

This file is the source of truth for the score model, event schema, personas, SERV Reasoning usage and partner integrations. Build decisions live in `docs/DECISIONS.md`; the schedule in `docs/PLAN.md`.

Contents
1. Principles
2. Score model (factors, math, bands, confidence)
3. Reason codes
4. Event schema and adapters
5. SERV Reasoning usage (and the SERV call log)
6. Reppo Eval API
7. Kite
8. Simulator and personas
9. API and CLI
10. Anti-gaming
11. Who consumes the score
12. Roadmap and sustainability
13. References

---

## 1. Principles
1. **Behavior only.** The score uses what an agent did: judged work quality, payment conduct, reliability, consistency, identity age and anomaly signals. No self-description, no marketing claims, no paid boosts.
2. **Deterministic math, reasoned explanations.** Numbers come from pure TypeScript functions with a version string (`afc-0.2`). SERV Reasoning designs tests, writes rubrics, summarizes critiques, explains reason codes and reviews fraud patterns. An LLM never sets the number. SERV output can add a flag; it can never raise a score.
3. **Open and free.** MIT code, free score lookups, published methodology (`GET /v1/methodology`). No x402 paywall and no lending in this project.
4. **Honest data labels.** Every event carries `simulated: true|false`. Simulated data is badged everywhere (UI, API, CLI, README).
5. **Every claim is traceable.** Each reason code cites event IDs; each Reppo-based factor cites eval IDs; each SERV call is logged and viewable.

## 2. Score model

### 2.1 Factors and weights (afc-0.2)
Repayment and credit utilization were removed (see Roadmap). Weights sum to 100.

| Factor | Weight | Signals | Sources |
|---|---|---|---|
| **Q Work quality** | **35** | confidence-weighted mean Reppo `verdict.score`; reject/revise rate; per-criterion weak spots; manipulation downgrades | Reppo Eval API (`work.evaluated`) |
| **P Payment conduct** | **20** | failed payments; Kite session-limit violations (`session_rule_exceeded`, `session_total_exceeded`, `session_endpoint_forbidden`); refunds and disputes; counterparty diversity | KiteScan transfers, `kpass activity` (owner opt-in), assistant logs |
| **L Reliability** | **15** | endpoint uptime and latency (probes); task completion rate; actions reversed by the user | probes, assistant logs, task events |
| **C Consistency** | **10** | variance of daily spend; spike share; variance of quality scores; sudden behavior drift vs the agent's own baseline | all event streams |
| **I Identity and history** | **10** | wallet/agent age (first event); owner link (Passport owner, ERC-8004 entry); funding-source diversity | KiteScan address data, registries |
| **F Integrity** | **10** | absence of anomalies: circular/wash flows, sybil clusters, broken log chains, flagged counterparties | code detectors + SERV fraud review |

### 2.2 Math (pure functions, `packages/core/src/score.ts`)
```
decay weight of an event:  w = exp(-ln2 * age_days / half_life_days)
for each factor f: sub_f in [0,1] from decayed events (formulas below)
raw    = sum(weight_f * sub_f) / 100
score  = round(300 + 550 * raw) - penalties, clamped to [300, 850]
```
Sub-scores (all inputs decayed; `clamp` to [0,1]):
- `Q = sum(cw * reppo_score/100) / sum(cw) - 0.25 * reject_rate`, with confidence weights high 1.0, medium 0.7, low 0.4.
- `P = 0.40*(1 - fail_rate) + 0.30*(1 - clamp(violations_per_100_payments / 5)) + 0.15*(1 - clamp(5 * dispute_refund_rate)) + 0.15*counterparty_entropy_norm`
- `L = 0.40*uptime + 0.20*latency_score + 0.40*completion_rate` where `latency_score = 1 - clamp((p50_ms - 800) / 4200)` and user reversals count as failed tasks.
- `C = 0.50*(1 - clamp(cv_daily_spend / 2)) + 0.30*(1 - clamp(stdev_quality / 25)) + 0.20*(1 - drift_score)`
- `I = 0.60*min(1, ln(1+age_days)/ln(366)) + 0.20*owner_linked + 0.20*funding_diversity`
- `F = 1 - clamp(sum(anomaly_severity))` (severity per detector: 0.2 low, 0.5 medium, 1.0 confirmed)

Penalties and caps:
- Confirmed wash or sybil flag (F01/F02 at severity 1.0): cap score at **549** and set `status: "under_review"`.
- Reppo reported manipulation of its own verdict (Q04): **-40** per event in the last 60 days, max -120.
- Thin file (fewer than 3 Reppo verdicts, or fewer than 10 events, or age under 7 days): `confidence: "low"`, cap at **649**. Below 3 events total: return `score: null` with `status: "insufficient_history"`.

Half-lives: positive behavior 90 d; violations and failures 120 d; fraud flags 365 d; Reppo verdicts 60 d (quality drifts as models and prompts change). In simulator time, 1 sim-day can be 1 real minute so decay is visible live.

Weights and formulas are constants in one file with a version string. Changing them = new `model_version` + a DECISIONS.md entry + updated golden tests.

### 2.3 Bands
| Score | Band |
|---|---|
| 800–850 | Exceptional |
| 740–799 | Very good |
| 670–739 | Good |
| 580–669 | Fair |
| 300–579 | Poor |

AgentFICO does not make credit or access decisions. Consumers map bands to their own policy (Section 11).

### 2.4 Confidence
`high` when at least 10 Reppo verdicts, 50 events and 30 days; `medium` above the thin-file thresholds; `low` otherwise. Also report `simulated_share` (fraction of decayed weight from simulated events).

## 3. Reason codes
Each score returns the top 4 codes that lowered it and the top 2 that helped, each with the event IDs (and eval IDs) behind it. Codes and their triggers are fixed in `packages/core/src/reasons.ts`; SERV only writes the sentence.

| Code | Meaning | Trigger (sketch) |
|---|---|---|
| Q01 | Low independently judged work quality | Q sub-score < 0.6 |
| Q02 | High reject or revise rate on sampled work | reject+revise > 30% |
| Q03 | Too few work samples evaluated | < 3 Reppo verdicts |
| Q04 | Attempted to manipulate the judge | Reppo downgrade for manipulation |
| P01 | Spending-limit violations | any Kite session error in 90 d |
| P02 | Failed payments | fail_rate > 5% |
| P03 | Refunds or disputes | dispute_refund_rate > 2% |
| P04 | Low counterparty diversity | entropy_norm < 0.3 |
| L01 | Endpoint unreachable or slow | uptime < 95% or p50 > 3 s |
| L02 | Low task completion or user reversals | completion < 85% |
| C01 | Erratic spend spikes | cv_daily_spend > 1.2 |
| C02 | Volatile work quality | stdev_quality > 15 |
| C03 | Sudden behavior change | drift_score > 0.5 |
| I01 | New or short history | age < 30 d |
| I02 | Funding concentrated in one source | funding_diversity < 0.3 |
| I03 | No verified owner link | owner_linked = 0 |
| F01 | Circular or wash payments | cycle A->B->A within 24 h above threshold |
| F02 | Linked to a sybil cluster or flagged wallet | shared funder with >= 5 fresh wallets |
| F03 | Broken or unsigned log chain | hash-chain gap on an attested source |

Positive codes reuse the same IDs with `direction: "helps"` (for example Q01 helps = consistently high judged quality).

## 4. Event schema and adapters
All sources map into one zod-validated `BehaviorEvent` (`packages/core/src/events.ts`). Simulated and real events use identical code paths; only the badge differs.

```ts
type BehaviorEvent = {
  event_id: string;              // ULID
  subject: {
    afc_id: string;              // "afc:kite:0xabc...", "afc:asst:<id>", "afc:sim:atlas"
    links?: { kite_address?: string; passport_id?: string; erc8004?: string;
              reppo_account?: string; assistant_id?: string; owner_ref?: string };
  };
  source: "kite_chain" | "kite_passport" | "reppo" | "assistant" | "probe" | "simulator";
  simulated: boolean;            // true for every Phase-1 event; shown as a badge
  attestation: "self_reported" | "platform_signed" | "onchain";
  type: EventType;
  occurred_at: string;           // ISO-8601 UTC
  amount?: { value: string; currency: "USDC" | "USD"; decimals: 6 };
  counterparty?: { id: string; kind: "merchant" | "agent" | "user" | "unknown" };
  outcome?: "success" | "failure" | "reversed" | "disputed";
  evidence?: { tx_hash?: string; eval_id?: string; url?: string; log_hash?: string };
  attrs?: Record<string, unknown>; // e.g. { reppo_score: 81, confidence: "high" }
  prev_hash?: string;            // hash chain per source
  sig?: string;                  // ed25519 over canonical JSON (Phase 2)
};

type EventType =
  | "identity.registered" | "identity.linked"
  | "payment.sent" | "payment.received" | "payment.failed"
  | "payment.limit_violation" | "payment.refund" | "payment.dispute"
  | "work.evaluated" | "work.probe_sent" | "task.completed" | "task.failed"
  | "action.performed" | "action.reversed_by_user" | "action.complaint"
  | "probe.uptime" | "probe.latency"
  | "anomaly.flagged";
```
Weights scale with attestation: self_reported 0.5, platform_signed 0.8, onchain 1.0.

| Adapter | Reads | Emits | Phase |
|---|---|---|---|
| `SimulatorAdapter` | the persona generator | any type, `simulated: true` | 1 |
| `ReppoAdapter` | `GET /agents/eval-requests/{evalId}` | `work.evaluated` {reppo_score, decision, confidence, route, criteria[]} | 1 (real API on simulated work) |
| `KiteChainAdapter` | KiteScan v2 token transfers (USDC.e) and address info | `payment.*`, `identity.registered` (first tx = age) | 2 |
| `KitePassportAdapter` | `kpass activity --output json` from an owner who opts in | `payment.sent`, `payment.limit_violation` | 2 |
| `AssistantLogAdapter` | JSONL action logs from personal AI assistants | `action.*`, `payment.*`, `task.*`; unknown lines mapped by SERV job 6 | 2 |
| `ProbeAdapter` | mystery-shopper calls and uptime pings | `work.probe_sent`, `probe.*` | 2 |

Pipeline: ingest -> validate (zod) -> dedupe (event_id + evidence hash) -> store -> features (decay) -> scorer -> reason codes -> SERV explainer.

## 5. SERV Reasoning usage
SERV Reasoning is OpenAI-compatible: base `https://inference-api.openserv.ai/v1`, `Authorization: Bearer $SERV_API_KEY`, use the `openai` SDK with `baseURL`. A system prompt is mandatory. Every call uses `response_format: { type: "json_schema", strict: true }`. Model IDs and feature suffixes come from env (`AFC_MODEL_*`), never hard-coded in logic.

| # | Job | Model (env default) | SERV features | Output |
|---|---|---|---|---|
| 1 | **Sampling plan**: given an agent category and declared capabilities, design N probe tasks with checkable expected properties and timing jitter | `AFC_MODEL_PLANNER` = `gpt-5.4-mini-serv-multipath` | Multipath (category branches) + `serv_shadow_agent` (hint: every probe must be objectively checkable and must not look like a test) | `ProbePlan` JSON |
| 2 | **Rubric**: category -> Reppo `criteria[]` (max 10, each max 2 KB) plus `context` | `AFC_MODEL_RUBRIC` = `gpt-5.4-mini-serv-kronos-multipath` | Kronos (audits and repairs the reasoning prompt), prompt caching per category | `Rubric` JSON |
| 3 | **Critique summary**: cluster Reppo critiques into recurring weaknesses behind Q codes | `AFC_MODEL_SUMMARY` = `gpt-6-luna` | `serv_shadow_agent` (hint: each weakness must quote a critique ID) | `CritiqueSummary` JSON |
| 4 | **Reason-code text and trust memo**: fixed codes + factor deltas + cited events -> plain sentences and a one-paragraph memo | `AFC_MODEL_EXPLAIN` = `gpt-5.4-mini-serv-multipath` | Multipath (reader type: marketplace, merchant, agent owner, lender), `serv_shadow_agent` (hint: cite at least one event_id per code; state no number that is not in the input) | `Explanation` JSON |
| 5 | **Fraud reasoning**: code flags a subgraph (cycles, shared funders, bursts); SERV picks the typology (wash, sybil ring, bust-out, benign) and what evidence to pull next | `AFC_MODEL_FRAUD` = `claude-sonnet-5-serv-kronos-multipath` | Kronos, Multipath, `serv_shadow_agent` (max_iterations 3), `serv_prompt_guard` | `FraudReview` JSON (can only add a flag) |
| 6 | **Log mapping**: unknown assistant log line -> `BehaviorEvent` | `AFC_MODEL_MAPPER` = `gpt-6-luna` | structured output + `serv_prompt_guard` | `BehaviorEvent` candidate (re-validated by zod) |
| 7 | **Simulated work generation**: produce real work samples for personas at a target quality, which Reppo then judges | `AFC_MODEL_SUMMARY` | none | text samples |

Deliberately **off**: `serv_disable_content_filter` (never needed); Kronos on cheap jobs 3, 6 and 7 (cost); Multipath on job 6 (single path is enough). The write-up must list every feature on and off with the reason (Edition 01 lesson).

Untrusted text (agent outputs, assistant logs, memos) always goes through `serv_prompt_guard` before it reaches a SERV prompt.

### 5.1 SERV call log (judges must be able to verify usage)
Every SERV call goes through one wrapper (`packages/serv/src/client.ts`) that writes a row to `serv_calls`:
`id, created_at, job (1-7), afc_id, model, features[] (suffixes), tools[] (+ hints), response_id, status, latency_ms, usage (prompt/completion/cached tokens as returned), cost if returned, prompt_guard result if returned, shadow-agent info if returned, input_sha256, output_sha256, output_preview (first 300 chars, redacted)`.

Only store fields the API actually returns; check the docs (structured-outputs, tools, usage-and-billing) and do not invent fields. Never store the API key or Authorization headers.

Visible in three places:
1. Dashboard **"SERV trace"** panel: per score, the list of SERV calls that produced the plan, rubric, summary, explanation and fraud review, with model, features, latency and tokens.
2. `GET /v1/serv-log?afc_id=&job=&limit=` (public, redacted) and `bun run afc serv-log`.
3. A committed sample `docs/evidence/serv-calls.sample.jsonl` from a real run, plus console screenshots (Usage and Shadow Agent views at console.openserv.ai) in `docs/evidence/`.

Data collection must be enabled at console.openserv.ai/settings/organization before the evidence run (form question 12).

## 6. Reppo Eval API (track partner; central to the product)
- Base `https://eval.reppo.xyz/api/v1`; `Authorization: Bearer $REPPO_API_KEY` (key created in the console, shown once).
- Submit: `POST /agents/eval-requests/submit` with `{ type: "answer"|"plan"|"trace"|"artifact", payload (max 50 KB), criteria[] (0-10, max 2 KB each), context? (max 32 KB), attachments? (max 1, max 2 MB), settlementMinutes? (10|15|30|60|120|360|720|1440, default 15) }` -> `201 { id, evalId, status: "PENDING" }`. Errors: 400, 401, 402 (no credits), 409 (a pending eval already exists).
- Read: `GET /agents/eval-requests/{evalId}` -> `status PENDING|SETTLED|FAILED`; on SETTLED `result.verdict { score 0-100, decision accept|revise|reject, confidence }`, `result.verdicts[{ criterion, score 0-10, critique }]`, `action.route auto-ship|review|block`, `evidence`, `peerAssessments`.
- **One pending evaluation per account.** Results come about 5 minutes after the window closes, so about 4 evaluations per hour. Design: batch 3-5 samples of one agent per `trace` payload with per-sample criteria; a single-flight worker (submit, poll every 60 s, store, next); precompute and cache verdicts; score reads never wait on Reppo; handle 409 by resuming the stored pending eval.
- Cost: 100 credits (1 cent) per settled eval, failed is free. Sign-up credits exist; partner credits for the hackathon are offered through the OpenServ Telegram (Nov 4 email).
- Peer judging (`GET /agents/eval-requests/pending`, `POST /agents/eval-requests/{evalId}/assessments`) is free; optional stretch: AgentFICO as a peer judge.
- Reppo also downgrades `accept` to `review` when a submission tries to manipulate its verdict; we map that to Q04.
- Track brief: "reliable agents that turn real-time feedback into measurable improvements". Our fit: Reppo feedback becomes a measurable score, and the Phoenix persona shows an agent improving after feedback (re-evaluated, score rises).

## 7. Kite (data source; fallback track)
- Mainnet chain 2366, RPC `https://rpc.gokite.ai`, explorer `https://kitescan.ai`. Testnet 2368, `https://rpc-testnet.gokite.ai`, `https://testnet.kitescan.ai`, faucet `https://faucet.gokite.ai`.
- USDC.e (mainnet) `0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e`, 6 decimals.
- KiteScan is Blockscout with a public v2 API (no key): `/api/v2/addresses/{addr}/token-transfers?type=ERC-20` (paginate with `next_page_params`), `/api/v2/addresses/{addr}`, `/api/v2/addresses/{addr}/counters`, `/api/v2/tokens/{token}/transfers`.
- Owner opt-in: `kpass activity --output json --since --until --merchant`. Session errors `session_rule_exceeded`, `session_total_exceeded`, `session_endpoint_forbidden` become `payment.limit_violation`.
- No native credit on Kite; irrelevant now that lending is out of scope.
- If we switch to the Kite track (decision by Nov 10), the pitch becomes "check an agent's AgentFICO score before giving it a Passport session or raising its spending limit".

## 8. Simulator and personas (Phase 1, all labeled SIMULATED)
`bun run sim --seed 42 --days 90 --personas all` writes events through `SimulatorAdapter`. Same seed = same events (golden tests depend on it). Work samples are produced by SERV job 7 at a target quality and judged by the **real Reppo API**, so the quality signal is real even though the history is simulated. Recorded Reppo responses are saved in `fixtures/reppo/` for offline runs.

| Persona | Behavior | Expected |
|---|---|---|
| **Atlas**, disciplined shopper | 60-day wallet; 2-4 small purchases/day across many merchants; no violations; high-quality work; 99% uptime | 760-800, Very good; helps: Q01, P04 |
| **Blaze**, overspender | 90 days; weekend spend spikes x5; 3 `session_total_exceeded`; 6% failed payments; decent work | 600-650, Fair; P01, C01, P02 |
| **Murk**, flaky low-quality worker | sells outputs; 40% Reppo reject/revise; 80% uptime; 25% task failures | 560-620; Q01, Q02, L01 |
| **Nova-7**, sybil | 2-day wallet funded with 9 siblings from one source; circular transfers | capped <= 549, low confidence, under review; F01, F02, I01 |
| **Phoenix**, recovering agent | bad first 30 days (violations, low quality); acts on Reppo feedback; 60 clean days; quality rising | climbs from about 520 to about 680 as decay and new verdicts land |

Each persona has a hidden `truth.risk` (probability of a bad incident in the next 30 sim-days). Back-test: generate 200 random personas, score at day 60, count incidents in days 61-90, report AUC (labeled simulated) in the README.

## 9. API and CLI (free)
API (Hono, `apps/api`):
- `GET /v1/score/:afcId` -> `{ afc_id, score, band, confidence, status, model_version, as_of, simulated_share, factors: {Q,P,L,C,I,F}, reason_codes: [{ code, direction, text, events[], eval_ids[] }] }`
- `GET /v1/report/:afcId` -> score + factor breakdown, last 50 events, Reppo evidence (eval IDs, critique summary), trust memo, fraud review, SERV call IDs.
- `GET /v1/agents` (list), `GET /v1/methodology` (weights, formulas, codes, version), `GET /v1/serv-log`, `GET /healthz`.
- `POST /v1/score/log` (multipart JSONL of BehaviorEvents or assistant logs, max 1 MB) -> provisional score for your own agent, not stored unless `?save=1`.
- `POST /v1/evaluate` (enqueue Reppo evaluation of submitted work samples) -> enabled locally with your own `REPPO_API_KEY`; on the hosted demo, rate-limited or off.
- Rate limit public endpoints (per IP). No auth for reads.

CLI (`packages/cli`, run as `bun run afc ...`):
- `afc score --log my-agent.jsonl` | `afc score --kite 0x...` | `afc score --id afc:sim:atlas`
- `afc explain <afcId>` (reason codes + memo)
- `afc evaluate --samples outputs.jsonl --category shopping` (Reppo, needs keys)
- `afc sim --seed 42 --days 90`
- `afc serv-log --afc-id <id>`

## 10. Anti-gaming
| Attack | Defense |
|---|---|
| Sybil / fresh wallets | thin-file cap (<= 649) and low confidence; funding-graph analysis (I02/F02); optional owner binding |
| Cherry-picked work samples | AgentFICO picks samples: SERV-designed mystery-shopper probes at random times; self-submitted samples need a hash-chained log commitment and weigh 50% of probes |
| Wash payments / self-dealing | detect cycles A->B->A, low counterparty diversity, shared funders; wash volume earns no P credit; SERV fraud review on flagged subgraphs |
| Gaming the Reppo judges | Reppo downgrades manipulation (Q04 penalty); `serv_prompt_guard` on all agent text |
| Behave well then defect | drift detector (C03) and short half-life on positives vs long half-life on fraud |
| Tampered assistant logs | hash chain + ed25519 signatures per source (Phase 2); attestation-weighted events; F03 on gaps |

## 11. Who consumes the score
- **Agent marketplaces and registries**: rank or gate listings by score; show reason codes.
- **Merchants and x402 sellers**: decide whether to serve an unknown agent or require prefunding.
- **Agent owners**: see why their agent scores low and what to fix (the Reppo critiques tell them).
- **Lenders and insurers**: free to read the score and map bands to their own policy. AgentFICO itself does not lend or price risk.

## 12. Roadmap and sustainability
- **Repayment history** (credit.* events: advances, statements, days past due) as a new factor once agent credit lines exist (Fivebar-style tabs, lender adapters). Weights will be re-fit with a new `model_version`.
- Real adapters at scale: KiteScan backfill, `kpass` owner opt-in, assistant log SDK with signatures.
- ERC-8004 Reputation Registry: publish scores as feedback entries.
- Reppo Datanet of agent work quality.
- **Sustainability (light):** the core stays MIT and free. A hosted version can fund itself with higher rate limits, score-change webhooks and bulk scoring for marketplaces, and integrations for lenders and insurers that want monitored scores with SLAs. Optional grants (Reppo said it is open to funding a "FICO for agents" built on its Eval API).

## 13. References
- Hackathon: https://www.openserv.ai/hackathon-2
- SERV Reasoning: https://docs.openserv.ai/serv-reasoning/api/index.md, https://docs.openserv.ai/serv-reasoning/models.md, https://docs.openserv.ai/serv-reasoning/tools.md, https://docs.openserv.ai/serv-reasoning/tutorials/multipath.md, https://docs.openserv.ai/serv-reasoning/tutorials/kronos.md, https://docs.openserv.ai/serv-reasoning/tutorials/shadow-agent.md, https://docs.openserv.ai/serv-reasoning/tutorials/structured-outputs.md, https://docs.openserv.ai/serv-reasoning/tutorials/prompt-caching.md, https://docs.openserv.ai/serv-reasoning/tutorials/usage-and-billing.md
- Reppo: https://docs.reppo.ai/api/eval/overview.md, https://docs.reppo.ai/api/eval/evaluations.md, https://docs.reppo.ai/api/eval/peer-assessments.md, https://eval.reppo.xyz/agents.md
- Reppo post naming "FICO for agents": https://x.com/reppo/status/2117739480987930688
- Kite: https://docs.gokite.ai/kite-chain/1-getting-started/network-information.md, https://docs.gokite.ai/kite-chain/3-developing/smart-contracts-list.md, https://docs.gokite.ai/reference/kpass-cli.md, https://docs.gokite.ai/reference/error-codes.md, https://docs.gokite.ai/about/core-concepts-and-terminology
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
