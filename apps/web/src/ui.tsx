import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import logoMarkUrl from "../../../assets/brand/logo-mark.svg?url";
import {
  type AgentReport,
  type AgentScore,
  ApiRequestError,
  type EventResponse,
  getScore,
  type KiteScoreResponse,
  type ScoreLogResponse,
  type ServLog,
  scoreKiteAddress,
  uploadEventLog,
} from "./api";
import {
  citationId,
  FACTOR_META,
  type FactorKey,
  formatAgentName,
  formatDateTime,
  formatScore,
  humanizeToolName,
  readLegacyReppoCritiques,
  readReppoResult,
  sampleHistoryAsOfPoints,
  tokenUsageLabel,
} from "./lib";

type BehaviorEvent = EventResponse["event"];
type ServCall = ServLog["calls"][number];

const NAV_EVENT = "agentfico:navigate";

export function AppLink({
  to,
  children,
  className,
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onClick?.();
        window.history.pushState({}, "", to);
        window.dispatchEvent(new Event(NAV_EVENT));
        window.scrollTo({ top: 0, behavior: "instant" });
      }}
    >
      {children}
    </a>
  );
}

export function BrandEmblem({ className = "" }: { className?: string }) {
  return (
    <img className={className} src={logoMarkUrl} alt="" aria-hidden="true" />
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`page-intro ${compact ? "page-intro-compact" : ""}`}>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <div className="page-description">{description}</div>
      </div>
      {actions && <div className="page-intro-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <div className="card stat-card">
      <div className="stat-card-top">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function SimulatedBadge() {
  return (
    <span className="simulated-badge">
      <span aria-hidden="true">◇</span> SIMULATED DATA
    </span>
  );
}

export function LoadingCard({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`state-card loading-card ${compact ? "is-compact" : ""}`}
      role="status"
    >
      <BrandEmblem className="state-mark loading-mark" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="state-card empty-card">
      <BrandEmblem className="state-mark empty-mark" />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export function ErrorCard({
  message,
  onRetry,
  notFound = false,
}: {
  message: string;
  onRetry: () => void;
  notFound?: boolean;
}) {
  return (
    <div className="state-card error-card" role="alert">
      <span className="error-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>
          {notFound ? "Agent not found" : "Could not load this view"}
        </strong>
        <span>{message}</span>
      </div>
      <button
        className="button button-secondary button-small"
        type="button"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

export function InlineNotice({
  tone,
  title,
  detail,
}: {
  tone: "warning" | "info";
  title: string;
  detail: string;
}) {
  return (
    <div className={`inline-notice notice-${tone}`} role="status">
      <span aria-hidden="true">{tone === "warning" ? "!" : "i"}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function FactorRow({
  factor,
  value,
  weight,
}: {
  factor: FactorKey;
  value: number;
  weight: number | null;
}) {
  const percentage = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="factor-row">
      <div className="factor-label">
        <span className={`factor-icon factor-${factor.toLowerCase()}`}>
          {factor}
        </span>
        <div>
          <strong>{FACTOR_META[factor].name}</strong>
          <span>{FACTOR_META[factor].description}</span>
        </div>
      </div>
      <div className="factor-bar-wrap">
        <div
          className="factor-track"
          role="progressbar"
          aria-label={`${FACTOR_META[factor].name} factor result`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percentage)}
        >
          <span style={{ width: `${percentage}%` }} />
        </div>
      </div>
      <div className="factor-result">
        <strong>{Math.round(percentage)}%</strong>
        <span>factor result</span>
      </div>
      <div className="factor-weight">
        <strong>{weight === null ? "—" : `${weight}%`}</strong>
        <span>weight</span>
      </div>
    </div>
  );
}

export function ScoreGauge({ score }: { score: AgentScore }) {
  const [reading, setReading] = useState(score.score);
  useEffect(() => {
    const value = score.score;
    if (value === null) {
      setReading(null);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    let frame = 0;
    const update = (now: number) => {
      const elapsed = Math.min(1, (now - start) / 600);
      const progress = 1 - (1 - elapsed) ** 3;
      setReading(Math.round(300 + (value - 300) * progress));
      if (elapsed < 1) frame = requestAnimationFrame(update);
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      setReading(value);
    };
    if (reduced.matches) reset();
    else frame = requestAnimationFrame(update);
    reduced.addEventListener("change", reset);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", reset);
    };
  }, [score.score]);
  const arcLength = Math.PI * 80;
  const ratio =
    score.score === null
      ? 0
      : Math.max(0, Math.min(1, (score.score - 300) / 550));
  return (
    <div className={`score-gauge score-gauge-${score.status}`}>
      <svg
        viewBox="0 0 200 125"
        role="img"
        aria-label={`AgentFICO score ${formatScore(score.score)} on a scale from 300 to 850`}
      >
        <path d="M 20 104 A 80 80 0 0 1 180 104" className="gauge-track" />
        <path
          d="M 20 104 A 80 80 0 0 1 180 104"
          className="gauge-value"
          strokeDasharray={arcLength}
          strokeDashoffset={arcLength * (1 - ratio)}
        />
      </svg>
      <div className="gauge-reading" aria-hidden="true">
        <strong>{formatScore(reading)}</strong>
        <span>out of 850</span>
      </div>
      <div className="gauge-ends">
        <span>300</span>
        <span>850</span>
      </div>
    </div>
  );
}

export function EventCitation({
  eventId,
  onOpen,
}: {
  eventId: string;
  onOpen: (eventId: string) => void;
}) {
  return (
    <a
      className="citation-link"
      href={`#${citationId("event", eventId)}`}
      title={`Open event ${eventId}`}
      onClick={(event) => {
        event.preventDefault();
        onOpen(eventId);
      }}
    >
      Event · {shortId(eventId)}
    </a>
  );
}

export function TimelineEvent({ event }: { event: BehaviorEvent }) {
  const evalId = event.evidence?.eval_id;
  return (
    <article className="timeline-item" id={citationId("event", event.event_id)}>
      <div className="timeline-rail">
        <span
          className={`timeline-dot ${event.simulated ? "is-simulated" : ""}`}
        />
      </div>
      <div className="timeline-body">
        <div className="timeline-topline">
          <strong>{humanizeEvent(event.type)}</strong>
          <time dateTime={event.occurred_at}>
            {formatDateTime(event.occurred_at)}
          </time>
        </div>
        <div className="timeline-details">
          <span className="event-source">{humanizeEvent(event.source)}</span>
          {event.outcome && (
            <span className={`outcome-chip outcome-${event.outcome}`}>
              {event.outcome}
            </span>
          )}
          {event.amount && (
            <span>
              {event.amount.value} {event.amount.currency}
            </span>
          )}
          {event.counterparty && (
            <span>Counterparty · {event.counterparty.kind}</span>
          )}
          {event.simulated && <SimulatedBadge />}
          {event.source === "reppo" && evalId && (
            <span className="provisional-chip">REAL EVAL</span>
          )}
          {event.source === "kite_chain" &&
            event.attrs?.kite_network === "mainnet" && (
              <span className="provisional-chip">MAINNET</span>
            )}
          {event.source === "kite_chain" &&
            event.attrs?.kite_network === "testnet" && (
              <span className="provisional-chip">TESTNET</span>
            )}
          {evalId && (
            <a
              className="citation-link eval-link"
              href={`#${citationId("eval", evalId)}`}
            >
              Reppo · {shortId(evalId)}
            </a>
          )}
        </div>
        <div className="timeline-event-id">
          Event ID <code>{event.event_id}</code>
        </div>
      </div>
    </article>
  );
}

export function EventEvidenceDialog({
  event,
  error,
  loading,
  onClose,
}: {
  event: BehaviorEvent | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="evidence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">CITED EVENT</span>
            <h2 id="evidence-title">Evidence detail</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close event detail"
          >
            ×
          </button>
        </div>
        {loading && <LoadingCard label="Loading cited event" compact />}
        {error && (
          <InlineNotice
            tone="warning"
            title="Event details unavailable"
            detail={error}
          />
        )}
        {event && <TimelineEvent event={event} />}
      </section>
    </div>
  );
}

export function ReppoEvidence({ report }: { report: AgentReport }) {
  const referenced = report.score.reason_codes.flatMap(
    (reason) => reason.eval_ids,
  );
  const ids = [
    ...new Set([
      ...report.verdicts.map((verdict) => verdict.eval_id),
      ...referenced,
    ]),
  ];
  const verdictById = new Map(
    report.verdicts.map((verdict) => [verdict.eval_id, verdict]),
  );
  if (!ids.length && !report.critique_summary)
    return (
      <EmptyCard
        title="No Reppo evidence returned"
        detail="This report contains no recorded evaluation results."
      />
    );
  return (
    <>
      {report.critique_summary &&
        report.critique_summary.weaknesses.length > 0 && (
          <div className="critique-summary card">
            <span className="eyebrow offline-fixture-label">
              OFFLINE FIXTURE · SERV CRITIQUE SUMMARY
            </span>
            <ul>
              {report.critique_summary.weaknesses.map((weakness) => (
                <li
                  key={`${weakness.critique_ids.join("|")}:${weakness.summary}`}
                >
                  <span>{weakness.summary}</span>
                  <small>{weakness.critique_ids.join(" · ")}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      <div className="eval-list">
        {ids.map((evalId) => {
          const verdict = verdictById.get(evalId);
          const rows = readLegacyReppoCritiques(verdict?.result ?? null);
          const result = readReppoResult(verdict?.result ?? null);
          const overallScore = result.score ?? verdict?.score ?? null;
          const decision = result.decision ?? verdict?.decision;
          const confidence = result.confidence ?? verdict?.confidence;
          const hasRecordedVerdict =
            verdict?.status.toLowerCase() === "settled" &&
            verdict.result !== null;
          return (
            <article
              key={evalId}
              id={citationId("eval", evalId)}
              className="card eval-card"
            >
              <div className="eval-card-head">
                <div>
                  <span className="eyebrow">REPPO EVALUATION</span>
                  {hasRecordedVerdict && (
                    <span className="provenance-note">
                      RECORDED REPPO VERDICT
                    </span>
                  )}
                  <h3>
                    <a
                      className="mono-label eval-link"
                      href={`#${citationId("eval", evalId)}`}
                    >
                      {evalId}
                    </a>
                  </h3>
                </div>
                <div className="eval-score">
                  <strong>{overallScore == null ? "—" : overallScore}</strong>
                  <span>
                    {overallScore == null ? "score not returned" : "out of 100"}
                  </span>
                </div>
              </div>
              {verdict ? (
                <>
                  <div className="eval-meta">
                    <span
                      className={`status-badge status-${verdict.status.toLowerCase()}`}
                    >
                      {verdict.status}
                    </span>
                    {decision && (
                      <span className="decision-chip">{decision}</span>
                    )}
                    {confidence && <span>{confidence} confidence</span>}
                    {result.route && (
                      <span className="decision-chip">
                        Route · {result.route}
                      </span>
                    )}
                    <span>Updated {formatDateTime(verdict.updated_at)}</span>
                  </div>
                  {result.reason && (
                    <div className="reppo-result-reason">
                      <small>Reppo summary</small>
                      <p>{result.reason}</p>
                    </div>
                  )}
                  {result.rubricScores.length > 0 && (
                    <div className="rubric-scores">
                      <span className="eyebrow">RETURNED RUBRIC VALUES</span>
                      <div className="rubric-grid">
                        {result.rubricScores.map(({ criterion, value }) => (
                          <div className="rubric-value" key={criterion}>
                            <span>{criterion}</span>
                            <strong>{String(value)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {rows.length ? (
                    <div className="critique-list">
                      {rows.map((row) => (
                        <div
                          className="critique-item"
                          key={`${row.criterion}:${row.critique}`}
                        >
                          <div>
                            <strong>{row.criterion || "Criterion"}</strong>
                            {typeof row.score === "number" && (
                              <span>{row.score}/10</span>
                            )}
                          </div>
                          {row.critique && <p>{row.critique}</p>}
                        </div>
                      ))}
                    </div>
                  ) : !result.reason && result.rubricScores.length === 0 ? (
                    <p className="muted-copy">
                      The stored evaluation has no criterion-level critique
                      text.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted-copy">
                  This evaluation ID is cited by a reason code, but its result
                  is not included in the report.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

export function PhoenixReplay({
  afcId,
  history,
}: {
  afcId: string;
  history: AgentReport["history"];
}) {
  const asOfPoints = useMemo(
    () =>
      sampleHistoryAsOfPoints(history.first_event_at, history.last_event_at, 7),
    [history.first_event_at, history.last_event_at],
  );
  const [snapshots, setSnapshots] = useState<
    Array<{
      as_of: string;
      score: AgentScore["score"];
      band: AgentScore["band"];
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSnapshots([]);
    setSelectedIndex(Math.max(0, asOfPoints.length - 1));
    if (!asOfPoints.length) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    Promise.all(
      asOfPoints.map(async (asOf) => {
        try {
          const score = await getScore(afcId, asOf);
          return {
            ok: true as const,
            point: { as_of: asOf, score: score.score, band: score.band },
          };
        } catch (reason) {
          return { ok: false as const, message: errorMessage(reason) };
        }
      }),
    ).then((results) => {
      if (!active) return;
      const good = results.flatMap((result) =>
        result.ok ? [result.point] : [],
      );
      setSnapshots(good);
      if (!good.length)
        setError(
          results[0] && !results[0].ok
            ? results[0].message
            : "No historical score points were returned.",
        );
      else if (good.length !== asOfPoints.length)
        setError(
          "Some historical points could not be loaded; the chart shows returned scores only.",
        );
      setSelectedIndex(Math.max(0, good.length - 1));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [afcId, asOfPoints]);
  const chartPoints = useMemo(
    () =>
      snapshots.flatMap((point) =>
        point.score === null
          ? []
          : [
              {
                label: new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(point.as_of)),
                as_of: point.as_of,
                score: point.score,
              },
            ],
      ),
    [snapshots],
  );
  const first = chartPoints[0]?.score;
  const last = chartPoints.at(-1)?.score;
  const change =
    first === undefined || last === undefined ? null : last - first;
  const selected = snapshots[selectedIndex];
  return (
    <section className="card replay-card section-block" id="phoenix-replay">
      <div className="section-heading section-heading-card">
        <div>
          <span className="eyebrow">REPLAY · HISTORICAL SCORE READS</span>
          <h2>Phoenix, through time</h2>
        </div>
        <span className="replay-tag">
          <span aria-hidden="true">↗</span> Simulated recovery
        </span>
      </div>
      <p className="replay-intro">
        Seven evenly spaced snapshots span the first and last observed events.
        Every score is fetched from the API at its displayed <code>as_of</code>
        timestamp.
      </p>
      {loading && (
        <LoadingCard label="Fetching historical score snapshots" compact />
      )}
      {!loading && error && (
        <InlineNotice
          tone="warning"
          title="Replay data is partial"
          detail={error}
        />
      )}
      {!loading && snapshots.length === 0 && !error && (
        <EmptyCard
          title="No replay points available"
          detail="This report does not include a usable first-to-last event window."
        />
      )}
      {snapshots.length > 0 && (
        <>
          <div className="replay-summary-row">
            <div>
              <span className="eyebrow">SELECTED SNAPSHOT</span>
              <strong className="replay-selected-score">
                {formatScore(selected?.score ?? null)}
              </strong>
              <span>
                {selected
                  ? formatDateTime(selected.as_of)
                  : "No snapshot selected"}
              </span>
            </div>
            <div className="replay-change">
              <span className="eyebrow">CHANGE ACROSS FETCHED POINTS</span>
              <strong
                className={
                  change === null
                    ? ""
                    : change > 0
                      ? "positive-number"
                      : change < 0
                        ? "negative-number"
                        : ""
                }
              >
                {change === null ? "—" : `${change > 0 ? "+" : ""}${change}`}
              </strong>
              <span>{chartPoints.length} actual score reads</span>
            </div>
          </div>
          {chartPoints.length > 1 && (
            <div
              className="replay-chart"
              role="img"
              aria-label="Historical scores returned by the score API"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartPoints}
                  margin={{ top: 8, right: 14, bottom: 0, left: -12 }}
                >
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--meta)", fontSize: 11 }}
                  />
                  <YAxis
                    domain={[300, 850]}
                    ticks={[300, 500, 700, 850]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--meta)", fontSize: 11 }}
                    width={42}
                  />
                  <Tooltip
                    labelFormatter={(label) => String(label)}
                    formatter={(value) => [String(value ?? "—"), "Score"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="var(--deep)"
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: "var(--mist)", strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: "var(--deep)" }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <label className="replay-slider-label" htmlFor="phoenix-time-slider">
            <span>First observed event</span>
            <strong>
              {selected ? formatDateTime(selected.as_of) : "Choose a timestamp"}
            </strong>
            <span>Last observed event</span>
          </label>
          <input
            id="phoenix-time-slider"
            className="replay-slider"
            type="range"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            step={1}
            value={Math.min(selectedIndex, Math.max(0, snapshots.length - 1))}
            disabled={loading || snapshots.length < 2}
            onChange={(event) =>
              setSelectedIndex(Number(event.currentTarget.value))
            }
            aria-valuetext={
              selected ? formatDateTime(selected.as_of) : undefined
            }
          />
          <div className="replay-footnote">
            Scores are recalculated from behavior observed by each timestamp.
            This simulated persona replay does not establish real Phoenix
            improvement or Reppo impact.
          </div>
        </>
      )}
    </section>
  );
}

export function ServCallCard({ call }: { call: ServCall }) {
  const tokens = tokenUsageLabel(call.usage);
  return (
    <article className="card serv-call-card">
      <div className="serv-call-marker">
        <span>J{call.job}</span>
      </div>
      <div className="serv-call-main">
        <div className="serv-call-top">
          <div>
            <span className="eyebrow">
              JOB {call.job} · {jobLabel(call.job)}
            </span>
            <h3>{call.model}</h3>
          </div>
          <div className="serv-call-state">
            <span
              className={`status-badge ${call.offline ? "status-offline" : "status-live"}`}
            >
              {call.offline ? "Offline fixture" : call.status}
            </span>
            <span className="raw-status">{call.status}</span>
          </div>
        </div>
        <div className="serv-call-meta">
          <span>
            <small>Recorded</small>
            {formatDateTime(call.created_at)}
          </span>
          <span>
            <small>Latency</small>
            {call.latency_ms === null
              ? "Not reported"
              : `${call.latency_ms.toLocaleString()} ms`}
          </span>
          <span>
            <small>Token usage</small>
            {tokens}
          </span>
          <span>
            <small>Response ID</small>
            {call.response_id ? (
              <code title={call.response_id}>{shortId(call.response_id)}</code>
            ) : (
              "Not returned"
            )}
          </span>
        </div>
        <div className="serv-call-details">
          <div>
            <small>Features</small>
            <div className="feature-tags">
              {call.features.length ? (
                call.features.map((feature) => (
                  <span key={feature} className="feature-tag">
                    {feature}
                  </span>
                ))
              ) : (
                <span className="muted-small">None recorded</span>
              )}
            </div>
          </div>
          <div>
            <small>Tools</small>
            {call.tools.length ? (
              <>
                <div className="tool-badges">
                  {call.tools.map((tool, index) => (
                    <span
                      className="tool-badge"
                      key={toolIdentity(tool, index)}
                    >
                      {humanizeToolName(
                        readToolName(tool) ?? `Tool ${index + 1}`,
                      )}
                    </span>
                  ))}
                </div>
                <details className="tool-disclosure">
                  <summary>Raw declarations &amp; hints</summary>
                  <pre>{JSON.stringify(call.tools, null, 2)}</pre>
                </details>
              </>
            ) : (
              <p>No tools recorded</p>
            )}
          </div>
        </div>
        <div className="serv-call-foot">
          <code>{call.id}</code>
          {call.afc_id && (
            <AppLink to={`/agents/${encodeURIComponent(call.afc_id)}`}>
              {call.afc_id}
            </AppLink>
          )}
          {call.cost && (
            <span>Cost returned · {safeCompactJson(call.cost)}</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ScoreUploadPage() {
  const readOnly = import.meta.env.VITE_AFC_HOSTED === "1";
  const [file, setFile] = useState<File | null>(null);
  const [save, setSave] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreLogResponse | null>(null);
  const [kiteResult, setKiteResult] = useState<KiteScoreResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const chooseFile = (next: File | null) => {
    setFile(next);
    setResult(null);
    setSubmitError(null);
    setValidationError(next ? validateUploadFile(next) : null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setValidationError("Choose a .jsonl file to score.");
      return;
    }
    const problem = validateUploadFile(file);
    if (problem) {
      setValidationError(problem);
      return;
    }
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);
    try {
      setResult(await uploadEventLog(file, save));
    } catch (reason) {
      setSubmitError(uploadErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <PageIntro
        eyebrow="BRING YOUR OWN DATA"
        title="Score your agent."
        description="Upload a JSONL behavior or assistant log, or look up a Kite address for a provisional score."
      />
      <div className="upload-layout">
        <form className="card upload-card" onSubmit={submit}>
          <div className="upload-card-head">
            <span className="upload-icon" aria-hidden="true">
              ↑
            </span>
            <div>
              <span className="eyebrow">BEHAVIOR EVENT UPLOAD</span>
              <h2>Your evidence, your score</h2>
            </div>
          </div>
          <label
            className={`file-drop ${file ? "has-file" : ""}`}
            htmlFor="event-log-file"
          >
            <input
              id="event-log-file"
              type="file"
              accept=".jsonl,application/json,text/plain,application/x-ndjson"
              onChange={(event) =>
                chooseFile(event.currentTarget.files?.[0] ?? null)
              }
            />
            <span className="file-drop-icon" aria-hidden="true">
              ⇧
            </span>
            <strong>{file ? file.name : "Choose a JSONL file"}</strong>
            <span>
              {file
                ? `${formatBytes(file.size)} · one JSON event per line`
                : "Select a file from your device · max 1 MB"}
            </span>
            <span className="file-browse">Browse files</span>
          </label>
          {validationError && (
            <InlineNotice
              tone="warning"
              title="Check this file"
              detail={validationError}
            />
          )}
          {!readOnly && (
            <label className="save-option">
              <input
                type="checkbox"
                checked={save}
                onChange={(event) => setSave(event.currentTarget.checked)}
              />
              <span>
                <strong>Save events to this local dataset</strong>
                <small>
                  Off by default. Without this, the score is provisional and the
                  events are not stored.
                </small>
              </span>
            </label>
          )}
          <button
            className="button button-primary upload-submit"
            type="submit"
            disabled={!file || Boolean(validationError) || submitting}
          >
            {submitting ? (
              <>
                <span className="button-spinner" /> Scoring event log…
              </>
            ) : (
              "Calculate provisional score"
            )}
            <span aria-hidden="true">→</span>
          </button>
          <p className="upload-privacy">
            {readOnly
              ? "The demo scores uploads without storing their events."
              : "The service stores uploaded events only if you select Save."}
          </p>
          {submitError && (
            <InlineNotice
              tone="warning"
              title="Could not score this log"
              detail={submitError}
            />
          )}
        </form>
        <aside className="upload-side">
          <KiteScoreForm onResult={setKiteResult} />
          <div className="card format-card">
            <span className="eyebrow">EXPECTED FORMAT</span>
            <h3>One event per line</h3>
            <p>
              Use one supported assistant log or BehaviorEvent record per line.
              Include the agent ID and timestamp.
            </p>
            <pre>
              {
                '{"event_id":"…","subject":{"afc_id":"afc:..."},\n "source":"assistant","simulated":false,\n "attestation":"self_reported","type":"task.completed",\n "occurred_at":"2026-11-10T12:00:00.000Z"}'
              }
            </pre>
            <AppLink to="/" className="text-link">
              See scored agent examples <span aria-hidden="true">↗</span>
            </AppLink>
          </div>
          <div className="upload-trust-note">
            <span className="trust-shield" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>Same methodology for everyone</strong>
              <p>
                Uploads use the published deterministic scorer. SERV can explain
                a result but cannot change its number.
              </p>
            </div>
          </div>
        </aside>
      </div>
      {result && <UploadResult result={result} />}
      {kiteResult && <KiteScoreResult result={kiteResult} />}
    </>
  );
}

function KiteScoreForm({
  onResult,
}: {
  onResult: (value: KiteScoreResponse | null) => void;
}) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onResult(null);
    setError(null);
    setLoading(true);
    try {
      onResult(await scoreKiteAddress(address.trim()));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card format-card">
      <h3>Score a Kite address</h3>
      <form className="kite-score-form" onSubmit={submit}>
        <label htmlFor="kite-score-address">Public address</label>
        <input
          id="kite-score-address"
          value={address}
          onChange={(event) => setAddress(event.currentTarget.value)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <button
          className="button button-primary"
          type="submit"
          disabled={loading}
        >
          {loading ? "Reading Kite history…" : "Score Kite address"}
        </button>
      </form>
      {error && (
        <InlineNotice
          tone="warning"
          title="Could not score this address"
          detail={error}
        />
      )}
    </section>
  );
}

function KiteScoreResult({ result }: { result: KiteScoreResponse }) {
  const network = result.events.find(
    (event) => typeof event.attrs?.kite_network === "string",
  )?.attrs?.kite_network;
  return (
    <div className="kite-result section-block" aria-live="polite">
      {network === "mainnet" && (
        <span className="provisional-chip">MAINNET</span>
      )}
      {network === "testnet" && (
        <span className="provisional-chip">TESTNET</span>
      )}
      {result.offline && (
        <span className="provisional-chip">RECORDED FIXTURE</span>
      )}
      {!result.complete && (
        <span className="provisional-chip">PARTIAL COVERAGE</span>
      )}
      <UploadResult
        result={{
          score: result.score,
          saved: false,
          simulated_share: result.simulated_share,
        }}
      />
    </div>
  );
}

export function UploadResult({ result }: { result: ScoreLogResponse }) {
  return (
    <section className="card upload-result section-block" aria-live="polite">
      <div className="upload-result-title">
        <div>
          <span className="eyebrow">SCORE RESULT</span>
          <h2>{formatAgentName(result.score.afc_id)}</h2>
          <span className="mono-label">{result.score.afc_id}</span>
        </div>
        <span className={result.saved ? "saved-chip" : "provisional-chip"}>
          {result.saved ? "Saved to local dataset" : "Provisional · not saved"}
        </span>
      </div>
      <div className="upload-result-body">
        <ScoreGauge score={result.score} />
        <div>
          <span className="eyebrow">AGENTFICO SCORE</span>
          <strong
            className={`upload-score ${scoreTextClass(result.score.score)}`}
          >
            {formatScore(result.score.score)}
          </strong>
          <span>
            {result.score.band ?? statusLabel(result.score.status)} ·{" "}
            {result.score.confidence} confidence
          </span>
          {result.simulated_share > 0 && <SimulatedBadge />}
        </div>
      </div>
      <div className="upload-reasons">
        <span className="eyebrow">TOP SCORE REASONS</span>
        {result.score.reason_codes.slice(0, 6).map((reason) => (
          <div key={`${reason.direction}-${reason.code}`}>
            <span className={`reason-code ${reason.direction}`}>
              {reason.code}
            </span>
            <span>{reason.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}
export function scoreTextClass(score: number | null): string {
  if (score === null) return "score-muted";
  if (score >= 740) return "score-strong";
  if (score < 580) return "score-low";
  return "score-mid";
}
export function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function validateUploadFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".jsonl"))
    return "Choose a file with the .jsonl extension.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > 1_048_576) return "The file exceeds the 1 MB upload limit.";
  const accepted = [
    "application/json",
    "text/plain",
    "application/x-ndjson",
    "application/jsonl",
    "application/octet-stream",
  ];
  if (file.type && !accepted.includes(file.type.toLowerCase()))
    return "This file type is not supported. Choose a JSONL text file.";
  return null;
}

function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return errorMessage(error);
  const messages: Record<string, string> = {
    invalid_jsonl:
      "A non-empty line is not valid JSON. Check the line number and try again.",
    unsupported_log_line:
      "A line is not a supported BehaviorEvent record. Assistant-log mapping is not available in this upload flow yet.",
    empty_upload: "The file contains no behavior events.",
    mixed_subjects: "All events in one upload must belong to the same agent.",
    subject_mismatch:
      "The uploaded events do not match the requested agent ID.",
    upload_too_large: "The file exceeds the 1 MB upload limit.",
  };
  return (error.code && messages[error.code]) || error.message;
}

function safeCompactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "Details unavailable";
  }
}
function shortId(value: string): string {
  return value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
function humanizeEvent(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}
function jobLabel(job: number): string {
  const labels: Record<number, string> = {
    1: "Sampling plan",
    2: "Rubric",
    3: "Critique summary",
    4: "Trust explanation",
    5: "Fraud review",
    6: "Log mapping",
    7: "Work generation",
  };
  return labels[job] ?? "Reasoning task";
}

function readToolName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const fn = isRecord(value.function) ? value.function : null;
  const nestedTool = isRecord(value.tool) ? value.tool : null;
  for (const candidate of [
    fn?.name,
    value.name,
    value.tool_name,
    nestedTool?.name,
    value.type,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function toolIdentity(value: unknown, index: number): string {
  return `${readToolName(value) ?? "unknown"}:${index}`;
}
