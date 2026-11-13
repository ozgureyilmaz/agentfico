# AgentFICO demo voiceover

**Runtime:** 2:44. The MP4 has burned-in captions and a silent stereo track for the voiceover. Begin each paragraph on its listed cut. The delivery averages about 140 words per minute, with short pauses over the actions.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:05 | The ledger seal draws itself over the Glacier field. | Agents are about to spend your money. Which ones do you trust? |
| 0:05–0:20 | Problem card. | A profile can tell you what an agent claims it can do. Before you give it a budget or a job, you need a record of the work it delivered, how it paid, and whether it followed through. |
| 0:20–0:34 | Leaderboard with simulated data labels. | AgentFICO gives agents an open trust score from three hundred to eight hundred fifty. These five labelled profiles are simulated. Their scores reflect distinct behavior. |
| 0:34–0:51 | Atlas report, cited reason codes, and an event detail. | Atlas’s report starts with the factors behind its score. The reasons show what helped and what held it back. Open an event citation to see the underlying record and where it came from. |
| 0:51–1:08 | Phoenix slider moves from early observations to the latest snapshot. | Phoenix starts with an uneven simulated history. Move the slider to see what was known at each point. The score is recalculated from the events available then. Real Reppo verdicts on sample work appear separately in the report. |
| 1:08–1:23 | Nova-7 fraud review and its two cited findings. | Nova Seven shows the other direction. Circular payments and shared funding trigger the integrity cap. The score moves from six forty-two to five forty-nine, and the report shows the transfers that put this simulated profile under review. |
| 1:23–1:38 | Recorded public Kite mainnet address and 649 result. | This public Kite mainnet address is separate from the simulated profiles. Its recorded transfer history produces a provisional score of six forty-nine. The partial coverage label stays visible because the explorer repeated a page during collection. |
| 1:38–1:52 | Choose the example JSONL log and calculate a result. | You can bring your own behavior log. Select a JSON Lines file and calculate a provisional score. This example uses simulated events and scores six thirty-two. The read-only demo computes the result without saving the uploaded events. |
| 1:52–2:07 | SERV trace and a recorded provider call. | Every SERV Reasoning attempt is logged. The trace shows which job ran, its model, configured features and tools, and any usage returned by the provider. Offline fixture calls are labelled individually, so you can tell what was recorded. |
| 2:07–2:20 | Click a Phoenix reason’s Reppo citation. | Click a Reppo evaluation ID to jump directly to the stored judgment. You can read the score, decision, and returned critique. These evaluations provide independent evidence for the work quality factor. |
| 2:20–2:30 | Animated evidence flow. | Validated events go into SQLite. One versioned scorer produces the score and citations. SERV Reasoning helps review and explain the evidence. |
| 2:30–2:36 | Why it matters card. | Marketplaces and agent owners can inspect the same record before assigning work or a budget. |
| 2:36–2:44 | Repo URL and Reppo track credit. | AgentFICO is open and free. Find the code and runnable demo on GitHub. Built on SERV Reasoning for the Reppo track. |

The recording uses the fixture-backed, read-only dashboard. Phoenix’s slider illustrates simulated recovery. The separate [Reppo follow-up comparison](../evidence/phoenix-feedback.json) isolates the effect of the first follow-up verdict at a fixed cutoff.
