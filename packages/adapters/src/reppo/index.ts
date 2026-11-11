import type { AgentFicoDb } from "@agentfico/db";
import { enqueueEvaluation, getReppoQueueStatus, runReppoTick } from "./queue";
import type {
  EnqueueEvaluationInput,
  EnqueueEvaluationResult,
  ReppoOptions,
  ReppoTickResult,
  RunReppoTickOptions,
} from "./types";

export class ReppoAdapter {
  constructor(private readonly db: AgentFicoDb) {}

  enqueue(
    input: EnqueueEvaluationInput,
    options?: ReppoOptions,
  ): EnqueueEvaluationResult {
    return enqueueEvaluation(this.db, input, options);
  }

  tick(options?: RunReppoTickOptions): Promise<ReppoTickResult> {
    return runReppoTick(this.db, options);
  }

  status(queueId: number): ReppoTickResult | null {
    return getReppoQueueStatus(this.db, queueId);
  }
}

export {
  countQueuedReppoJobs,
  enqueueEvaluation,
  getReppoQueueStatus,
  listQueuedReppoJobIds,
  listReppoWorkIds,
  parseStoredReppoEntry,
  reppoInputPayload,
  runReppoTick,
} from "./queue";
export {
  redactReppoRaw,
  safeReppoJson,
  sanitizeReppoText,
  sanitizeReppoValue,
} from "./redaction";
export type {
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
