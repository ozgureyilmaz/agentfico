import { resolve, sep } from "node:path";
import { migrateDb, openDb } from "@agentfico/db";
import { serveStatic } from "hono/bun";
import { createApp } from "./app";

const db = openDb();
migrateDb(db);

const webRoot = resolve(import.meta.dir, "../../web/dist");
const app = createApp({ db, env: process.env });
const staticHandler = serveStatic({ root: webRoot });

app.get("*", async (context, next) => {
  const path = context.req.path;
  if (path === "/healthz" || path === "/v1" || path.startsWith("/v1/")) {
    return next();
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return context.text("Not Found", 404);
  }
  const candidate = resolve(webRoot, `.${decodedPath}`);
  const isInsideWebRoot =
    candidate === webRoot || candidate.startsWith(`${webRoot}${sep}`);
  const requestedFile = isInsideWebRoot ? Bun.file(candidate) : null;
  if (requestedFile && (await requestedFile.exists())) {
    return staticHandler(context, next);
  }

  if (context.req.header("accept")?.includes("text/html")) {
    const indexFile = Bun.file(resolve(webRoot, "index.html"));
    if (await indexFile.exists()) return context.html(await indexFile.text());
  }
  return staticHandler(context, next);
});

export default {
  port: Number(process.env.PORT ?? 8787),
  hostname: process.env.HOST ?? "127.0.0.1",
  fetch: (
    request: Request,
    server: { requestIP(request: Request): { address: string } | null },
  ) =>
    app.fetch(request, {
      clientIp: server.requestIP(request)?.address ?? "unknown",
    }),
};
