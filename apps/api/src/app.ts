import {
  ApiErrorSchema,
  HealthResponseSchema,
} from "@agentfico/core/api-schemas";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  ApiServiceError,
  type ApiServiceOptions,
  apiErrorBody,
  createApiService,
  type ReppoEnqueueFunction,
} from "./service";

interface RequestBindings {
  clientIp?: string;
}

export interface CreateAppOptions extends ApiServiceOptions {
  clientIp?: string | ((request: Request) => string);
  reppoEnqueue?: ReppoEnqueueFunction;
}

interface RateBucket {
  startedAt: number;
  count: number;
}

function handleError(
  context: Context<{ Bindings: RequestBindings }>,
  error: unknown,
) {
  if (error instanceof ApiServiceError) {
    return context.json(apiErrorBody(error.code, error.message), error.status);
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return context.json(
      apiErrorBody("invalid_request", "Request data failed validation"),
      400,
    );
  }
  return context.json(
    apiErrorBody("internal_error", "The request could not be completed"),
    500,
  );
}

function parsePositiveInteger(
  raw: string | undefined,
  name: string,
  maximum: number,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new ApiServiceError(
      400,
      `invalid_${name}`,
      `${name} must be an integer`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ApiServiceError(
      400,
      `invalid_${name}`,
      `${name} must be between 1 and ${maximum}`,
    );
  }
  return value;
}

export function createApp(options: CreateAppOptions) {
  const app = new Hono<{ Bindings: RequestBindings }>();
  const service = createApiService({
    ...options,
    reppoEnqueue: options.reppoEnqueue,
  });
  const buckets = new Map<string, RateBucket>();
  const windowMs = 60_000;

  app.use("/v1/*", async (context, next) => {
    const ip =
      context.env?.clientIp ??
      (typeof options.clientIp === "function"
        ? options.clientIp(context.req.raw)
        : options.clientIp) ??
      "unknown";
    const isEvaluate = context.req.path === "/v1/evaluate";
    const isKiteScore = context.req.path === "/v1/score/kite";
    const maximum = isEvaluate || isKiteScore ? 6 : 120;
    const now = Date.now();
    const bucketName = isEvaluate
      ? "evaluate"
      : isKiteScore
        ? "kite"
        : "public";
    const key = `${ip}:${bucketName}`;
    const current = buckets.get(key);
    const bucket =
      !current || now - current.startedAt >= windowMs
        ? { startedAt: now, count: 0 }
        : current;
    if (bucket.count >= maximum) {
      const seconds = Math.max(
        1,
        Math.ceil((windowMs - (now - bucket.startedAt)) / 1000),
      );
      context.header("Retry-After", String(seconds));
      return context.json(
        apiErrorBody("rate_limited", "Too many requests from this IP address"),
        429,
      );
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(bucketKey);
      }
    }
    await next();
  });

  for (const [path, maxSize] of [
    ["/v1/score/log", 1_048_576 + 65_536],
    ["/v1/evaluate", 1_048_576],
    ["/v1/score/kite", 8_192],
  ] as const) {
    app.use(
      path,
      bodyLimit({
        maxSize,
        onError: (context) =>
          context.json(
            apiErrorBody(
              "request_too_large",
              "Request body exceeds the size limit",
            ),
            413,
          ),
      }),
    );
  }

  app.get("/healthz", (context) =>
    context.json(HealthResponseSchema.parse({ ok: true, simulated_share: 0 })),
  );

  app.get("/v1/score/:afcId", (context) => {
    try {
      const result = service.score(
        context.req.param("afcId"),
        context.req.query("as_of"),
      );
      return context.json(result);
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get("/v1/report/:afcId", async (context) => {
    try {
      const result = await service.report(
        context.req.param("afcId"),
        context.req.query("as_of"),
      );
      return context.json(result);
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get("/v1/agents", (context) => {
    try {
      return context.json(service.agents(context.req.query("as_of")));
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get("/v1/events/:eventId", (context) => {
    try {
      return context.json(service.event(context.req.param("eventId")));
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get("/v1/methodology", (context) => {
    try {
      return context.json(service.methodology());
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get("/v1/serv-log", (context) => {
    try {
      const job = parsePositiveInteger(context.req.query("job"), "job", 7);
      const limit = parsePositiveInteger(
        context.req.query("limit"),
        "limit",
        200,
      );
      return context.json(
        service.servLog({
          afcId: context.req.query("afc_id"),
          job,
          limit,
        }),
      );
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post("/v1/score/kite", async (context) => {
    try {
      const contentLength = Number(context.req.header("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 8_192) {
        throw new ApiServiceError(
          413,
          "request_too_large",
          "Kite score request exceeds 8 KiB",
        );
      }
      const body = await context.req.text();
      if (new TextEncoder().encode(body).byteLength > 8_192) {
        throw new ApiServiceError(
          413,
          "request_too_large",
          "Kite score request exceeds 8 KiB",
        );
      }
      return context.json(await service.scoreKite(JSON.parse(body)));
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post("/v1/score/log", async (context) => {
    try {
      const contentLength = Number(context.req.header("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > 1_048_576 + 16_384
      ) {
        throw new ApiServiceError(
          413,
          "upload_too_large",
          "JSONL upload exceeds 1 MiB",
        );
      }
      const form = await context.req.formData();
      const uploaded =
        form.get("file") ?? form.get("jsonl") ?? form.get("events");
      if (!(uploaded instanceof File)) {
        throw new ApiServiceError(
          400,
          "file_required",
          "Multipart field 'file' must contain a JSONL file",
        );
      }
      if (uploaded.size > 1_048_576) {
        throw new ApiServiceError(
          413,
          "upload_too_large",
          "JSONL upload exceeds 1 MiB",
        );
      }
      const saveValue = context.req.query("save");
      if (saveValue !== undefined && saveValue !== "0" && saveValue !== "1") {
        throw new ApiServiceError(400, "invalid_save", "save must be 1 or 0");
      }
      return context.json(
        service.scoreLog(await uploaded.text(), {
          afcId: context.req.query("afc_id"),
          asOf: context.req.query("as_of"),
          save: saveValue === "1",
        }),
      );
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post("/v1/evaluate", async (context) => {
    try {
      const contentLength = Number(context.req.header("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 262_144) {
        throw new ApiServiceError(
          413,
          "request_too_large",
          "Evaluation request exceeds 256 KiB",
        );
      }
      const rawBody = await context.req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 262_144) {
        throw new ApiServiceError(
          413,
          "request_too_large",
          "Evaluation request exceeds 256 KiB",
        );
      }
      const body = JSON.parse(rawBody);
      return context.json(await service.enqueueEvaluation(body), 202);
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.notFound((context) => {
    if (context.req.path === "/v1" || context.req.path.startsWith("/v1/")) {
      return context.json(
        ApiErrorSchema.parse({
          error: { code: "not_found", message: "API route was not found" },
          simulated_share: 0,
        }),
        404,
      );
    }
    return context.text("Not Found", 404);
  });
  app.onError((error, context) => handleError(context, error));

  return app;
}
