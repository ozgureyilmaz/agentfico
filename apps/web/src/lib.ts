export const FACTOR_META = {
  Q: {
    name: "Work quality",
    short: "Quality",
    description: "Independent review of completed work.",
  },
  P: {
    name: "Payment conduct",
    short: "Payments",
    description: "Payment outcomes and rule compliance.",
  },
  L: {
    name: "Reliability",
    short: "Reliability",
    description: "Completion, uptime, and measured latency.",
  },
  C: {
    name: "Consistency",
    short: "Consistency",
    description: "Stability across behavior and work quality.",
  },
  I: {
    name: "Identity & history",
    short: "Identity",
    description: "Observed history and verified links.",
  },
  F: {
    name: "Integrity",
    short: "Integrity",
    description: "Detected anomaly signals.",
  },
} as const;

export type FactorKey = keyof typeof FACTOR_META;

export function formatAgentName(afcId: string): string {
  const slug = afcId.split(":").at(-1) ?? afcId;
  if (slug.toLowerCase() === "nova-7") return "Nova-7";
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function previewEvidence<TEvent, TEval>(
  events: readonly TEvent[],
  evals: readonly TEval[],
  limit = 4,
) {
  const maximum = Math.max(0, Math.floor(limit));
  const visibleEvents = events.slice(0, maximum);
  const visibleEvals = evals.slice(0, maximum - visibleEvents.length);
  return {
    visibleEvents,
    remainingEvents: events.slice(visibleEvents.length),
    visibleEvals,
    remainingEvals: evals.slice(visibleEvals.length),
  };
}

export function humanizeToolName(name: string): string {
  const readable = name
    .replace(/^serv[_-]/i, "")
    .replace(/[._-]+/g, " ")
    .trim();
  if (!readable) return "Tool";
  return readable.replace(/\b\w+/g, (word) => {
    const lower = word.toLowerCase();
    if (lower === "mcp" || lower === "api") return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

export function formatScore(score: number | null): string {
  return score === null ? "—" : new Intl.NumberFormat().format(score);
}

export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function formatDateTime(
  value: string | null,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

export function citationId(kind: "event" | "eval", value: string): string {
  return `${kind}-${encodeURIComponent(value)}`;
}

export function agentPath(afcId: string): string {
  return `/agents/${encodeURIComponent(afcId)}`;
}

export function parseRoute(
  pathname: string,
):
  | { page: "leaderboard" }
  | { page: "serv-trace" }
  | { page: "score" }
  | { page: "phoenix" }
  | { page: "agent"; afcId: string }
  | { page: "not-found" } {
  if (pathname === "/" || pathname === "") return { page: "leaderboard" };
  if (pathname === "/serv-trace") return { page: "serv-trace" };
  if (pathname === "/score") return { page: "score" };
  if (pathname === "/phoenix-replay") return { page: "phoenix" };
  const match = pathname.match(/^\/agents\/([^/]+)\/?$/);
  if (match) {
    try {
      return { page: "agent", afcId: decodeURIComponent(match[1]) };
    } catch {
      return { page: "not-found" };
    }
  }
  return { page: "not-found" };
}

export function visibleReasonCodes<T extends { direction: "hurts" | "helps" }>(
  reasons: readonly T[],
): T[] {
  return [
    ...reasons.filter((reason) => reason.direction === "hurts").slice(0, 4),
    ...reasons.filter((reason) => reason.direction === "helps").slice(0, 2),
  ];
}

export function sampleHistoryAsOfPoints(
  firstEventAt: string | null,
  lastEventAt: string | null,
  maximum = 7,
): string[] {
  if (!firstEventAt || !lastEventAt) return [];
  const start = Date.parse(firstEventAt);
  const end = Date.parse(lastEventAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return [];

  const count = Math.max(1, Math.floor(maximum));
  if (count === 1 || start === end) return [new Date(start).toISOString()];
  return Array.from({ length: count }, (_, index) =>
    new Date(start + ((end - start) * index) / (count - 1)).toISOString(),
  );
}

export interface ReppoResultSummary {
  score: number | null;
  decision: string | null;
  confidence: string | null;
  route: string | null;
  reason: string | null;
  rubricScores: Array<{ criterion: string; value: number }>;
}

export interface LegacyReppoCritique {
  criterion: string;
  score?: number;
  critique: string;
}

export function readReppoResult(value: unknown): ReppoResultSummary {
  let result = asRecord(value);
  if (result && asRecord(result.result)) result = asRecord(result.result);
  if (!result) {
    return {
      score: null,
      decision: null,
      confidence: null,
      route: null,
      reason: null,
      rubricScores: [],
    };
  }

  const legacyVerdict = asRecord(result.verdict);
  const action = asRecord(result.action);
  const score = firstNumber(result.score, legacyVerdict?.score);
  const decision = firstString(result.decision, legacyVerdict?.decision);
  const confidence = firstString(result.confidence, legacyVerdict?.confidence);
  const route = firstString(result.route, action?.route);
  const reason = typeof result.reason === "string" ? result.reason : null;
  const scores = asRecord(result.rubric_scores);
  const rubricScores = scores
    ? Object.entries(scores).flatMap(([criterion, rawValue]) =>
        typeof rawValue === "number" && Number.isFinite(rawValue)
          ? [{ criterion, value: rawValue }]
          : [],
      )
    : [];

  return { score, decision, confidence, route, reason, rubricScores };
}

export function readLegacyReppoCritiques(
  value: unknown,
): LegacyReppoCritique[] {
  let result = asRecord(value);
  if (result && asRecord(result.result)) result = asRecord(result.result);
  if (!Array.isArray(result?.verdicts)) return [];
  return result.verdicts.flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    return [
      {
        criterion: typeof row.criterion === "string" ? row.criterion : "",
        ...(typeof row.score === "number" && Number.isFinite(row.score)
          ? { score: row.score }
          : {}),
        critique: typeof row.critique === "string" ? row.critique : "",
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNumber(...values: unknown[]): number | null {
  return (
    values.find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    ) ?? null
  );
}

function firstString(...values: unknown[]): string | null {
  return (
    values.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    ) ?? null
  );
}

export function tokenUsageLabel(usage: Record<string, unknown> | null): string {
  if (!usage) return "Token usage not returned";
  type TokenLabel = "input" | "output" | "total";
  const candidates: ReadonlyArray<readonly [TokenLabel, unknown]> = [
    ["input", usage.prompt_tokens ?? usage.input_tokens],
    ["output", usage.completion_tokens ?? usage.output_tokens],
    ["total", usage.total_tokens],
  ];
  const entries: Array<readonly [TokenLabel, number]> = candidates.flatMap(
    ([label, value]) =>
      typeof value === "number" && Number.isFinite(value)
        ? [[label, value]]
        : [],
  );
  if (entries.length === 0) return "Token usage not returned";
  return entries
    .map(
      ([label, value]) => `${label} ${new Intl.NumberFormat().format(value)}`,
    )
    .join(" · ");
}

export function getReasonLabel(direction: "hurts" | "helps"): string {
  return direction === "hurts"
    ? "Factors lowering the score"
    : "Factors supporting the score";
}
