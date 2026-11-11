import type { AgentFicoDb } from "@agentfico/db";

export interface ReppoSample {
  id: string;
  task: string;
  output: string;
}

export interface EnqueueEvaluationInput {
  afc_id: string;
  samples: ReppoSample[];
  criteria: string[];
  context?: string;
  simulated: boolean;
  category?: string;
}

export type ReppoQueueStatus =
  | "queued"
  | "submitting"
  | "pending"
  | "reconciliation_required"
  | "blocked"
  | "settled"
  | "failed";

export type ReppoApiContract = "evals" | "eval-requests";

export interface EnqueueEvaluationResult {
  queue_id: number;
  afc_id: string;
  status: "queued";
  eval_id: null;
  offline: boolean;
  simulated_share: number;
}

export interface ReppoTickResult {
  status: ReppoQueueStatus | "idle";
  job_id?: number;
  eval_id?: string | null;
  offline: boolean;
  simulated_share: number;
  next_poll_at?: string;
  reason?: string;
}

export interface ReppoOptions {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

export type ReppoFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RunReppoTickOptions extends ReppoOptions {
  fetch?: ReppoFetch;
  fixtureDirectory?: string;
  allowedQueueIds?: readonly number[];
}

export interface ReppoQueueEntry {
  id: number;
  afcId: string;
  accountId: string;
  type: string;
  payloadJson: string;
  criteriaJson: string;
  contextJson: string | null;
  evalId: string | null;
  status: ReppoQueueStatus;
  attempts: number;
  nextPollAt: string | null;
  lastError: string | null;
  simulated: boolean;
  offline: boolean;
  category: string | null;
  apiContract: ReppoApiContract;
  settlementMinutes: number;
  submitStartedAt: string | null;
  settledAt: string | null;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export type { AgentFicoDb };
