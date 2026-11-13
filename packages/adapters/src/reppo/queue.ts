import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
import type { AgentFicoDb } from "@agentfico/db";
import { redactText } from "@agentfico/serv/redact";
import { z } from "zod";
import { redactReppoRaw, safeReppoJson, sanitizeReppoValue } from "./redaction";
import type {
  EnqueueEvaluationInput,
  EnqueueEvaluationResult,
  ReppoApiContract,
  ReppoFetch,
  ReppoOptions,
  ReppoQueueEntry,
  ReppoQueueStatus,
  ReppoTickResult,
  RunReppoTickOptions,
} from "./types";

const ACTIVE_STATUSES = [
  "submitting",
  "pending",
  "reconciliation_required",
  "blocked",
] as const;
const POLL_INTERVAL_MS = 60_000;
const LIVE_SUBMIT_INTERVAL_MS = 15 * 60_000;
const STALE_SUBMIT_MS = 2 * 60_000;
const MAX_PAYLOAD_BYTES = 50 * 1024;
const MAX_CRITERION_BYTES = 2 * 1024;
const MAX_CONTEXT_BYTES = 32 * 1024;
const SETTLEMENT_MINUTES = [10, 15, 30, 60, 120, 360, 720, 1440] as const;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

interface RawQueueEntry {
  id: number;
  afc_id: string;
  account_id: string;
  type: string;
  payload_json: string;
  criteria_json: string;
  context_json: string | null;
  eval_id: string | null;
  status: ReppoQueueStatus;
  attempts: number;
  next_poll_at: string | null;
  last_error: string | null;
  simulated: number;
  offline: number;
  category: string | null;
  api_contract: ReppoApiContract;
  settlement_minutes: number;
  submit_started_at: string | null;
  settled_at: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ParsedVerdict {
  score: number;
  decision: "accept" | "revise" | "reject";
  confidence: "high" | "medium" | "low";
  route: "ship" | "auto-ship" | "review" | "block" | null;
  manipulation: boolean;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function nowDate(input?: Date): Date {
  const value = input ?? new Date();
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid Reppo clock");
  return new Date(value.getTime());
}

function offlineMode(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.AFC_OFFLINE === "1" || !env.REPPO_API_KEY?.trim();
}

function accountFingerprint(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const account = env.REPPO_ACCOUNT_ID?.trim();
  const key = env.REPPO_API_KEY?.trim();
  const source = account
    ? `account:${account}`
    : key
      ? `key:${key}`
      : "offline";
  return createHash("sha256").update(source).digest("hex");
}

function normalizeInput(
  input: EnqueueEvaluationInput,
  secrets: readonly string[],
): {
  afcId: string;
  samples: Array<{ id: string; task: string; output: string }>;
  payload: string;
  criteria: string[];
  context: string | null;
  category: string | null;
} {
  const afcId = redactText(input.afc_id, secrets);
  if (!/^afc:[a-z][a-z0-9_-]*:[^:\s]+$/.test(afcId)) {
    throw new Error("afc_id must use the afc:<source>:<id> format");
  }
  if (
    !Array.isArray(input.samples) ||
    input.samples.length < 3 ||
    input.samples.length > 5
  ) {
    throw new Error("Reppo trace evaluations require 3 to 5 samples");
  }
  const sampleIds = new Set<string>();
  const samples = input.samples.map((sample) => {
    if (
      !sample ||
      typeof sample.id !== "string" ||
      typeof sample.task !== "string" ||
      typeof sample.output !== "string"
    ) {
      throw new Error(
        "Each Reppo sample requires string id, task, and output fields",
      );
    }
    const normalized = {
      id: redactText(sample.id, secrets),
      task: redactText(sample.task, secrets),
      output: redactText(sample.output, secrets),
    };
    if (
      !normalized.id.trim() ||
      !normalized.task.trim() ||
      !normalized.output.trim()
    ) {
      throw new Error("Reppo sample fields cannot be empty");
    }
    if (sampleIds.has(normalized.id))
      throw new Error("Reppo sample ids must be unique");
    sampleIds.add(normalized.id);
    return normalized;
  });
  if (!Array.isArray(input.criteria) || input.criteria.length > 10) {
    throw new Error("Reppo criteria must contain 0 to 10 items");
  }
  const criteria = input.criteria.map((criterion) => {
    if (typeof criterion !== "string")
      throw new Error("Reppo criteria must be strings");
    const value = redactText(criterion, secrets);
    if (utf8Length(value) > MAX_CRITERION_BYTES) {
      throw new Error("Each Reppo criterion must be at most 2 KiB UTF-8");
    }
    return value;
  });
  const context =
    input.context === undefined ? null : redactText(input.context, secrets);
  if (context !== null && utf8Length(context) > MAX_CONTEXT_BYTES) {
    throw new Error("Reppo context must be at most 32 KiB UTF-8");
  }
  const payload = JSON.stringify({ samples });
  const category =
    input.category === undefined ? null : redactText(input.category, secrets);
  const evaluationInput = JSON.stringify({
    samples,
    criteria,
    ...(context === null ? {} : { context }),
    ...(category === null ? {} : { category }),
  });
  if (utf8Length(evaluationInput) >= MAX_PAYLOAD_BYTES) {
    throw new Error("Reppo input must be under 50 KiB UTF-8");
  }
  return { afcId, samples, payload, criteria, context, category };
}

function settlementMinutes(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const configured = env.REPPO_SETTLEMENT_MINUTES;
  if (configured === undefined || configured === "") return 10;
  const value = Number(configured);
  if (
    !SETTLEMENT_MINUTES.includes(value as (typeof SETTLEMENT_MINUTES)[number])
  ) {
    throw new Error(
      "REPPO_SETTLEMENT_MINUTES must be a supported Reppo window",
    );
  }
  return value;
}

function mapQueueRow(row: RawQueueEntry): ReppoQueueEntry {
  return {
    id: row.id,
    afcId: row.afc_id,
    accountId: row.account_id,
    type: row.type,
    payloadJson: row.payload_json,
    criteriaJson: row.criteria_json,
    contextJson: row.context_json,
    evalId: row.eval_id,
    status: row.status,
    attempts: row.attempts,
    nextPollAt: row.next_poll_at,
    lastError: row.last_error,
    simulated: row.simulated === 1,
    offline: row.offline === 1,
    category: row.category,
    apiContract: row.api_contract,
    settlementMinutes: row.settlement_minutes,
    submitStartedAt: row.submit_started_at,
    settledAt: row.settled_at,
    resultJson: row.result_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getQueueEntry(db: AgentFicoDb, id: number): ReppoQueueEntry | null {
  const row = db.$client
    .query("SELECT * FROM reppo_queue WHERE id = ?")
    .get(id) as RawQueueEntry | null;
  return row ? mapQueueRow(row) : null;
}

function queueResult(entry: ReppoQueueEntry): ReppoTickResult {
  return {
    status: entry.status,
    job_id: entry.id,
    eval_id: entry.evalId,
    offline: entry.offline,
    simulated_share: entry.offline || entry.simulated ? 1 : 0,
    ...(entry.nextPollAt ? { next_poll_at: entry.nextPollAt } : {}),
  };
}

export function enqueueEvaluation(
  db: AgentFicoDb,
  input: EnqueueEvaluationInput,
  options: ReppoOptions = {},
): EnqueueEvaluationResult {
  const env = options.env ?? process.env;
  const now = nowDate(options.now).toISOString();
  const key = env.REPPO_API_KEY?.trim() ?? "";
  const secrets = key ? [key] : [];
  const normalized = normalizeInput(input, secrets);
  const offline = offlineMode(env);
  const accountId = accountFingerprint(env);
  const settlement = settlementMinutes(env);
  const result = db.$client
    .query(
      `INSERT INTO reppo_queue
        (afc_id, account_id, type, payload_json, criteria_json, context_json,
         eval_id, status, attempts, next_poll_at, last_error, simulated, offline,
         category, api_contract, settlement_minutes, submit_started_at, settled_at, result_json,
         created_at, updated_at)
       VALUES (?, ?, 'trace', ?, ?, ?, NULL, 'queued', 0, NULL, NULL, ?, ?, ?, 'evals', ?, NULL, NULL, NULL, ?, ?)
       RETURNING id`,
    )
    .get(
      normalized.afcId,
      accountId,
      normalized.payload,
      JSON.stringify(normalized.criteria),
      normalized.context,
      input.simulated ? 1 : 0,
      offline ? 1 : 0,
      normalized.category,
      settlement,
      now,
      now,
    ) as { id: number } | null;
  if (!result) throw new Error("Could not persist Reppo queue intent");
  return {
    queue_id: result.id,
    afc_id: normalized.afcId,
    status: "queued",
    eval_id: null,
    offline,
    simulated_share: offline || input.simulated ? 1 : 0,
  };
}

function findActive(
  db: AgentFicoDb,
  accountId: string,
): ReppoQueueEntry | null {
  const slots = ACTIVE_STATUSES.map(() => "?").join(",");
  const row = db.$client
    .query(
      `SELECT * FROM reppo_queue
       WHERE account_id = ? AND status IN (${slots})
       ORDER BY created_at, id LIMIT 1`,
    )
    .get(accountId, ...ACTIVE_STATUSES) as RawQueueEntry | null;
  return row ? mapQueueRow(row) : null;
}

function findNextQueued(
  db: AgentFicoDb,
  accountId: string,
  allowedQueueIds?: readonly number[],
): ReppoQueueEntry | null {
  if (allowedQueueIds?.length === 0) return null;
  const allowlistClause = allowedQueueIds
    ? ` AND id IN (${allowedQueueIds.map(() => "?").join(",")})`
    : "";
  const row = db.$client
    .query(
      `SELECT * FROM reppo_queue WHERE account_id = ? AND status = 'queued'${allowlistClause} ORDER BY created_at, id LIMIT 1`,
    )
    .get(accountId, ...(allowedQueueIds ?? [])) as RawQueueEntry | null;
  return row ? mapQueueRow(row) : null;
}

function lastLiveSubmitAt(db: AgentFicoDb, accountId: string): string | null {
  const row = db.$client
    .query(
      `SELECT c.started_at FROM reppo_calls c
       JOIN reppo_queue q ON q.id = c.queue_id
       WHERE q.account_id = ? AND q.offline = 0 AND c.operation = 'submit'
       ORDER BY c.id DESC LIMIT 1`,
    )
    .get(accountId) as { started_at: string } | null;
  return row?.started_at ?? null;
}

function updateQueue(
  db: AgentFicoDb,
  id: number,
  status: ReppoQueueStatus,
  fields: {
    now: string;
    nextPollAt?: string | null;
    lastError?: string | null;
    evalId?: string | null;
    settledAt?: string | null;
    resultJson?: string | null;
  },
): void {
  db.$client
    .query(
      `UPDATE reppo_queue SET status = ?, next_poll_at = ?, last_error = ?,
       eval_id = COALESCE(?, eval_id), settled_at = COALESCE(?, settled_at),
       result_json = COALESCE(?, result_json), updated_at = ? WHERE id = ?`,
    )
    .run(
      status,
      fields.nextPollAt ?? null,
      fields.lastError ?? null,
      fields.evalId ?? null,
      fields.settledAt ?? null,
      fields.resultJson ?? null,
      fields.now,
      id,
    );
}

function insertAuditIntent(
  db: AgentFicoDb,
  queueId: number,
  operation: "submit" | "poll",
  request: unknown,
  secrets: readonly string[],
  now: string,
): number {
  const result = db.$client
    .query(
      `INSERT INTO reppo_calls
       (queue_id, operation, request_json, response_json, http_status, error, started_at, completed_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL) RETURNING id`,
    )
    .get(queueId, operation, safeReppoJson(request, secrets), now) as {
    id: number;
  } | null;
  if (!result) throw new Error("Could not persist Reppo call intent");
  return result.id;
}

function claimPollIntent(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  now: Date,
  secrets: readonly string[],
): number | null {
  if (!entry.evalId) return null;
  return db.$client.transaction(() => {
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
    const claimed = db.$client
      .query(
        `UPDATE reppo_queue SET next_poll_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND eval_id = ? AND next_poll_at <= ?`,
      )
      .run(
        nextPollAt,
        now.toISOString(),
        entry.id,
        entry.evalId,
        now.toISOString(),
      );
    if (claimed.changes === 0) return null;
    return insertAuditIntent(
      db,
      entry.id,
      "poll",
      { eval_id: entry.evalId },
      secrets,
      now.toISOString(),
    );
  })();
}

function recoverCompletedSubmit(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  now: Date,
): ReppoQueueEntry | null {
  const call = db.$client
    .query(
      `SELECT http_status, response_json, started_at FROM reppo_calls
       WHERE queue_id = ? AND operation = 'submit' AND completed_at IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(entry.id) as {
    http_status: number | null;
    response_json: string | null;
    started_at: string;
  } | null;
  if (!call || call.http_status === null) return null;
  let bodyValue: unknown = null;
  try {
    bodyValue =
      call.response_json === null ? null : JSON.parse(call.response_json);
  } catch {
    bodyValue = null;
  }
  const body = responseObject(bodyValue);
  const status = call.http_status;
  const evalId = responseEvalId(bodyValue, entry.apiContract);
  const queuedStatus = entry.apiContract === "evals" ? "QUEUED" : "PENDING";
  if (status === 201 && evalId && body?.status === queuedStatus) {
    const submittedAt = Date.parse(call.started_at);
    const earliestPollAt = submittedAt + POLL_INTERVAL_MS;
    const nextPollAt = new Date(
      Math.max(now.getTime(), earliestPollAt),
    ).toISOString();
    updateQueue(db, entry.id, "pending", {
      now: now.toISOString(),
      evalId,
      nextPollAt,
      lastError: null,
    });
  } else if (body?.status === "FAILED") {
    const resultJson = safeReppoJson(bodyValue);
    updateQueue(db, entry.id, "failed", {
      now: now.toISOString(),
      evalId,
      lastError: "evaluation_failed",
      resultJson,
    });
    if (evalId) {
      db.$client
        .query(
          `INSERT INTO verdicts
           (eval_id, afc_id, status, score, decision, confidence, result_json, created_at, updated_at)
           VALUES (?, ?, 'FAILED', NULL, NULL, NULL, ?, ?, ?)
           ON CONFLICT(eval_id) DO UPDATE SET status = 'FAILED', result_json = excluded.result_json,
           updated_at = excluded.updated_at`,
        )
        .run(
          evalId,
          entry.afcId,
          resultJson,
          now.toISOString(),
          now.toISOString(),
        );
    }
  } else if (status === 402 || status === 401 || status === 403) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError:
        status === 402
          ? "insufficient_credits"
          : "authentication_or_permission",
    });
  } else if (status === 409) {
    if (entry.evalId) {
      const nextPollAt = new Date(
        now.getTime() + POLL_INTERVAL_MS,
      ).toISOString();
      updateQueue(db, entry.id, "pending", {
        now: now.toISOString(),
        evalId: entry.evalId,
        nextPollAt,
        lastError: null,
      });
    } else {
      updateQueue(db, entry.id, "reconciliation_required", {
        now: now.toISOString(),
        lastError: "conflict_pending_eval_unknown",
      });
    }
  } else if (
    status >= 500 ||
    status === 408 ||
    status === 429 ||
    status === 201
  ) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "submit_response_ambiguous",
    });
  } else {
    updateQueue(db, entry.id, "failed", {
      now: now.toISOString(),
      lastError: `submit_http_${status}`,
    });
  }
  return getQueueEntry(db, entry.id);
}

function completeAudit(
  db: AgentFicoDb,
  callId: number,
  response: unknown,
  httpStatus: number | null,
  error: string | null,
  secrets: readonly string[],
  now: string,
): string {
  const responseJson =
    JSON.stringify(redactReppoRaw(response, secrets)) ?? "null";
  db.$client
    .query(
      `UPDATE reppo_calls SET response_json = ?, http_status = ?, error = ?, completed_at = ? WHERE id = ?`,
    )
    .run(responseJson, httpStatus, error, now, callId);
  return responseJson;
}

function defaultRealFixtureDirectory(): string {
  return resolve(import.meta.dir, "../../../../fixtures/reppo/real");
}

function writeRealFixture(
  directory: string,
  queueId: number,
  callId: number,
  operation: string,
  httpStatus: number,
  response: unknown,
  now: string,
  secrets: readonly string[],
): void {
  const safeResponse = sanitizeReppoValue(response, secrets);
  const queueKey = createHash("sha256")
    .update(String(queueId))
    .digest("hex")
    .slice(0, 12);
  const timestamp = now.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${queueKey}-${callId}-${operation}.json`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, filename),
    `${JSON.stringify(
      {
        recorded_at: now,
        operation,
        http_status: httpStatus,
        response: safeResponse,
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

function recordLiveResponse(
  db: AgentFicoDb,
  callId: number,
  response: unknown,
  httpStatus: number,
  secrets: readonly string[],
  now: Date,
): unknown {
  const safeResponse = sanitizeReppoValue(response, secrets);
  completeAudit(
    db,
    callId,
    response,
    httpStatus,
    null,
    secrets,
    now.toISOString(),
  );
  return safeResponse;
}

function exportLiveFixture(
  entry: ReppoQueueEntry,
  callId: number,
  operation: "submit" | "poll",
  httpStatus: number,
  response: unknown,
  contentType: string,
  options: RunReppoTickOptions,
  secrets: readonly string[],
  now: Date,
): void {
  const fixtureResponse =
    typeof response === "string"
      ? {
          non_json: true,
          content_type: contentType,
          body_sha256: createHash("sha256").update(response).digest("hex"),
        }
      : response;
  writeRealFixture(
    options.fixtureDirectory ?? defaultRealFixtureDirectory(),
    entry.id,
    callId,
    operation,
    httpStatus,
    fixtureResponse,
    now.toISOString(),
    secrets,
  );
}

function parseResponseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function responseEvalId(
  value: unknown,
  contract: ReppoApiContract,
): string | null {
  const body = responseObject(value);
  const key = contract === "evals" ? "id" : "evalId";
  const candidate = body?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function isPendingStatus(status: unknown, contract: ReppoApiContract): boolean {
  return contract === "evals"
    ? status === "QUEUED" || status === "PROCESSING"
    : status === "PENDING";
}

function isSettledStatus(status: unknown, contract: ReppoApiContract): boolean {
  return contract === "evals" ? status === "COMPLETED" : status === "SETTLED";
}

function validVerdict(
  value: unknown,
  contract: ReppoApiContract,
): ParsedVerdict | null {
  const top = responseObject(value);
  const result = responseObject(top?.result);
  const verdict =
    contract === "evals" ? result : responseObject(result?.verdict);
  const decision = verdict?.decision;
  const confidence = verdict?.confidence;
  const routeValue =
    contract === "evals"
      ? (result?.route ?? top?.route)
      : (responseObject(result?.action)?.route ?? result?.route);
  const routeValues =
    contract === "evals"
      ? ["ship", "review", "block"]
      : ["auto-ship", "review", "block"];
  const route = routeValues.includes(String(routeValue))
    ? (routeValue as ParsedVerdict["route"])
    : null;
  const score = verdict?.score;
  const validDecisions =
    contract === "evals"
      ? ["accept", "reject"]
      : ["accept", "revise", "reject"];
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    !validDecisions.includes(String(decision)) ||
    !["high", "medium", "low"].includes(String(confidence))
  ) {
    return null;
  }
  if (
    contract === "evals" &&
    ((top?.score !== undefined && top.score !== score) ||
      (top?.route !== undefined && top.route !== routeValue))
  ) {
    return null;
  }
  if (contract === "eval-requests") {
    for (const item of Array.isArray(result?.verdicts) ? result.verdicts : []) {
      const criterionVerdict = responseObject(item);
      if (
        !criterionVerdict ||
        typeof criterionVerdict.criterion !== "string" ||
        typeof criterionVerdict.score !== "number" ||
        !Number.isFinite(criterionVerdict.score) ||
        criterionVerdict.score < 0 ||
        criterionVerdict.score > 10 ||
        (criterionVerdict.critique !== undefined &&
          typeof criterionVerdict.critique !== "string")
      ) {
        return null;
      }
    }
  } else {
    const rubricScores = result?.rubric_scores;
    if (
      rubricScores !== undefined &&
      (!responseObject(rubricScores) ||
        Object.values(rubricScores as Record<string, unknown>).some(
          (item) => typeof item !== "number" || !Number.isFinite(item),
        ))
    ) {
      return null;
    }
  }
  const manipulation =
    contract === "eval-requests" && decision === "accept" && route === "review";
  return {
    score,
    decision: decision as ParsedVerdict["decision"],
    confidence: confidence as ParsedVerdict["confidence"],
    route,
    manipulation,
  };
}

function encodeBase32(value: bigint, length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

function stableUlid(timestamp: string, seed: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || time < 0 || time > 281_474_976_710_655) {
    throw new Error("Cannot create a Reppo event ID from an invalid timestamp");
  }
  const digest = createHash("sha256").update(seed).digest();
  const randomness = BigInt(`0x${digest.subarray(0, 10).toString("hex")}`);
  return `${encodeBase32(BigInt(time), 10)}${encodeBase32(randomness, 16)}`;
}

function sampleCount(entry: ReppoQueueEntry): number {
  const parsed = JSON.parse(entry.payloadJson) as { samples?: unknown[] };
  return Array.isArray(parsed.samples) ? parsed.samples.length : 0;
}

function eventFromVerdict(
  entry: Pick<ReppoQueueEntry, "afcId" | "evalId" | "simulated" | "category">,
  verdict: ParsedVerdict,
  occurredAt: string,
  count: number,
): BehaviorEvent {
  const event: BehaviorEvent = {
    event_id: stableUlid(occurredAt, `reppo:${entry.evalId}`),
    subject: { afc_id: entry.afcId },
    source: "reppo",
    simulated: entry.simulated,
    attestation: "platform_signed",
    type: "work.evaluated",
    occurred_at: occurredAt,
    evidence: { eval_id: entry.evalId ?? undefined },
    attrs: {
      reppo_score: verdict.score,
      decision: verdict.decision,
      confidence: verdict.confidence,
      manipulation: verdict.manipulation,
      sample_count: count,
      ...(entry.category === null ? {} : { category: entry.category }),
      ...(verdict.route === null ? {} : { route: verdict.route }),
    },
  };
  return BehaviorEventSchema.parse(event);
}

function eventFromOfflineFixture(
  entry: ReppoQueueEntry,
  verdict: ParsedVerdict,
  occurredAt: string,
): BehaviorEvent {
  const event: BehaviorEvent = {
    event_id: stableUlid(occurredAt, `offline-reppo:${entry.id}`),
    subject: { afc_id: entry.afcId },
    source: "simulator",
    simulated: true,
    attestation: "self_reported",
    type: "work.evaluated",
    occurred_at: occurredAt,
    attrs: {
      reppo_score: verdict.score,
      decision: verdict.decision,
      confidence: verdict.confidence,
      sample_count: sampleCount(entry),
      evaluation_origin: "synthetic_simulation",
      evaluation_status: "synthetic_not_reppo",
      ...(entry.category === null ? {} : { category: entry.category }),
    },
  };
  return BehaviorEventSchema.parse(event);
}

function persistEvent(db: AgentFicoDb, event: BehaviorEvent): void {
  const evidenceHash = event.evidence?.eval_id
    ? createHash("sha256")
        .update(JSON.stringify({ eval_id: event.evidence.eval_id }))
        .digest("hex")
    : null;
  db.$client
    .query(
      `INSERT OR IGNORE INTO events
       (event_id, subject_afc_id, source, simulated, attestation, event_type,
        occurred_at, evidence_hash, event_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.event_id,
      event.subject.afc_id,
      event.source,
      event.simulated ? 1 : 0,
      event.attestation,
      event.type,
      event.occurred_at,
      evidenceHash,
      JSON.stringify(event),
    );
}

const recordedEvaluationSchema = z.object({
  id: z.string().min(1),
  status: z.literal("COMPLETED"),
  taskType: z.literal("response"),
  input: z.string(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});

export function importRecordedReppoEvaluation(
  db: AgentFicoDb,
  afcId: string,
  response: unknown,
  simulated: boolean,
): BehaviorEvent {
  const sanitized = sanitizeReppoValue(response);
  const record = recordedEvaluationSchema.parse(sanitized);
  const verdict = validVerdict(sanitized, "evals");
  if (!verdict) throw new Error("Invalid recorded Reppo verdict");
  const trace = z
    .object({
      samples: z.array(z.unknown()).min(3).max(5),
      category: z.string().optional(),
    })
    .parse(JSON.parse(record.input));
  const event = eventFromVerdict(
    { afcId, evalId: record.id, simulated, category: trace.category ?? null },
    verdict,
    record.completedAt,
    trace.samples.length,
  );

  db.$client.transaction(() => {
    const prior = db.$client
      .query<{ afc_id: string }, [string]>(
        "SELECT afc_id FROM verdicts WHERE eval_id = ?",
      )
      .get(record.id);
    if (prior && prior.afc_id !== afcId)
      throw new Error("Recorded evaluation belongs to a different subject");
    persistEvent(db, event);
    db.$client
      .query(
        `INSERT INTO verdicts
       (eval_id, afc_id, status, score, decision, confidence, result_json, created_at, updated_at)
       VALUES (?, ?, 'SETTLED', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(eval_id) DO NOTHING`,
      )
      .run(
        record.id,
        afcId,
        verdict.score,
        verdict.decision,
        verdict.confidence,
        JSON.stringify(sanitized),
        record.createdAt,
        record.completedAt,
      );
  })();
  return event;
}

function persistSettlement(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  event: BehaviorEvent,
  responseJson: string,
  verdict: ParsedVerdict,
  now: string,
): void {
  if (!entry.evalId)
    throw new Error("Settled Reppo response has no evaluation ID");
  db.$client.transaction(() => {
    const changed = db.$client
      .query(
        `UPDATE reppo_queue SET status = 'settled', next_poll_at = NULL,
         last_error = NULL, settled_at = ?, result_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND eval_id = ?`,
      )
      .run(now, responseJson, now, entry.id, entry.evalId);
    if (changed.changes === 0) {
      const current = getQueueEntry(db, entry.id);
      if (current?.status === "settled") return;
      throw new Error("Reppo queue state changed before settlement storage");
    }
    persistEvent(db, event);
    db.$client
      .query(
        `INSERT INTO verdicts
         (eval_id, afc_id, status, score, decision, confidence, result_json, created_at, updated_at)
         VALUES (?, ?, 'SETTLED', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(eval_id) DO UPDATE SET status = excluded.status,
         score = excluded.score, decision = excluded.decision,
         confidence = excluded.confidence, result_json = excluded.result_json,
         updated_at = excluded.updated_at`,
      )
      .run(
        entry.evalId,
        entry.afcId,
        verdict.score,
        verdict.decision,
        verdict.confidence,
        responseJson,
        now,
        now,
      );
  })();
}

function persistOfflineSettlement(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  event: BehaviorEvent,
  resultJson: string,
  now: string,
): boolean {
  return db.$client.transaction(() => {
    const changed = db.$client
      .query(
        `UPDATE reppo_queue SET status = 'settled', next_poll_at = NULL,
         last_error = NULL, settled_at = ?, result_json = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(now, resultJson, now, entry.id);
    if (changed.changes === 0) return false;
    persistEvent(db, event);
    return true;
  })();
}

function defaultOfflineFixtureDirectory(): string {
  return resolve(import.meta.dir, "../../../../fixtures/reppo/offline");
}

function processOffline(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  options: RunReppoTickOptions,
  now: Date,
): ReppoTickResult {
  const path = join(
    options.fixtureDirectory ?? defaultOfflineFixtureDirectory(),
    "settled.json",
  );
  const fixture = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsedFixture = responseObject(fixture);
  if (parsedFixture?.status !== "SETTLED") {
    throw new Error(
      "Offline Reppo fixture must describe a settled synthetic verdict",
    );
  }
  const verdict = validVerdict(fixture, "eval-requests");
  if (!verdict) throw new Error("Offline Reppo fixture has an invalid verdict");
  const settledAt = now.toISOString();
  const event = eventFromOfflineFixture(entry, verdict, settledAt);
  const resultJson = JSON.stringify({ offline: true, fixture });
  const stored = persistOfflineSettlement(
    db,
    entry,
    event,
    resultJson,
    settledAt,
  );
  const updated = getQueueEntry(db, entry.id);
  if (!stored && updated?.status !== "settled") {
    return updated
      ? queueResult(updated)
      : { status: "idle", offline: true, simulated_share: 1 };
  }
  return updated
    ? queueResult(updated)
    : { status: "idle", offline: true, simulated_share: 1 };
}

function claimLiveSubmission(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  now: string,
  secrets: readonly string[],
): { entry: ReppoQueueEntry; callId: number } | null {
  try {
    return db.$client.transaction(() => {
      const changed = db.$client
        .query(
          `UPDATE reppo_queue SET status = 'submitting', submit_started_at = ?,
           attempts = attempts + 1, next_poll_at = NULL, last_error = NULL, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(now, now, entry.id);
      if (changed.changes === 0) return null;
      const claimed = getQueueEntry(db, entry.id);
      if (!claimed) throw new Error("Claimed Reppo queue row disappeared");
      const callId = insertAuditIntent(
        db,
        claimed.id,
        "submit",
        submissionRequest(claimed),
        secrets,
        now,
      );
      return { entry: claimed, callId };
    })();
  } catch (error) {
    const active = findActive(db, entry.accountId);
    if (active) return null;
    throw error;
  }
}

function requestHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function endpointBase(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const base = (env.REPPO_BASE_URL ?? "https://eval.reppo.xyz/api/v1").replace(
    /\/+$/,
    "",
  );
  return `${base}/agents`;
}

function submitEndpoint(
  env: Readonly<Record<string, string | undefined>>,
  contract: ReppoApiContract,
): string {
  return contract === "evals"
    ? `${endpointBase(env)}/evals`
    : `${endpointBase(env)}/eval-requests/submit`;
}

function pollEndpoint(
  env: Readonly<Record<string, string | undefined>>,
  contract: ReppoApiContract,
  evalId: string,
): string {
  const id = encodeURIComponent(evalId);
  return contract === "evals"
    ? `${endpointBase(env)}/evals/${id}`
    : `${endpointBase(env)}/eval-requests/${id}`;
}

function currentEvaluationInput(entry: ReppoQueueEntry): string {
  const payload = JSON.parse(entry.payloadJson) as { samples?: unknown };
  const input = JSON.stringify({
    samples: payload.samples,
    criteria: JSON.parse(entry.criteriaJson) as string[],
    ...(entry.contextJson === null ? {} : { context: entry.contextJson }),
    ...(entry.category === null ? {} : { category: entry.category }),
  });
  if (utf8Length(input) >= MAX_PAYLOAD_BYTES) {
    throw new Error("Reppo input must be under 50 KiB UTF-8");
  }
  return input;
}

function submissionRequest(entry: ReppoQueueEntry): Record<string, unknown> {
  if (entry.apiContract === "evals") {
    return { taskType: "response", input: currentEvaluationInput(entry) };
  }
  return {
    type: "trace",
    payload: entry.payloadJson,
    criteria: JSON.parse(entry.criteriaJson) as string[],
    ...(entry.contextJson === null ? {} : { context: entry.contextJson }),
    settlementMinutes: entry.settlementMinutes,
  };
}

async function fetchJson(
  fetcher: ReppoFetch,
  url: string,
  init: RequestInit,
): Promise<{
  status: number;
  ok: boolean;
  body: unknown;
  contentType: string;
}> {
  const response = await fetcher(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: parseResponseBody(text),
    contentType: response.headers.get("content-type") ?? "unknown",
  };
}

function fixtureOptions(
  options: RunReppoTickOptions,
  env: Readonly<Record<string, string | undefined>>,
): RunReppoTickOptions {
  return {
    ...options,
    fixtureDirectory:
      options.fixtureDirectory ??
      (env.AFC_REPPO_FIXTURE_DIR
        ? resolve(env.AFC_REPPO_FIXTURE_DIR)
        : undefined),
  };
}

async function submitLive(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  callId: number,
  options: RunReppoTickOptions,
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
): Promise<ReppoTickResult> {
  const apiKey = env.REPPO_API_KEY?.trim();
  if (!apiKey) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError: "credentials_missing",
    });
    const updated = getQueueEntry(db, entry.id);
    return updated
      ? queueResult(updated)
      : {
          status: "blocked",
          job_id: entry.id,
          offline: false,
          simulated_share: 0,
        };
  }
  const secrets = [apiKey];
  const request = submissionRequest(entry);
  let httpResult: {
    status: number;
    ok: boolean;
    body: unknown;
    contentType: string;
  };
  try {
    httpResult = await fetchJson(
      options.fetch ?? globalThis.fetch,
      submitEndpoint(env, entry.apiContract),
      {
        method: "POST",
        headers: requestHeaders(apiKey),
        body: JSON.stringify(request),
      },
    );
  } catch {
    completeAudit(
      db,
      callId,
      null,
      null,
      "submit_transport_unknown",
      secrets,
      now.toISOString(),
    );
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "submit_transport_unknown",
    });
    const updated = getQueueEntry(db, entry.id);
    return updated
      ? queueResult(updated)
      : {
          status: "reconciliation_required",
          job_id: entry.id,
          offline: false,
          simulated_share: entry.simulated ? 1 : 0,
        };
  }

  const safeBody = recordLiveResponse(
    db,
    callId,
    httpResult.body,
    httpResult.status,
    secrets,
    now,
  );
  const body = responseObject(safeBody);
  const evalId = responseEvalId(safeBody, entry.apiContract);
  const queuedStatus = entry.apiContract === "evals" ? "QUEUED" : "PENDING";
  if (httpResult.status === 402) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError: "insufficient_credits",
    });
  } else if (httpResult.status === 409) {
    if (entry.evalId) {
      const nextPollAt = new Date(
        now.getTime() + POLL_INTERVAL_MS,
      ).toISOString();
      updateQueue(db, entry.id, "pending", {
        now: now.toISOString(),
        evalId: entry.evalId,
        nextPollAt,
        lastError: null,
      });
    } else {
      updateQueue(db, entry.id, "reconciliation_required", {
        now: now.toISOString(),
        lastError: "conflict_pending_eval_unknown",
      });
    }
  } else if (httpResult.status === 401 || httpResult.status === 403) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError: "authentication_or_permission",
    });
  } else if (body?.status === "FAILED" && evalId) {
    const resultJson = safeReppoJson(safeBody, secrets);
    updateQueue(db, entry.id, "failed", {
      now: now.toISOString(),
      evalId,
      lastError: "evaluation_failed",
      resultJson,
    });
    db.$client
      .query(
        `INSERT INTO verdicts
         (eval_id, afc_id, status, score, decision, confidence, result_json, created_at, updated_at)
         VALUES (?, ?, 'FAILED', NULL, NULL, NULL, ?, ?, ?)
         ON CONFLICT(eval_id) DO UPDATE SET status = 'FAILED', result_json = excluded.result_json,
         updated_at = excluded.updated_at`,
      )
      .run(
        evalId,
        entry.afcId,
        resultJson,
        now.toISOString(),
        now.toISOString(),
      );
  } else if (!httpResult.ok && httpResult.status >= 500) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "submit_server_error_unknown",
    });
  } else if (
    httpResult.status === 201 &&
    evalId &&
    body?.status === queuedStatus
  ) {
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
    updateQueue(db, entry.id, "pending", {
      now: now.toISOString(),
      evalId,
      nextPollAt,
      lastError: null,
    });
  } else if (
    httpResult.status === 201 ||
    httpResult.status === 408 ||
    httpResult.status === 429
  ) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      evalId,
      lastError: "submit_response_ambiguous",
    });
  } else {
    updateQueue(db, entry.id, "failed", {
      now: now.toISOString(),
      lastError: `submit_http_${httpResult.status}`,
    });
  }
  exportLiveFixture(
    entry,
    callId,
    "submit",
    httpResult.status,
    safeBody,
    httpResult.contentType,
    fixtureOptions(options, env),
    secrets,
    now,
  );
  const updated = getQueueEntry(db, entry.id);
  return updated
    ? queueResult(updated)
    : { status: "idle", offline: false, simulated_share: 0 };
}

function updatePollError(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  callId: number,
  error: string,
  secrets: readonly string[],
  now: Date,
): ReppoTickResult {
  completeAudit(db, callId, null, null, error, secrets, now.toISOString());
  const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
  updateQueue(db, entry.id, "pending", {
    now: now.toISOString(),
    nextPollAt,
    lastError: error,
  });
  const updated = getQueueEntry(db, entry.id);
  return updated
    ? queueResult(updated)
    : { status: "idle", offline: false, simulated_share: 0 };
}

async function pollLive(
  db: AgentFicoDb,
  entry: ReppoQueueEntry,
  options: RunReppoTickOptions,
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
): Promise<ReppoTickResult> {
  const apiKey = env.REPPO_API_KEY?.trim();
  if (!apiKey) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError: "credentials_missing",
    });
    const updated = getQueueEntry(db, entry.id);
    return updated
      ? queueResult(updated)
      : {
          status: "blocked",
          job_id: entry.id,
          eval_id: entry.evalId,
          offline: false,
          simulated_share: entry.simulated ? 1 : 0,
        };
  }
  if (!entry.evalId) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "pending_eval_id_missing",
    });
    const updated = getQueueEntry(db, entry.id);
    return updated
      ? queueResult(updated)
      : {
          status: "reconciliation_required",
          job_id: entry.id,
          offline: false,
          simulated_share: entry.simulated ? 1 : 0,
        };
  }
  const secrets = [apiKey];
  const callId = claimPollIntent(db, entry, now, secrets);
  if (callId === null) {
    const current = getQueueEntry(db, entry.id);
    return current ? queueResult(current) : queueResult(entry);
  }
  let httpResult: {
    status: number;
    ok: boolean;
    body: unknown;
    contentType: string;
  };
  try {
    httpResult = await fetchJson(
      options.fetch ?? globalThis.fetch,
      pollEndpoint(env, entry.apiContract, entry.evalId),
      { method: "GET", headers: requestHeaders(apiKey) },
    );
  } catch {
    return updatePollError(
      db,
      entry,
      callId,
      "poll_transport_error",
      secrets,
      now,
    );
  }
  const safeBody = recordLiveResponse(
    db,
    callId,
    httpResult.body,
    httpResult.status,
    secrets,
    now,
  );
  const body = responseObject(safeBody);
  if (
    httpResult.status === 402 ||
    httpResult.status === 401 ||
    httpResult.status === 403
  ) {
    updateQueue(db, entry.id, "blocked", {
      now: now.toISOString(),
      lastError:
        httpResult.status === 402
          ? "insufficient_credits"
          : "authentication_or_permission",
    });
  } else if (httpResult.status === 404) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "known_eval_not_found",
    });
  } else if (!httpResult.ok && httpResult.status >= 500) {
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
    updateQueue(db, entry.id, "pending", {
      now: now.toISOString(),
      nextPollAt,
      lastError: `poll_http_${httpResult.status}`,
    });
  } else if (!httpResult.ok) {
    updateQueue(db, entry.id, "failed", {
      now: now.toISOString(),
      lastError: `poll_http_${httpResult.status}`,
    });
  } else if (responseEvalId(safeBody, entry.apiContract) !== entry.evalId) {
    updateQueue(db, entry.id, "reconciliation_required", {
      now: now.toISOString(),
      lastError: "poll_eval_id_mismatch",
    });
  } else if (isPendingStatus(body?.status, entry.apiContract)) {
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
    updateQueue(db, entry.id, "pending", {
      now: now.toISOString(),
      nextPollAt,
      lastError: null,
    });
  } else if (body?.status === "FAILED") {
    const resultJson = safeReppoJson(safeBody, secrets);
    db.$client.transaction(() => {
      db.$client
        .query(
          `UPDATE reppo_queue SET status = 'failed', next_poll_at = NULL,
           last_error = NULL, settled_at = ?, result_json = ?, updated_at = ?
           WHERE id = ? AND status = 'pending' AND eval_id = ?`,
        )
        .run(
          now.toISOString(),
          resultJson,
          now.toISOString(),
          entry.id,
          entry.evalId,
        );
      db.$client
        .query(
          `INSERT INTO verdicts
           (eval_id, afc_id, status, score, decision, confidence, result_json, created_at, updated_at)
           VALUES (?, ?, 'FAILED', NULL, NULL, NULL, ?, ?, ?)
           ON CONFLICT(eval_id) DO UPDATE SET status = 'FAILED', result_json = excluded.result_json,
           updated_at = excluded.updated_at`,
        )
        .run(
          entry.evalId,
          entry.afcId,
          resultJson,
          now.toISOString(),
          now.toISOString(),
        );
    })();
  } else if (isSettledStatus(body?.status, entry.apiContract)) {
    const verdict = validVerdict(safeBody, entry.apiContract);
    if (!verdict) {
      updateQueue(db, entry.id, "reconciliation_required", {
        now: now.toISOString(),
        lastError: "settled_response_invalid",
      });
    } else {
      const settledAtRaw =
        entry.apiContract === "evals" ? body?.completedAt : body?.settledAt;
      const settledAt =
        typeof settledAtRaw === "string" &&
        Number.isFinite(Date.parse(settledAtRaw))
          ? new Date(settledAtRaw).toISOString()
          : now.toISOString();
      const event = eventFromVerdict(
        entry,
        verdict,
        settledAt,
        sampleCount(entry),
      );
      try {
        persistSettlement(
          db,
          entry,
          event,
          safeReppoJson(safeBody, secrets),
          verdict,
          settledAt,
        );
      } catch {
        updateQueue(db, entry.id, "reconciliation_required", {
          now: now.toISOString(),
          lastError: "settlement_storage_failed",
        });
      }
    }
  } else {
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS).toISOString();
    updateQueue(db, entry.id, "pending", {
      now: now.toISOString(),
      nextPollAt,
      lastError: "poll_response_unrecognized",
    });
  }
  exportLiveFixture(
    entry,
    callId,
    "poll",
    httpResult.status,
    safeBody,
    httpResult.contentType,
    fixtureOptions(options, env),
    secrets,
    now,
  );
  const updated = getQueueEntry(db, entry.id);
  return updated
    ? queueResult(updated)
    : { status: "idle", offline: false, simulated_share: 0 };
}

export async function runReppoTick(
  db: AgentFicoDb,
  options: RunReppoTickOptions = {},
): Promise<ReppoTickResult> {
  const env = options.env ?? process.env;
  const now = nowDate(options.now);
  const nowIso = now.toISOString();
  const accountId = accountFingerprint(env);
  const active = findActive(db, accountId);
  if (active) {
    if (!active.offline && offlineMode(env)) {
      return {
        ...queueResult(active),
        status: "blocked",
        reason: "offline_mode",
      };
    }
    if (
      active.status === "blocked" ||
      active.status === "reconciliation_required"
    ) {
      return queueResult(active);
    }
    if (active.status === "submitting") {
      if (active.evalId) {
        const dueAt = new Date(
          Date.parse(active.submitStartedAt ?? active.createdAt) +
            POLL_INTERVAL_MS,
        ).toISOString();
        const nextPollAt = Date.parse(dueAt) <= now.getTime() ? nowIso : dueAt;
        updateQueue(db, active.id, "pending", {
          now: nowIso,
          evalId: active.evalId,
          nextPollAt,
          lastError: null,
        });
        const resumed = getQueueEntry(db, active.id);
        return resumed ? queueResult(resumed) : queueResult(active);
      }
      const recovered = recoverCompletedSubmit(db, active, now);
      if (recovered) return queueResult(recovered);
      const startedAt = Date.parse(active.submitStartedAt ?? active.updatedAt);
      if (now.getTime() - startedAt >= STALE_SUBMIT_MS) {
        updateQueue(db, active.id, "reconciliation_required", {
          now: nowIso,
          lastError: "submit_result_unknown_after_restart",
        });
        const reconciled = getQueueEntry(db, active.id);
        return reconciled ? queueResult(reconciled) : queueResult(active);
      }
      return queueResult(active);
    }
    if (active.status === "pending") {
      if (!active.nextPollAt || Date.parse(active.nextPollAt) > now.getTime()) {
        return queueResult(active);
      }
      return pollLive(db, active, options, env, now);
    }
    return queueResult(active);
  }

  const queued = findNextQueued(db, accountId, options.allowedQueueIds);
  if (!queued) {
    return {
      status: "idle",
      offline: offlineMode(env),
      simulated_share: 0,
    };
  }
  if (queued.offline) return processOffline(db, queued, options, now);
  if (offlineMode(env)) {
    return {
      ...queueResult(queued),
      status: "blocked",
      reason: "offline_mode",
    };
  }
  if (!env.REPPO_API_KEY?.trim()) {
    updateQueue(db, queued.id, "blocked", {
      now: nowIso,
      lastError: "credentials_missing",
    });
    const blocked = getQueueEntry(db, queued.id);
    return blocked
      ? queueResult(blocked)
      : {
          status: "blocked",
          job_id: queued.id,
          offline: false,
          simulated_share: queued.simulated ? 1 : 0,
        };
  }

  const lastSubmit = lastLiveSubmitAt(db, accountId);
  if (lastSubmit) {
    const nextAllowedAt = Date.parse(lastSubmit) + LIVE_SUBMIT_INTERVAL_MS;
    if (nextAllowedAt > now.getTime()) {
      return {
        ...queueResult(queued),
        next_poll_at: new Date(nextAllowedAt).toISOString(),
      };
    }
  }
  const apiKey = env.REPPO_API_KEY.trim();
  const claim = claimLiveSubmission(db, queued, nowIso, [apiKey]);
  if (!claim) {
    const current =
      findActive(db, accountId) ??
      findNextQueued(db, accountId, options.allowedQueueIds);
    return current
      ? queueResult(current)
      : { status: "idle", offline: false, simulated_share: 0 };
  }
  return submitLive(db, claim.entry, claim.callId, options, env, now);
}

export function getReppoQueueStatus(
  db: AgentFicoDb,
  queueId: number,
): ReppoTickResult | null {
  const entry = getQueueEntry(db, queueId);
  return entry ? queueResult(entry) : null;
}

export function reppoInputPayload(input: EnqueueEvaluationInput): string {
  return JSON.stringify({ samples: input.samples });
}

export function parseStoredReppoEntry(
  db: AgentFicoDb,
  queueId: number,
): ReppoQueueEntry | null {
  return getQueueEntry(db, queueId);
}

export function countQueuedReppoJobs(
  db: AgentFicoDb,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const row = db.$client
    .query(
      "SELECT COUNT(*) AS count FROM reppo_queue WHERE account_id = ? AND status = 'queued'",
    )
    .get(accountFingerprint(env)) as { count: number } | null;
  return row?.count ?? 0;
}

export function listQueuedReppoJobIds(
  db: AgentFicoDb,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number[] {
  const rows = db.$client
    .query(
      "SELECT id FROM reppo_queue WHERE account_id = ? AND status = 'queued' ORDER BY created_at, id",
    )
    .all(accountFingerprint(env)) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export function listReppoWorkIds(
  db: AgentFicoDb,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number[] {
  const statuses = ["queued", ...ACTIVE_STATUSES];
  const rows = db.$client
    .query(
      `SELECT id FROM reppo_queue WHERE account_id = ? AND status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at, id`,
    )
    .all(accountFingerprint(env), ...statuses) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}
