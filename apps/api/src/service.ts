import { mapAssistantLog } from "@agentfico/adapters/assistant-log";
import { KiteDataError, readKiteEvents } from "@agentfico/adapters/kite-chain";
import { enqueueEvaluation as enqueueReppoEvaluation } from "@agentfico/adapters/reppo";
import {
  type AgentScore,
  type BehaviorEvent,
  BehaviorEventSchema,
  detectFraud,
  FRAUD_DETECTOR_THRESHOLDS,
  METHODOLOGY,
  REASON_CODES,
  scoreAgent,
} from "@agentfico/core";
import {
  AgentReportSchema,
  AgentScoreSchema,
  AgentsResponseSchema,
  ApiErrorSchema,
  CritiqueSummarySchema,
  EvaluateReceiptSchema,
  type EvaluateRequest,
  EvaluateRequestSchema,
  EventResponseSchema,
  KiteScoreRequestSchema,
  KiteScoreResponseSchema,
  MethodologySchema,
  ScoreLogResponseSchema,
  ServLogResponseSchema,
  VerdictRecordSchema,
  validateAgentScore,
} from "@agentfico/core/api-schemas";
import {
  type AgentFicoDb,
  events,
  servCalls,
  storeEvents,
  verdicts,
} from "@agentfico/db";
import {
  applyExplanation,
  applyFraudReview,
  runServJob,
  type ServInputs,
} from "@agentfico/serv";
import { redactText, redactValue } from "@agentfico/serv/redact";
import { and, desc, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import { z } from "zod";

const AFC_ID_SCHEMA = z.string().regex(/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/);
const JSONL_MAX_BYTES = 1_048_576;
const REPPO_PAYLOAD_MAX_BYTES = 50 * 1024;

export interface ReppoEnqueueOptions {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

export type ReppoEnqueueFunction = (
  db: AgentFicoDb,
  input: EvaluateRequest,
  options?: ReppoEnqueueOptions,
) => unknown | Promise<unknown>;

export class ApiServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiServiceError";
  }
}

export function apiErrorBody(code: string, message: string) {
  return ApiErrorSchema.parse({
    error: { code, message },
    simulated_share: 0,
  });
}

export interface ApiServiceOptions {
  db: AgentFicoDb;
  env?: Readonly<Record<string, string | undefined>>;
  asOf?: string;
  reppoEnqueue?: ReppoEnqueueFunction;
  kiteRead?: typeof readKiteEvents;
}

export interface ScoreLogOptions {
  afcId?: string;
  asOf?: string;
  save?: boolean;
}

export interface ServLogOptions {
  afcId?: string;
  job?: number;
  limit?: number;
}

function canonicalIso(value: string, label: string): string {
  const parsed = z.iso.datetime().safeParse(value);
  if (!parsed.success) {
    throw new ApiServiceError(
      400,
      "invalid_as_of",
      `${label} must be an ISO-8601 timestamp`,
    );
  }
  return new Date(Date.parse(parsed.data)).toISOString();
}

function utcDayStart(now: number): string {
  const date = new Date(now);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString();
}

function compareEvents(left: BehaviorEvent, right: BehaviorEvent): number {
  return (
    Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
    (left.event_id < right.event_id
      ? -1
      : Number(left.event_id > right.event_id))
  );
}

function readEventRows(
  db: AgentFicoDb,
  afcId: string,
  fundingAsOf?: string,
): BehaviorEvent[] {
  const rows = db
    .select({ eventJson: events.eventJson })
    .from(events)
    .where(
      fundingAsOf
        ? and(
            ne(events.subjectAfcId, afcId),
            ne(events.attestation, "self_reported"),
            eq(events.simulated, false),
            lte(events.occurredAt, fundingAsOf),
            or(
              eq(events.eventType, "identity.registered"),
              and(
                inArray(events.eventType, ["payment.sent", "payment.received"]),
                gte(
                  events.occurredAt,
                  new Date(
                    Date.parse(fundingAsOf) -
                      FRAUD_DETECTOR_THRESHOLDS.F02.freshWalletDays *
                        86_400_000,
                  ).toISOString(),
                ),
              ),
            ),
          )
        : eq(events.subjectAfcId, afcId),
    )
    .all();
  return rows.map(({ eventJson }) => {
    let value: unknown;
    try {
      value = JSON.parse(eventJson);
    } catch {
      throw new ApiServiceError(
        503,
        "invalid_stored_event",
        "Stored event data could not be read",
      );
    }
    const parsed = BehaviorEventSchema.safeParse(value);
    if (!parsed.success) {
      throw new ApiServiceError(
        503,
        "invalid_stored_event",
        "Stored event data failed validation",
      );
    }
    return parsed.data;
  });
}

function parseJsonColumn(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publicReppoResult(
  input: unknown,
  redact: (value: string) => string,
): unknown | null {
  const outer = record(input);
  const result = record(outer?.result) ?? outer;
  if (!result) return null;
  const output: Record<string, unknown> = {};
  const legacyVerdict = record(result.verdict);
  if (
    typeof result.score === "number" &&
    result.score >= 0 &&
    result.score <= 100
  ) {
    output.score = result.score;
  }
  if (["accept", "revise", "reject"].includes(String(result.decision))) {
    output.decision = result.decision;
  }
  if (["low", "medium", "high"].includes(String(result.confidence))) {
    output.confidence = result.confidence;
  }
  if (["auto-ship", "review", "block"].includes(String(result.route))) {
    output.route = result.route;
  }
  if (typeof result.reason === "string")
    output.reason = redact(result.reason).slice(0, 4096);
  const rubricScores = record(result.rubric_scores);
  if (rubricScores) {
    const safeScores = Object.fromEntries(
      Object.entries(rubricScores).flatMap(([criterion, value]) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100
          ? [[redact(criterion).slice(0, 2048), value]]
          : [],
      ),
    );
    if (Object.keys(safeScores).length > 0) output.rubric_scores = safeScores;
  }
  if (legacyVerdict) {
    const safeVerdict: Record<string, unknown> = {};
    if (
      typeof legacyVerdict.score === "number" &&
      legacyVerdict.score >= 0 &&
      legacyVerdict.score <= 100
    ) {
      safeVerdict.score = legacyVerdict.score;
    }
    if (
      ["accept", "revise", "reject"].includes(String(legacyVerdict.decision))
    ) {
      safeVerdict.decision = legacyVerdict.decision;
    }
    if (["low", "medium", "high"].includes(String(legacyVerdict.confidence))) {
      safeVerdict.confidence = legacyVerdict.confidence;
    }
    output.verdict = safeVerdict;
  }
  if (Array.isArray(result.verdicts)) {
    output.verdicts = result.verdicts.flatMap((item) => {
      const entry = record(item);
      if (!entry) return [];
      return [
        {
          ...(typeof entry.criterion === "string"
            ? { criterion: redact(entry.criterion).slice(0, 2048) }
            : {}),
          ...(typeof entry.score === "number" &&
          entry.score >= 0 &&
          entry.score <= 10
            ? { score: entry.score }
            : {}),
          ...(typeof entry.critique === "string"
            ? { critique: redact(entry.critique).slice(0, 4096) }
            : {}),
        },
      ];
    });
  }
  const action = record(result.action);
  if (
    action &&
    ["auto-ship", "review", "block"].includes(String(action.route))
  ) {
    output.action = { route: action.route };
  }
  return Object.keys(output).length > 0 ? output : null;
}

function getCritiques(
  verdicts: readonly { eval_id: string; result: unknown }[],
  redact: (value: string) => string,
) {
  const critiques: Array<{
    critique_id: string;
    criterion: string;
    critique: string;
  }> = [];
  for (const verdict of verdicts) {
    const body = record(verdict.result);
    if (typeof body?.reason === "string" && body.reason.trim() !== "") {
      critiques.push({
        critique_id: `${verdict.eval_id}:reason`,
        criterion: "Reppo evaluation",
        critique: redact(body.reason).slice(0, 4096),
      });
    }
    if (!Array.isArray(body?.verdicts)) continue;
    for (const [index, raw] of body.verdicts.entries()) {
      const item = record(raw);
      if (typeof item?.critique !== "string" || item.critique.trim() === "")
        continue;
      critiques.push({
        critique_id: `${verdict.eval_id}:${index + 1}`,
        criterion:
          typeof item.criterion === "string"
            ? redact(item.criterion).slice(0, 2048)
            : "Reppo criterion",
        critique: redact(item.critique).slice(0, 4096),
      });
    }
  }
  return critiques;
}

function publicServCall(
  row: typeof servCalls.$inferSelect,
  redact: (value: string) => string,
  redactObject: (value: unknown) => unknown,
) {
  const features = parseJsonColumn(row.featuresJson);
  const tools = parseJsonColumn(row.toolsJson);
  const usage = parseJsonColumn(row.usageJson);
  const cost = parseJsonColumn(row.costJson);
  return {
    id: redact(row.id),
    created_at: row.createdAt,
    job: row.job,
    afc_id: row.afcId ? redact(row.afcId) : null,
    model: redact(row.model),
    features: Array.isArray(features)
      ? features
          .filter((item): item is string => typeof item === "string")
          .map(redact)
      : [],
    tools: Array.isArray(tools) ? (redactObject(tools) as unknown[]) : [],
    response_id: row.responseId ? redact(row.responseId) : null,
    status: row.status,
    offline: row.offline,
    latency_ms: row.latencyMs,
    usage: record(usage),
    cost: record(cost),
  };
}

export function parseBehaviorEventJsonl(content: string): BehaviorEvent[] {
  if (new TextEncoder().encode(content).byteLength > JSONL_MAX_BYTES) {
    throw new ApiServiceError(
      413,
      "upload_too_large",
      "JSONL upload exceeds 1 MiB",
    );
  }
  const lines = content.split(/\r?\n/);
  const parsed: BehaviorEvent[] = [];
  const mappedEvidence = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ApiServiceError(
        400,
        "invalid_jsonl",
        `Line ${index + 1} is not valid JSON`,
      );
    }
    const event = BehaviorEventSchema.safeParse(value);
    if (event.success) {
      parsed.push(event.data);
      continue;
    }
    const mapped = mapAssistantLog(value);
    const evidenceHash = mapped?.evidence?.log_hash;
    if (!mapped || !evidenceHash) {
      throw new ApiServiceError(
        422,
        "unsupported_log_line",
        `Line ${index + 1} is not a supported event or assistant-log record`,
      );
    }
    const serialized = JSON.stringify(mapped);
    const previous = mappedEvidence.get(evidenceHash);
    if (previous === serialized) continue;
    if (previous !== undefined) {
      throw new ApiServiceError(
        422,
        "conflicting_log_record",
        `Line ${index + 1} conflicts with an earlier assistant-log record ID`,
      );
    }
    mappedEvidence.set(evidenceHash, serialized);
    parsed.push(mapped);
  }
  if (parsed.length === 0) {
    throw new ApiServiceError(
      400,
      "empty_upload",
      "JSONL upload contains no events",
    );
  }
  return parsed;
}

function normalizeUploadedEvent(event: BehaviorEvent): BehaviorEvent {
  const syntheticSimulation =
    event.source === "simulator" && event.simulated === true;
  const source = syntheticSimulation ? "simulator" : "assistant";
  const attrs: Record<string, unknown> = { ...event.attrs };
  delete attrs.claimed_source;
  delete attrs.claimed_attestation;
  delete attrs.claimed_eval_id;
  if (event.source !== source) attrs.claimed_source = event.source;
  if (event.attestation !== "self_reported") {
    attrs.claimed_attestation = event.attestation;
  }
  if (event.evidence?.eval_id) {
    attrs.claimed_eval_id = event.evidence.eval_id;
  }
  const evidence = event.evidence
    ? Object.fromEntries(
        Object.entries(event.evidence).filter(([key]) => key !== "eval_id"),
      )
    : undefined;
  return BehaviorEventSchema.parse({
    ...event,
    source,
    attestation: "self_reported",
    evidence:
      evidence && Object.keys(evidence).length > 0 ? evidence : undefined,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
  });
}

export function createApiService(options: ApiServiceOptions) {
  const { db } = options;
  const configuredEnv = options.env ?? process.env;
  const env =
    configuredEnv.AFC_HOSTED === "1"
      ? { ...configuredEnv, AFC_OFFLINE: "1" }
      : configuredEnv;
  const activeSecrets = [env.SERV_API_KEY, env.REPPO_API_KEY]
    .filter(
      (secret): secret is string =>
        typeof secret === "string" && secret.trim().length > 0,
    )
    .map((secret) => secret.trim());
  const redact = (value: string) => redactText(value, activeSecrets);
  const redactObject = (value: unknown) => redactValue(value, activeSecrets);
  const publicEvent = (event: BehaviorEvent) =>
    BehaviorEventSchema.parse(redactObject(event));

  function allEvents(afcId: string): BehaviorEvent[] {
    return readEventRows(db, afcId).sort(compareEvents);
  }

  function resolveAsOf(
    afcId: string,
    requested?: string,
    now = Date.now(),
    additionalEvents: readonly BehaviorEvent[] = [],
  ): string {
    const override = requested ?? options.asOf ?? env.AFC_AS_OF;
    if (override) return canonicalIso(override, "as_of override");
    const lowerBound = Date.parse(utcDayStart(now));
    const latest = [...allEvents(afcId), ...additionalEvents]
      .filter((event) => event.subject.afc_id === afcId)
      .map((event) => Date.parse(event.occurred_at))
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now)
      .reduce((maximum, timestamp) => Math.max(maximum, timestamp), lowerBound);
    return new Date(Math.max(lowerBound, latest)).toISOString();
  }

  function requireAfcId(raw: string): string {
    const parsed = AFC_ID_SCHEMA.safeParse(raw);
    if (!parsed.success)
      throw new ApiServiceError(
        400,
        "invalid_afc_id",
        "AFC ID must use afc:<source>:<id> form",
      );
    return parsed.data;
  }

  function score(afcIdRaw: string, asOf?: string) {
    const afcId = requireAfcId(afcIdRaw);
    const history = allEvents(afcId);
    if (history.length === 0) {
      throw new ApiServiceError(
        404,
        "agent_not_found",
        `No events found for ${afcId}`,
      );
    }
    const resolvedAsOf = resolveAsOf(afcId, asOf);
    const score = scoreAgent(
      history,
      afcId,
      resolvedAsOf,
      readEventRows(db, afcId, resolvedAsOf),
    );
    return validateAgentScore(score);
  }

  function scoreEvents(
    input: readonly unknown[],
    afcIdRaw: string,
    asOf?: string,
  ) {
    const afcId = requireAfcId(afcIdRaw);
    const parsedEvents = input.map((item) => {
      const parsed = BehaviorEventSchema.safeParse(item);
      if (!parsed.success) {
        throw new ApiServiceError(
          422,
          "invalid_event",
          "Scoring input contains an invalid BehaviorEvent",
        );
      }
      return parsed.data;
    });
    if (parsedEvents.some((event) => event.subject.afc_id !== afcId)) {
      throw new ApiServiceError(
        422,
        "subject_mismatch",
        "Scoring events do not match the requested AFC ID",
      );
    }
    const resolvedAsOf = resolveAsOf(afcId, asOf, Date.now(), parsedEvents);
    return validateAgentScore(scoreAgent(parsedEvents, afcId, resolvedAsOf));
  }

  async function scoreKite(input: unknown) {
    const request = KiteScoreRequestSchema.parse(input);
    let data: Awaited<ReturnType<typeof readKiteEvents>>;
    try {
      data = await (options.kiteRead ?? readKiteEvents)(request.address, {
        env,
      });
    } catch (error) {
      if (error instanceof KiteDataError) {
        const status = error.code === "invalid_address" ? 400 : 503;
        throw new ApiServiceError(status, error.code, error.message);
      }
      throw new ApiServiceError(
        503,
        "kite_provider_unavailable",
        "KiteScan could not provide a validated history",
      );
    }
    const score = scoreEvents(data.events, data.afc_id, request.as_of);
    return KiteScoreResponseSchema.parse({
      score,
      events: data.events.map(publicEvent),
      complete: data.complete,
      pages: data.pages,
      offline: data.offline,
      outcome: !data.complete
        ? "PARTIAL_COVERAGE"
        : data.offline
          ? "OFFLINE_FIXTURE"
          : "COMPLETE",
      simulated_share: score.simulated_share,
    });
  }

  function event(eventId: string) {
    const parsedId = z
      .ulid()
      .refine((value) => value === value.toUpperCase())
      .safeParse(eventId);
    if (!parsedId.success) {
      throw new ApiServiceError(404, "event_not_found", "Event was not found");
    }
    const row = db
      .select({ eventJson: events.eventJson })
      .from(events)
      .where(eq(events.eventId, parsedId.data))
      .get();
    if (!row)
      throw new ApiServiceError(404, "event_not_found", "Event was not found");
    let value: unknown;
    try {
      value = JSON.parse(row.eventJson);
    } catch {
      throw new ApiServiceError(
        503,
        "invalid_stored_event",
        "Stored event data could not be read",
      );
    }
    const validated = BehaviorEventSchema.safeParse(value);
    if (!validated.success) {
      throw new ApiServiceError(
        503,
        "invalid_stored_event",
        "Stored event data failed validation",
      );
    }
    return EventResponseSchema.parse({
      event: publicEvent(validated.data),
      simulated_share: validated.data.simulated ? 1 : 0,
    });
  }

  function agents(asOf?: string) {
    const ids = db
      .selectDistinct({ afcId: events.subjectAfcId })
      .from(events)
      .all()
      .map(({ afcId }) => afcId)
      .sort();
    const resolvedScores = ids.map((afcId) => {
      const history = allEvents(afcId);
      const resolvedAsOf = resolveAsOf(afcId, asOf);
      const result = validateAgentScore(
        scoreAgent(
          history,
          afcId,
          resolvedAsOf,
          readEventRows(db, afcId, resolvedAsOf),
        ),
      );
      const latestEvent = history
        .filter(
          (event) => Date.parse(event.occurred_at) <= Date.parse(resolvedAsOf),
        )
        .at(-1);
      return {
        ...result,
        last_event_at: latestEvent?.occurred_at ?? null,
      };
    });
    const asOfValue = asOf
      ? canonicalIso(asOf, "as_of")
      : options.asOf
        ? canonicalIso(options.asOf, "as_of")
        : env.AFC_AS_OF
          ? canonicalIso(env.AFC_AS_OF, "AFC_AS_OF")
          : (resolvedScores
              .map((item) => item.as_of)
              .sort()
              .at(-1) ?? utcDayStart(Date.now()));
    const simulatedShare = resolvedScores.length
      ? resolvedScores.reduce((sum, item) => sum + item.simulated_share, 0) /
        resolvedScores.length
      : 0;
    return AgentsResponseSchema.parse({
      agents: resolvedScores,
      as_of: asOfValue,
      simulated_share: simulatedShare,
    });
  }

  async function report(afcIdRaw: string, asOf?: string) {
    const afcId = requireAfcId(afcIdRaw);
    const history = allEvents(afcId);
    if (history.length === 0) {
      throw new ApiServiceError(
        404,
        "agent_not_found",
        `No events found for ${afcId}`,
      );
    }
    const resolvedAsOf = resolveAsOf(afcId, asOf);
    const visibleHistory = history.filter(
      (event) => Date.parse(event.occurred_at) <= Date.parse(resolvedAsOf),
    );
    const rawScore = validateAgentScore(
      scoreAgent(
        history,
        afcId,
        resolvedAsOf,
        readEventRows(db, afcId, resolvedAsOf),
      ),
    );
    const visibleEvents = visibleHistory.slice(-50);
    const firstEventAt = visibleHistory[0]?.occurred_at ?? null;
    const lastEventAt = visibleHistory.at(-1)?.occurred_at ?? null;

    const verdictRows = db
      .select()
      .from(verdicts)
      .where(
        and(eq(verdicts.afcId, afcId), lte(verdicts.updatedAt, resolvedAsOf)),
      )
      .orderBy(desc(verdicts.updatedAt))
      .limit(50)
      .all();
    const verdictValues = verdictRows.map((row) => {
      const source = parseJsonColumn(row.resultJson);
      return VerdictRecordSchema.parse({
        eval_id: redact(row.evalId),
        status: row.status,
        score: row.score,
        decision: row.decision,
        confidence: row.confidence,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        result: publicReppoResult(source, redact),
      });
    });

    const serviceCalls = {
      db,
      afcId,
      env: { ...env, SERV_API_KEY: "", AFC_OFFLINE: "1" },
    };
    let trustMemo: string | null = null;
    let explainedScore: AgentScore = rawScore;
    if (rawScore.reason_codes.length > 0) {
      try {
        const explanation = await runServJob(
          4,
          {
            afc_id: afcId,
            score: rawScore.score,
            factors: rawScore.factors,
            reason_codes: rawScore.reason_codes,
            reader: "agent_owner",
          },
          serviceCalls,
        );
        const explained = applyExplanation(rawScore, explanation.data);
        trustMemo = explained.trust_memo;
        const { trust_memo: _memo, ...scoreWithText } = explained;
        explainedScore = AgentScoreSchema.parse(scoreWithText);
      } catch {
        trustMemo = null;
      }
    }

    const critiques = getCritiques(verdictValues, redact);
    let critiqueSummary = null;
    if (critiques.length > 0) {
      try {
        const summary = await runServJob(3, { critiques }, serviceCalls);
        critiqueSummary = CritiqueSummarySchema.parse(summary.data);
      } catch {
        critiqueSummary = null;
      }
    }

    const fraudGraph = readEventRows(db, afcId, resolvedAsOf);
    const fraudEvents = [...visibleHistory, ...fraudGraph];
    const fraudFindings = detectFraud(fraudEvents, {
      afcId,
      asOfMs: Date.parse(resolvedAsOf),
    });
    const timestampsById = new Map(
      fraudEvents.map((event) => [
        event.event_id,
        Date.parse(event.occurred_at),
      ]),
    );
    const firstCapAt = Math.min(
      ...fraudFindings
        .filter((finding) => finding.confirmed)
        .map((finding) =>
          Math.max(
            ...finding.source_event_ids.map(
              (id) => timestampsById.get(id) ?? Infinity,
            ),
          ),
        ),
    );
    const beforeAsOf = Number.isFinite(firstCapAt)
      ? new Date(firstCapAt - 1).toISOString()
      : null;
    const previous = beforeAsOf
      ? scoreAgent(history, afcId, beforeAsOf, fraudGraph)
      : null;
    const fraudTransition =
      beforeAsOf && previous?.status === "active" && previous.score !== null
        ? {
            score_before: previous.score,
            before_as_of: beforeAsOf,
            detector_at: new Date(firstCapAt).toISOString(),
          }
        : null;
    const fraudInput: ServInputs[5] = {
      afc_id: afcId,
      findings: fraudFindings.map((finding) => ({
        code: finding.code,
        text:
          REASON_CODES.find((reason) => reason.key === finding.code)
            ?.description ?? finding.code,
        source_event_ids: finding.source_event_ids.slice(0, 50),
      })),
    };
    let fraudReview: ReturnType<typeof applyFraudReview> | null = null;
    if (fraudInput.findings.length > 0) {
      try {
        const review = await runServJob(5, fraudInput, serviceCalls);
        fraudReview = applyFraudReview(fraudInput, review.data, {
          call_id: review.call_id,
          offline: review.offline,
        });
      } catch {
        fraudReview = null;
      }
    }

    const callRows = db
      .select()
      .from(servCalls)
      .where(eq(servCalls.afcId, afcId))
      .orderBy(desc(servCalls.createdAt))
      .all();
    const response = {
      score: explainedScore,
      history: { first_event_at: firstEventAt, last_event_at: lastEventAt },
      events: visibleEvents.map(publicEvent),
      verdicts: verdictValues,
      trust_memo: trustMemo,
      critique_summary: critiqueSummary,
      fraud_review: fraudReview,
      fraud_transition: fraudTransition,
      serv_call_ids: [...new Set(callRows.map((row) => redact(row.id)))],
      simulated_share: explainedScore.simulated_share,
    };
    return AgentReportSchema.parse(response);
  }

  function methodology() {
    return MethodologySchema.parse(METHODOLOGY);
  }

  function servLog(filters: ServLogOptions = {}) {
    const conditions = [];
    if (filters.afcId)
      conditions.push(eq(servCalls.afcId, requireAfcId(filters.afcId)));
    if (filters.job !== undefined)
      conditions.push(eq(servCalls.job, filters.job));
    const query = db.select().from(servCalls);
    const rows = (conditions.length ? query.where(and(...conditions)) : query)
      .orderBy(desc(servCalls.createdAt))
      .limit(filters.limit ?? 50)
      .all();
    const calls = rows.map((row) => publicServCall(row, redact, redactObject));
    const share = calls.length
      ? calls.filter((call) => call.offline).length / calls.length
      : 0;
    return ServLogResponseSchema.parse({ calls, simulated_share: share });
  }

  function scoreLog(content: string, input: ScoreLogOptions = {}) {
    if (env.AFC_HOSTED === "1" && input.save) {
      throw new ApiServiceError(
        403,
        "read_only_demo",
        "Saving uploads is disabled on this deployment",
      );
    }
    const rawEvents = parseBehaviorEventJsonl(content);
    const subjects = new Set(rawEvents.map((event) => event.subject.afc_id));
    if (subjects.size !== 1) {
      throw new ApiServiceError(
        422,
        "mixed_subjects",
        "A score upload must contain events for exactly one agent",
      );
    }
    const [inferredId] = subjects;
    const afcId = requireAfcId(input.afcId ?? inferredId ?? "");
    if (rawEvents.some((event) => event.subject.afc_id !== afcId)) {
      throw new ApiServiceError(
        422,
        "subject_mismatch",
        "Uploaded events do not match the requested AFC ID",
      );
    }
    const source = afcId.split(":")[1];
    if (
      input.save &&
      (source === "sim" || source === "kite" || source === "reppo")
    ) {
      throw new ApiServiceError(
        422,
        "reserved_upload_subject",
        "Uploads cannot target reserved simulator, Kite, or Reppo IDs",
      );
    }
    if (input.save) {
      const existing = db
        .select({ eventId: events.eventId })
        .from(events)
        .where(eq(events.subjectAfcId, afcId))
        .limit(1)
        .get();
      if (existing) {
        throw new ApiServiceError(
          409,
          "upload_target_exists",
          "Saved uploads can only initialize a new agent history",
        );
      }
      for (const event of rawEvents) {
        const collision = db
          .select({ eventId: events.eventId })
          .from(events)
          .where(eq(events.eventId, event.event_id))
          .get();
        if (collision) {
          throw new ApiServiceError(
            409,
            "event_id_conflict",
            "Uploaded event identifiers already exist",
          );
        }
      }
    }
    const normalizedEvents = rawEvents.map(normalizeUploadedEvent);
    const result = scoreEvents(normalizedEvents, afcId, input.asOf);
    const response = ScoreLogResponseSchema.parse({
      score: result,
      saved: input.save === true,
      simulated_share: result.simulated_share,
    });
    if (input.save) storeEvents(db, normalizedEvents);
    return response;
  }

  async function enqueueEvaluation(input: EvaluateRequest | unknown) {
    const request = EvaluateRequestSchema.parse(input);
    const serializedPayload = JSON.stringify({ samples: request.samples });
    if (
      new TextEncoder().encode(serializedPayload).byteLength >=
      REPPO_PAYLOAD_MAX_BYTES
    ) {
      throw new ApiServiceError(
        413,
        "payload_too_large",
        "Reppo trace payload must be under 50 KiB",
      );
    }
    if (
      request.criteria.some(
        (criterion) => new TextEncoder().encode(criterion).byteLength > 2048,
      )
    ) {
      throw new ApiServiceError(
        422,
        "criteria_too_large",
        "Each Reppo criterion must be at most 2 KiB",
      );
    }
    if (
      request.context &&
      new TextEncoder().encode(request.context).byteLength > 32_768
    ) {
      throw new ApiServiceError(
        422,
        "context_too_large",
        "Reppo context must be at most 32 KiB",
      );
    }
    if (
      env.AFC_HOSTED === "1" ||
      (env.NODE_ENV === "production" && env.AFC_EVALUATE_ENABLED !== "1")
    ) {
      throw new ApiServiceError(
        503,
        "evaluation_disabled",
        "Evaluation enqueue is disabled on this deployment",
      );
    }
    if (!env.REPPO_API_KEY?.trim()) {
      throw new ApiServiceError(
        503,
        "reppo_not_configured",
        "Local Reppo evaluation requires REPPO_API_KEY",
      );
    }
    const receipt = await (options.reppoEnqueue ?? enqueueReppoEvaluation)(
      db,
      request,
      {
        env,
        now: new Date(),
      },
    );
    return EvaluateReceiptSchema.parse(receipt);
  }

  return {
    agents,
    event,
    enqueueEvaluation,
    methodology,
    report,
    score,
    scoreEvents,
    scoreKite,
    scoreLog,
    servLog,
    resolveAsOf,
  };
}
