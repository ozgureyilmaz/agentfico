# Render Free demo

The root [`render.yaml`](../render.yaml) defines one Docker web service named `agentfico-free-demo`. It uses Render's Free plan in Frankfurt, has an HTTP health check at `/healthz`, and does not attach a disk or configure credentials. Automatic deploys are off; deploys after the initial setup are manual.

## Create the service

1. In Render, create a Blueprint from this repository and review the proposed service before applying it.
2. Confirm the service is `agentfico-free-demo`, uses the Free plan, and has no persistent disk or secret environment variables.
3. Choose **Deploy Blueprint** when you are ready to create the live service. This repository change does not create or deploy a Render service.

The service runs the dashboard and API in one container. On each process start, `AFC_EPHEMERAL_DB=1` creates a new SQLite directory under `/tmp`; seed 42 and the committed Reppo and SERV fixtures populate it. No provider keys are needed; the service runs in offline, hosted mode. This also rebuilds the fixture database if a process restarts while its container filesystem survives.

Uploading a JSONL log and calculating its provisional score remains available. Hosted mode does not save uploaded events, and this ephemeral SQLite database is not durable. Any non-fixture changes disappear after a restart, deploy, or idle spin-down.

## Verify the live service

After deploying, replace `SERVICE_URL` with the service's Render URL:

```bash
curl --fail https://SERVICE_URL/healthz
curl --fail https://SERVICE_URL/v1/agents
```

Open the service URL to use the dashboard and its score-your-agent upload. Free web services can spin down after 15 minutes without traffic and take about a minute to wake. They have no persistent filesystem. Render includes monthly workspace limits for instance hours, bandwidth, and build minutes; excess bandwidth or build usage can incur charges when billing is enabled. See [Render's Free instance limits](https://render.com/docs/free).

## Local container smoke check

With Docker already installed and running, build and start the same image locally:

```bash
docker build -t agentfico .
docker run --rm -e PORT=10000 -p 10000:10000 agentfico
curl --fail http://localhost:10000/healthz
```

Render builds from the root [`Dockerfile`](../Dockerfile), as configured in [`render.yaml`](../render.yaml). See [Docker on Render](https://render.com/docs/docker), [Blueprint YAML reference](https://render.com/docs/blueprint-spec), and [Render health checks](https://render.com/docs/health-checks).
