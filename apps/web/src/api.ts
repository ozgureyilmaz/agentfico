import {
  AgentReportSchema,
  AgentScoreSchema,
  AgentsResponseSchema,
  ApiErrorSchema,
  EventResponseSchema,
  MethodologySchema,
  ScoreLogResponseSchema,
  ServLogResponseSchema,
} from "@agentfico/core/api-schemas";

export type AgentsResponse = ReturnType<typeof AgentsResponseSchema.parse>;
export type AgentReport = ReturnType<typeof AgentReportSchema.parse>;
export type AgentScore = ReturnType<typeof AgentScoreSchema.parse>;
export type Methodology = ReturnType<typeof MethodologySchema.parse>;
export type ServLog = ReturnType<typeof ServLogResponseSchema.parse>;
export type ScoreLogResponse = ReturnType<typeof ScoreLogResponseSchema.parse>;
export type EventResponse = ReturnType<typeof EventResponseSchema.parse>;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type RuntimeSchema<T> = { parse(value: unknown): T };

async function getJson<T>(path: string, schema: RuntimeSchema<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiRequestError("Could not reach the local AgentFICO service.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiRequestError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code,
      );
    }
    throw new ApiRequestError(
      `The service returned an error (${response.status}).`,
      response.status,
    );
  }
  try {
    return schema.parse(body);
  } catch {
    throw new ApiRequestError(
      "The service response did not match the published API schema.",
      response.status,
    );
  }
}

export function getAgents(): Promise<AgentsResponse> {
  return getJson("/v1/agents", AgentsResponseSchema);
}

export function getReport(afcId: string, asOf?: string): Promise<AgentReport> {
  const query = asOf ? `?${new URLSearchParams({ as_of: asOf })}` : "";
  return getJson(
    `/v1/report/${encodeURIComponent(afcId)}${query}`,
    AgentReportSchema,
  );
}

export function getScore(afcId: string, asOf?: string): Promise<AgentScore> {
  const query = asOf ? `?${new URLSearchParams({ as_of: asOf })}` : "";
  return getJson(
    `/v1/score/${encodeURIComponent(afcId)}${query}`,
    AgentScoreSchema,
  );
}

export function getMethodology(): Promise<Methodology> {
  return getJson("/v1/methodology", MethodologySchema);
}

export function getServLog(afcId?: string): Promise<ServLog> {
  const query = new URLSearchParams({ limit: "50" });
  if (afcId) query.set("afc_id", afcId);
  return getJson(`/v1/serv-log?${query}`, ServLogResponseSchema);
}

export function getEvent(eventId: string): Promise<EventResponse> {
  return getJson(
    `/v1/events/${encodeURIComponent(eventId)}`,
    EventResponseSchema,
  );
}

export async function uploadEventLog(
  file: File,
  save: boolean,
): Promise<ScoreLogResponse> {
  const form = new FormData();
  form.set("file", file);
  return postJson(
    `/v1/score/log${save ? "?save=1" : ""}`,
    form,
    ScoreLogResponseSchema,
  );
}

async function postJson<T>(
  path: string,
  body: FormData,
  schema: RuntimeSchema<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiRequestError("Could not reach the local AgentFICO service.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code,
      );
    }
    throw new ApiRequestError(
      `The service returned an error (${response.status}).`,
      response.status,
    );
  }
  try {
    return schema.parse(payload);
  } catch {
    throw new ApiRequestError(
      "The service response did not match the published API schema.",
      response.status,
    );
  }
}
