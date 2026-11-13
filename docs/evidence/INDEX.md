# AgentFICO verification evidence

The repository distinguishes live provider responses, recorded replay, and simulated history. Reproduce the main flows with `bun install && bun run demo` and `bun run check`. See the [build checklist](../../STATUS.md) for command output and milestone timestamps.

| Area | Evidence |
|---|---|
| M0 scaffold | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42455536165) |
| M1 simulator | [Original seed and repeatability logs](../../STATUS.md#verification-log) |
| M2 scorer | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42458956765) · [Methodology](../SPEC.md#2-score-model) |
| M3 SERV | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42788871372) · [Live call IDs, provider IDs and usage](serv-calls.sample.jsonl) |
| M4 durable Reppo | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985638789) · [Sanitized evaluation responses](../../fixtures/reppo/real/) |
| M5 API and CLI | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985745755) |
| M6 dashboard | [Merged main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/42985808699) |
| M7 fraud and Kite | [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205141595) · [PR CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43165723238) · [Nova-7 scores, citations and offline SERV call ID](nova-fraud-review.json) · [Kite mainnet capture and coverage](../../fixtures/kite/real/kitescan-mainnet-0xd9bee9d8d294b01f716c77b3c5953035a15ed2d2.meta.json) |
| M8 probes and uploads | [Main CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43205214626) · [PR CI](https://github.com/ozgureyilmaz/agentfico/actions/runs/43166846501) · [Plan ID, log mapping call IDs and browser outputs](probe-and-upload.json) |
| M9 recorded evaluations | [Initial and follow-up verdict manifest](../../fixtures/reppo/recorded.json) · [Approved batch observations](reppo-batch.json) |
| M9 demo and back-test | [Final clean clone, 20 links and browser metrics](release-audit.json) · [Earlier demo timing](demo-browser.json) · [Simulated AUC and calibration output](simulated-backtest.json) · [Demo GIF](../../assets/demo.gif) · [Render container restart proof](render-release-container.json) |

The public Kite address scored 649 on mainnet chain 2366. The provider repeated pages, so the score is provisional and based on 50 distinct transfer logs between blocks 122771 and 2301185. The source responses and their capture times are recorded with the fixture.

The baseline Phoenix replay reached 691. Reppo evaluation `cmwaknixh000208jshh2w0av1` scored the initial synthetic samples 70, and follow-up `cmwd5ia5r000008l8wqzthd4r` scored revised samples 100. At the same cutoff, importing the first follow-up changed the deterministic score from 691 to 696. The full recorded batch raised the final replay snapshot to 708. [Exact comparison](phoenix-feedback.json)

## Settled Reppo evaluations

20 recorded live completions, 8,800 credits charged across M4 and M9. The Kite analysis evaluation grades the project's analysis and does not score the wallet owner's work.

| Subject | Evaluation ID | Completed (UTC) | Credits | Sample history |
|---|---|---|---:|---|
| `afc:sim:atlas` | [`cmwaiidfz000007i5qihmvy63`](../../fixtures/reppo/real/2026-11-10T09-55-15-085Z-6b86b273ff34-4-poll.json) | 2026-11-10T09:54:33.828Z | 440 | Simulated |
| `afc:sim:blaze` | [`cmwaj1ng9000107i564rgokox`](../../fixtures/reppo/real/2026-11-10T10-10-15-127Z-d4735e3a265e-7-poll.json) | 2026-11-10T10:09:28.439Z | 440 | Simulated |
| `afc:sim:murk` | [`cmwajkymr000008jst9qwwcr3`](../../fixtures/reppo/real/2026-11-10T10-25-15-128Z-4e07408562be-10-poll.json) | 2026-11-10T10:24:40.472Z | 440 | Simulated |
| `afc:sim:nova-7` | [`cmwak48cc000108jsjdx7lq2x`](../../fixtures/reppo/real/2026-11-10T10-40-15-135Z-4b227777d4dd-13-poll.json) | 2026-11-10T10:39:17.669Z | 440 | Simulated |
| `afc:sim:phoenix` | [`cmwaknixh000208jshh2w0av1`](../../fixtures/reppo/real/2026-11-10T10-55-15-174Z-ef2d127de37b-16-poll.json) | 2026-11-10T10:54:45.395Z | 440 | Simulated |
| `afc:sim:phoenix` | [`cmwd5ia5r000008l8wqzthd4r`](../../fixtures/reppo/real/2026-11-12T06-13-35-252Z-6b86b273ff34-2-poll.json) | 2026-11-12T06:13:12.190Z | 440 | Simulated |
| `afc:asst:kite-reader` | [`cmwd61ksa000108l8b9sfhfrh`](../../fixtures/reppo/real/2026-11-12T06-28-35-265Z-d4735e3a265e-4-poll.json) | 2026-11-12T06:28:28.297Z | 440 | Real-data analysis |
| `afc:sim:atlas` | [`cmwd6kv0r000208l8kiidh04e`](../../fixtures/reppo/real/2026-11-12T06-43-35-270Z-4e07408562be-6-poll.json) | 2026-11-12T06:43:21.679Z | 440 | Simulated |
| `afc:sim:blaze` | [`cmwd745fu000308l80bnp5y28`](../../fixtures/reppo/real/2026-11-12T06-58-35-273Z-4b227777d4dd-8-poll.json) | 2026-11-12T06:58:14.025Z | 440 | Simulated |
| `afc:sim:murk` | [`cmwd7ng7i000008jtzmydolt4`](../../fixtures/reppo/real/2026-11-12T07-13-35-297Z-ef2d127de37b-10-poll.json) | 2026-11-12T07:13:15.752Z | 440 | Simulated |
| `afc:sim:nova-7` | [`cmwd86qfa000008l3lv17p0go`](../../fixtures/reppo/real/2026-11-12T07-29-35-341Z-e7f6c011776e-13-poll.json) | 2026-11-12T07:28:37.946Z | 440 | Simulated |
| `afc:sim:phoenix` | [`cmwd8q0to000208kz3xj5ajgu`](../../fixtures/reppo/real/2026-11-12T07-44-35-357Z-7902699be42c-16-poll.json) | 2026-11-12T07:43:59.532Z | 440 | Simulated |
| `afc:sim:atlas` | [`cmwd99bjj000208jp8u0owgid`](../../fixtures/reppo/real/2026-11-12T07-58-35-383Z-2c624232cdd2-18-poll.json) | 2026-11-12T07:58:08.759Z | 440 | Simulated |
| `afc:sim:blaze` | [`cmwd9slvz000408jplb11gbp5`](../../fixtures/reppo/real/2026-11-12T08-13-35-398Z-19581e27de7c-20-poll.json) | 2026-11-12T08:13:22.321Z | 440 | Simulated |
| `afc:sim:murk` | [`cmwdabwa6000508jpwjqdzdef`](../../fixtures/reppo/real/2026-11-12T08-28-35-399Z-4a44dc153642-22-poll.json) | 2026-11-12T08:28:30.026Z | 440 | Simulated |
| `afc:sim:nova-7` | [`cmwdav6oy000008jsail3f930`](../../fixtures/reppo/real/2026-11-12T08-52-59-505Z-4fc82b26aecb-24-poll.json) | 2026-11-12T08:43:27.552Z | 440 | Simulated |
| `afc:sim:phoenix` | [`cmwdfrau9000007l45gv0ko1d`](../../fixtures/reppo/real/2026-11-12T11-00-32-338Z-6b51d431df5d-27-poll.json) | 2026-11-12T11:00:00.198Z | 440 | Simulated |
| `afc:sim:atlas` | [`cmwdgali2000607l4kkrvwrqv`](../../fixtures/reppo/real/2026-11-12T11-15-32-389Z-3fdba35f04dc-29-poll.json) | 2026-11-12T11:15:07.510Z | 440 | Simulated |
| `afc:sim:blaze` | [`cmwdgtw4r000807l4skie6j41`](../../fixtures/reppo/real/2026-11-12T11-31-32-435Z-8527a891e224-32-poll.json) | 2026-11-12T11:30:53.025Z | 440 | Simulated |
| `afc:sim:phoenix` | [`cmwdhd6f2000007lf37r27ost`](../../fixtures/reppo/real/2026-11-12T11-45-32-429Z-e629fa6598d7-34-poll.json) | 2026-11-12T11:45:14.335Z | 440 | Simulated |

## Pending owner evidence

Pending owner evidence includes the OpenServ data-collection screenshot, hosted URL, published video, and submission confirmation.
