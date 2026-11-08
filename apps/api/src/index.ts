import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (context) =>
  context.json({ ok: true, simulated_share: 0 }),
);

export default {
  port: Number(process.env.PORT ?? 8787),
  fetch: app.fetch,
};
