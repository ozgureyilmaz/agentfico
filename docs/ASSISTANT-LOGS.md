# Score an assistant log

Export UTF-8 JSONL, with one object per nonempty line and one agent per file. Assistant IDs have the form `afc:asst:<id>`. Use a stable record ID and the original timestamp for each action. Logs carry self-reported attestation. The examples contain simulated histories.

```bash
AFC_OFFLINE=1 bun run afc -- score --log examples/assistant-log.jsonl
```

The dashboard accepts the same file. A provisional upload does not store the events. An unsupported or malformed line produces an error with its line number. Remove private payloads before exporting.

| Format | Required fields and mapping |
|---|---|
| [Generic](../examples/assistant-log.jsonl) | `format: "afc-assistant-v1"`, `agent_id`, `id`, ISO 8601 `timestamp`, and `type`. Supported types are task completion or failure, action performed or reversed, complaints, and payment sent, received, failed, refunded, or disputed. Payments may include `amount: {value, currency}` (USD or USDC, decimal string) and `counterparty`. |
| [LangChain](../examples/langchain-log.jsonl) | Export completed [v2 stream events](https://reference.langchain.com/python/langchain-core/runnables/base/Runnable/astream_events), retaining `event`, `run_id`, and `parent_ids`. Add `format: "langchain-stream-v2"`, `agent_id` and the ISO 8601 capture `timestamp`. A root `on_chain_end` records a completed task and `on_tool_end` records an action. Export only these completed events. |
| [OpenTelemetry](../examples/otlp-log.jsonl) | Export one top-level task span per line from [OTLP trace data](https://opentelemetry.io/docs/specs/otel/trace/api/), under `span` with `traceId`, `spanId`, `endTimeUnixNano` (string), and an explicit OK or ERROR `status.code`. Add `format: "otlp-span"` and `agent_id`. OK maps to a completed task and ERROR maps to a failed task. |

Set `simulated: true` for generated histories. Framework prompt text, tool payloads, and raw span attributes are discarded. The adapter derives its evidence hash from the format, agent and record ID, so repeated exports retain the same evidence identity.

For a logged SERV mapping run, use `AFC_OFFLINE=1 bun run afc -- map-log --log examples/assistant-log.jsonl`. The command validates the entire batch first, then logs at most 20 job 6 calls. It checks each candidate against the source fields before returning the event. Add `--live` to use the configured SERV provider locally. The dashboard uses deterministic mapping.

## Plan and evaluate probes

```bash
bun run sim -- --seed 42
bun run afc -- probe plan --id afc:sim:atlas --category shopping --capability 'Compare prices'
bun run afc -- probe enqueue --plan PLAN_ID --answers examples/probe-answers.jsonl
AFC_OFFLINE=1 bun run reppo:worker -- --drain
```

Use the returned plan ID and match every probe ID in the JSONL answers. The example answers match the offline fixture plan. The commands default to offline mode. For a live batch, use `--live`, provide the appropriate provider key locally, and queue after the returned ready time.
