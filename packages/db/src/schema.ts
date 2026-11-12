import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    eventId: text("event_id").primaryKey(),
    subjectAfcId: text("subject_afc_id").notNull(),
    source: text("source").notNull(),
    simulated: integer("simulated", { mode: "boolean" }).notNull(),
    attestation: text("attestation").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: text("occurred_at").notNull(),
    evidenceHash: text("evidence_hash"),
    eventJson: text("event_json").notNull(),
  },
  (table) => [
    index("events_subject_time_idx").on(table.subjectAfcId, table.occurredAt),
    index("events_subject_type_idx").on(table.subjectAfcId, table.eventType),
    uniqueIndex("events_subject_type_evidence_unique").on(
      table.subjectAfcId,
      table.eventType,
      table.evidenceHash,
    ),
    check("events_simulated_bool_check", sql`${table.simulated} in (0, 1)`),
  ],
);

export const scores = sqliteTable(
  "scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    afcId: text("afc_id").notNull(),
    score: integer("score"),
    band: text("band"),
    confidence: text("confidence").notNull(),
    status: text("status").notNull(),
    modelVersion: text("model_version").notNull(),
    asOf: text("as_of").notNull(),
    simulatedShare: real("simulated_share").notNull(),
    factorsJson: text("factors_json").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
  },
  (table) => [index("scores_afc_as_of_idx").on(table.afcId, table.asOf)],
);

export const verdicts = sqliteTable(
  "verdicts",
  {
    evalId: text("eval_id").primaryKey(),
    afcId: text("afc_id").notNull(),
    status: text("status").notNull(),
    score: real("score"),
    decision: text("decision"),
    confidence: text("confidence"),
    resultJson: text("result_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("verdicts_afc_status_idx").on(table.afcId, table.status)],
);

export const servCalls = sqliteTable(
  "serv_calls",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    job: integer("job").notNull(),
    afcId: text("afc_id"),
    model: text("model").notNull(),
    featuresJson: text("features_json").notNull(),
    toolsJson: text("tools_json").notNull(),
    responseId: text("response_id"),
    status: text("status").notNull(),
    offline: integer("offline", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms"),
    usageJson: text("usage_json"),
    costJson: text("cost_json"),
    promptGuardJson: text("prompt_guard_json"),
    shadowAgentJson: text("shadow_agent_json"),
    inputSha256: text("input_sha256").notNull(),
    outputSha256: text("output_sha256"),
    outputPreview: text("output_preview"),
  },
  (table) => [
    index("serv_calls_afc_created_idx").on(table.afcId, table.createdAt),
    index("serv_calls_job_created_idx").on(table.job, table.createdAt),
    check("serv_calls_job_range_check", sql`${table.job} between 1 and 7`),
  ],
);

export const reppoQueue = sqliteTable(
  "reppo_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    afcId: text("afc_id").notNull(),
    accountId: text("account_id").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    criteriaJson: text("criteria_json").notNull(),
    contextJson: text("context_json"),
    evalId: text("eval_id"),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextPollAt: text("next_poll_at"),
    lastError: text("last_error"),
    simulated: integer("simulated", { mode: "boolean" })
      .notNull()
      .default(false),
    offline: integer("offline", { mode: "boolean" }).notNull().default(false),
    category: text("category"),
    apiContract: text("api_contract").notNull().default("eval-requests"),
    settlementMinutes: integer("settlement_minutes").notNull().default(15),
    submitStartedAt: text("submit_started_at"),
    settledAt: text("settled_at"),
    resultJson: text("result_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("reppo_queue_status_created_idx").on(table.status, table.createdAt),
    uniqueIndex("reppo_queue_one_active_account_unique")
      .on(table.accountId)
      .where(
        sql`${table.status} in ('submitting', 'pending', 'reconciliation_required', 'blocked')`,
      ),
  ],
);

export const reppoCalls = sqliteTable(
  "reppo_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    queueId: integer("queue_id")
      .notNull()
      .references(() => reppoQueue.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json"),
    httpStatus: integer("http_status"),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("reppo_calls_queue_started_idx").on(table.queueId, table.startedAt),
  ],
);

export const probePlans = sqliteTable("probe_plans", {
  id: text("id")
    .primaryKey()
    .notNull()
    .references(() => servCalls.id),
  afcId: text("afc_id").notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").notNull(),
  readyAt: text("ready_at").notNull(),
  planJson: text("plan_json").notNull(),
  simulated: integer("simulated", { mode: "boolean" }).notNull(),
  queueId: integer("queue_id").references(() => reppoQueue.id),
});

export const schema = {
  probePlans,
  events,
  scores,
  verdicts,
  servCalls,
  reppoQueue,
  reppoCalls,
};
