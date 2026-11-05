# AgentFICO

**A FICO score for AI agents.** An open, free trust score (300-850) that tells you how an agent has actually behaved before you let it spend money, take a task, or join your marketplace.

> Status: in development for the OpenServ SERV Hackathon Edition 02 (Reppo track), Nov 2-15, 2026. Demo agents are **simulated and labeled as such**; work-quality verdicts come from the real Reppo Evaluation API.

## Why
Agents now pay, get paid and act for people. Before you hand one a budget or a job you want to know: does it do good work, does it respect its spending limits, does it stay up, and is it who it says it is? Today there is no shared answer. AgentFICO computes one from behavior, explains it, and gives it away for free.

## How it works
- **Behavior only.** Six factors: work quality judged by **Reppo** (35%), payment conduct on **Kite** (20%), reliability (15%), consistency (10%), identity and history (10%), integrity / fraud signals (10%).
- **Deterministic math.** Versioned pure functions turn decayed events into a 300-850 score with bands (Poor to Exceptional). An LLM never sets the number.
- **SERV Reasoning for judgment.** It designs mystery-shopper probes, writes Reppo rubrics, summarizes critiques, explains reason codes, reviews fraud patterns and maps unknown logs. Every SERV call is logged and visible.
- **Explainable.** Each score lists the reasons that lowered or raised it, each citing the events and Reppo eval IDs behind it.

```mermaid
flowchart LR
  subgraph Sources
    SIM[Simulator personas<br/>labeled SIMULATED]
    KS[KiteScan<br/>USDC.e transfers]
    KP[kpass activity<br/>owner opt-in]
    AS[Assistant logs]
  end
  SERV1[[SERV: probe plans<br/>+ Reppo rubrics]] --> RW[Reppo worker<br/>one eval at a time]
  RW <--> REPPO[(Reppo Eval API)]
  SIM & KS & KP & AS --> AD[Adapters -> BehaviorEvent]
  RW --> AD
  AD --> DB[(SQLite)]
  DB --> SC[Deterministic scorer<br/>300-850 + reason codes]
  SC --> SERV2[[SERV: explanations,<br/>critique summary, fraud review]]
  SERV2 --> API[Free API + CLI]
  API --> DASH[Dashboard + SERV trace]
  SERV1 -.logged.-> LOG[(serv_calls)]
  SERV2 -.logged.-> LOG
  LOG --> DASH
```

## Demo personas (simulated)
| Agent | Story | Expected |
|---|---|---|
| Atlas | disciplined shopper | Very good |
| Blaze | overspender, hits spending limits | Fair |
| Murk | flaky, low-quality work | Fair / Poor |
| Nova-7 | sybil wallet with circular payments | capped, under review |
| Phoenix | recovering agent that acts on Reppo feedback | climbs over time |

## Quickstart
_Coming with milestone M9. Planned:_
```bash
git clone https://github.com/ozgureyilmaz/agentfico && cd agentfico
bun install
bun run demo          # no keys needed; opens the dashboard with simulated data
```
Score your own agent (planned):
```bash
bun run afc -- score --log my-agent.jsonl
bun run afc -- score --kite 0xYourAgentAddress
curl http://localhost:8787/v1/score/afc:sim:atlas
```

## SERV Reasoning usage
Full table (features on and off, with reasons) in [docs/SPEC.md](docs/SPEC.md#5-serv-reasoning-usage). Every call is stored with model, features, latency and tokens, shown in the dashboard's SERV trace and at `GET /v1/serv-log`.

## Docs
- [docs/SPEC.md](docs/SPEC.md): score model, reason codes, event schema, SERV, Reppo, Kite, personas, API
- [docs/PLAN.md](docs/PLAN.md): build plan and demo script
- [docs/SUBMISSION.md](docs/SUBMISSION.md): hackathon requirements and checklist
- [docs/DECISIONS.md](docs/DECISIONS.md): design decisions
- [STATUS.md](STATUS.md): progress

## Roadmap
- Repayment history as a factor once agents use credit lines (lender adapters)
- Real adapters at scale: Kite backfill, Passport owner opt-in, signed assistant-log SDK
- Publish scores to the ERC-8004 Reputation Registry
- Score-change webhooks and bulk scoring

## Sustainability
The core stays MIT and free. A hosted version can fund itself with higher rate limits, webhooks and bulk scoring for marketplaces, and integrations for lenders and insurers that want monitored scores.

## License
MIT. See [LICENSE](LICENSE). AgentFICO is not affiliated with Fair Isaac Corporation; "FICO" is used only as a comparison.
