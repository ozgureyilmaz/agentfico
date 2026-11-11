import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AgentReport,
  type AgentsResponse,
  type EventResponse,
  getAgents,
  getEvent,
  getMethodology,
  getReport,
  getServLog,
  type Methodology,
  type ServLog,
} from "./api";
import {
  agentPath,
  citationId,
  FACTOR_META,
  type FactorKey,
  formatAgentName,
  formatDateTime,
  formatScore,
  formatShare,
  parseRoute,
  previewEvidence,
  visibleReasonCodes,
} from "./lib";
import {
  AppLink,
  EmptyCard,
  ErrorCard,
  EventCitation,
  EventEvidenceDialog,
  errorMessage,
  FactorRow,
  InlineNotice,
  LoadingCard,
  PageIntro,
  PhoenixReplay,
  ReppoEvidence,
  ScoreGauge,
  ScoreUploadPage,
  ServCallCard,
  SimulatedBadge,
  StatCard,
  scoreTextClass,
  statusLabel,
  TimelineEvent,
} from "./ui";

const NAV_EVENT = "agentfico:navigate";
type AgentSummary = AgentsResponse["agents"][number];
type BehaviorEvent = EventResponse["event"];
type ReasonCode = AgentReport["score"]["reason_codes"][number];

export function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0, behavior: "instant" });
}

function useRoute() {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, []);
  return parseRoute(pathname);
}

export default function App() {
  const route = useRoute();
  const [agentsResponse, setAgentsResponse] = useState<AgentsResponse | null>(
    null,
  );
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);

  const refreshAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      setAgentsResponse(await getAgents());
    } catch (error) {
      setAgentsError(errorMessage(error));
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
    getMethodology()
      .then(setMethodology)
      .catch(() => setMethodology(null));
  }, [refreshAgents]);

  const phoenix = agentsResponse?.agents.find((agent) =>
    /(^|:)phoenix$/i.test(agent.afc_id),
  );
  const pageTitle =
    route.page === "agent"
      ? formatAgentName(route.afcId)
      : route.page === "serv-trace"
        ? "SERV trace"
        : route.page === "score"
          ? "Score your agent"
          : route.page === "phoenix"
            ? "Phoenix replay"
            : route.page === "not-found"
              ? "Page not found"
              : "Agent leaderboard";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <AppLink to="/" className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span className="brand-name">
            AgentFICO<span>TRUST, MADE LEGIBLE</span>
          </span>
        </AppLink>
        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <AppLink
            to="/"
            className={`nav-item ${route.page === "leaderboard" || route.page === "agent" ? "is-active" : ""}`}
          >
            <NavGlyph name="leaderboard" />
            Leaderboard
          </AppLink>
          {phoenix && (
            <AppLink
              to="/phoenix-replay"
              className={`nav-item nav-sub ${route.page === "phoenix" || (route.page === "agent" && route.afcId === phoenix.afc_id) ? "is-active" : ""}`}
            >
              <NavGlyph name="replay" />
              Phoenix replay
            </AppLink>
          )}
          <AppLink
            to="/serv-trace"
            className={`nav-item ${route.page === "serv-trace" ? "is-active" : ""}`}
          >
            <NavGlyph name="trace" />
            SERV trace
          </AppLink>
          <AppLink
            to="/score"
            className={`nav-item ${route.page === "score" ? "is-active" : ""}`}
          >
            <NavGlyph name="score" />
            Score your agent
          </AppLink>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="status-dot" />
          <div>
            <strong>Open methodology</strong>
            <span>
              {methodology?.model_version ?? "Behavior-based scoring"}
            </span>
          </div>
        </div>
        <div className="sidebar-foot">Free to read · MIT core</div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="crumb">
            <span>AGENTFICO</span>
            <span className="crumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-meta">
            <span className="live-mark">
              <span />
              Local data
            </span>
            {agentsResponse && (
              <span className="topbar-date">
                As of {formatDateTime(agentsResponse.as_of)}
              </span>
            )}
          </div>
        </header>
        <div className="page-content">
          {route.page === "leaderboard" && (
            <LeaderboardPage
              response={agentsResponse}
              loading={agentsLoading}
              error={agentsError}
              onRetry={refreshAgents}
            />
          )}
          {route.page === "agent" && (
            <AgentPage afcId={route.afcId} methodology={methodology} />
          )}
          {route.page === "phoenix" && phoenix && (
            <AgentPage afcId={phoenix.afc_id} methodology={methodology} />
          )}
          {route.page === "phoenix" && !phoenix && agentsLoading && (
            <LoadingCard label="Finding the Phoenix replay profile" />
          )}
          {route.page === "phoenix" && !phoenix && !agentsLoading && (
            <EmptyCard
              title="Phoenix replay is not available"
              detail={
                agentsError ??
                "No Phoenix profile is present in the current agent list."
              }
            />
          )}
          {route.page === "serv-trace" && <ServTracePage />}
          {route.page === "score" && <ScoreUploadPage />}
          {route.page === "not-found" && <NotFoundPage />}
        </div>
        <footer className="page-footer">
          <span>
            AgentFICO · A transparent record of observed agent behavior
          </span>
          <AppLink to="/serv-trace">
            Inspect SERV calls <span aria-hidden="true">↗</span>
          </AppLink>
        </footer>
      </main>
    </div>
  );
}

function NavGlyph({
  name,
}: {
  name: "leaderboard" | "replay" | "trace" | "score";
}) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "leaderboard" && (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M8 9h8M8 12.5h8M8 16h5" />
        </>
      )}
      {name === "replay" && <path d="M20 7v5h-5M19 12a7 7 0 1 1-2-5l3 5" />}
      {name === "trace" && <path d="M3 12h4l2-6 4 12 2-6h6" />}
      {name === "score" && <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}

function LeaderboardPage({
  response,
  loading,
  error,
  onRetry,
}: {
  response: AgentsResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const agents = useMemo(
    () =>
      [...(response?.agents ?? [])].sort(
        (a, b) => (b.score ?? -1) - (a.score ?? -1),
      ),
    [response],
  );
  const numericScores = agents.flatMap((agent) =>
    agent.score === null ? [] : [agent.score],
  );
  const average = numericScores.length
    ? Math.round(
        numericScores.reduce((sum, score) => sum + score, 0) /
          numericScores.length,
      )
    : null;
  const simulatedCount = agents.filter(
    (agent) => agent.simulated_share > 0,
  ).length;
  return (
    <>
      <PageIntro
        eyebrow="BEHAVIORAL TRUST INDEX"
        title="A clearer signal for agent trust."
        description="Compare observed reliability, work quality, payment conduct, and integrity in one explainable score."
        actions={
          <AppLink to="/score" className="button button-primary">
            Score your agent <span aria-hidden="true">↗</span>
          </AppLink>
        }
      />
      <div className="stat-grid">
        <StatCard
          label="Agents observed"
          value={loading && !response ? "…" : String(agents.length)}
          detail="Across available event histories"
          icon="◉"
        />
        <StatCard
          label="Average score"
          value={formatScore(average)}
          detail="Numeric scores only"
          icon="◌"
        />
        <StatCard
          label="Simulated profiles"
          value={String(simulatedCount)}
          detail="Clearly marked in every view"
          icon="◇"
        />
        <StatCard
          label="Score range"
          value="300–850"
          detail="Deterministic · afc-0.2"
          icon="↗"
        />
      </div>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">RANKED BY CURRENT SCORE</span>
            <h2>Agent leaderboard</h2>
          </div>
          <div className="section-side-note">
            {response && response.simulated_share > 0 && <SimulatedBadge />}
            {response && <span>{formatDateTime(response.as_of)}</span>}
          </div>
        </div>
        {loading && !response && <LoadingCard label="Loading agent scores" />}
        {!loading && error && <ErrorCard message={error} onRetry={onRetry} />}
        {!loading && !error && agents.length === 0 && (
          <EmptyCard
            title="No agent histories yet"
            detail="When behavior events are available, scored agents will appear here."
          />
        )}
        {agents.length > 0 && (
          <div className="leaderboard-list">
            {agents.map((agent, index) => (
              <AgentRow key={agent.afc_id} agent={agent} rank={index + 1} />
            ))}
          </div>
        )}
      </section>
      <div className="methodology-note">
        <span className="methodology-icon" aria-hidden="true">
          i
        </span>
        <span>
          Scores summarize observed behavior. Each factor and cited event is
          available in the agent report.
        </span>
        <span className="method-version">
          {agents[0]?.model_version ?? "afc-0.2"}
        </span>
      </div>
    </>
  );
}

function AgentRow({ agent, rank }: { agent: AgentSummary; rank: number }) {
  return (
    <AppLink to={agentPath(agent.afc_id)} className="agent-row">
      <span className="rank-number">{String(rank).padStart(2, "0")}</span>
      <span className="agent-avatar" aria-hidden="true">
        {formatAgentName(agent.afc_id).slice(0, 1)}
      </span>
      <span className="agent-row-name">
        <strong>{formatAgentName(agent.afc_id)}</strong>
        <span className="agent-id">{agent.afc_id}</span>
      </span>
      <span className="agent-row-meta">
        {agent.simulated_share > 0 && <SimulatedBadge />}
        <span className={`confidence confidence-${agent.confidence}`}>
          {agent.confidence} confidence
        </span>
      </span>
      <span className="agent-row-updated">
        <span>Last activity</span>
        {formatDateTime(agent.last_event_at)}
      </span>
      <span className="leader-score">
        <strong className={scoreTextClass(agent.score)}>
          {formatScore(agent.score)}
        </strong>
        <span>{agent.band ?? statusLabel(agent.status)}</span>
      </span>
      <span className="row-arrow" aria-hidden="true">
        ↗
      </span>
    </AppLink>
  );
}

function AgentPage({
  afcId,
  methodology,
}: {
  afcId: string;
  methodology: Methodology | null;
}) {
  const [report, setReport] = useState<AgentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [servLog, setServLog] = useState<ServLog | null>(null);
  const [servError, setServError] = useState<string | null>(null);
  const [eventEvidence, setEventEvidence] = useState<BehaviorEvent | null>(
    null,
  );
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const hasReport = report !== null;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      setReport(await getReport(afcId));
    } catch (reason) {
      setReport(null);
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [afcId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!hasReport) return;
    let active = true;
    setServLog(null);
    setServError(null);
    getServLog(afcId)
      .then((result) => {
        if (active) setServLog(result);
      })
      .catch((reason) => {
        if (active) setServError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [afcId, hasReport]);

  const eventsById = useMemo(
    () =>
      new Map((report?.events ?? []).map((event) => [event.event_id, event])),
    [report],
  );
  const openEvent = async (eventId: string) => {
    if (eventsById.has(eventId)) {
      document
        .getElementById(citationId("event", eventId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setEventLoading(true);
    setEventEvidence(null);
    setEventError(null);
    try {
      setEventEvidence((await getEvent(eventId)).event);
    } catch (reason) {
      setEventError(errorMessage(reason));
    } finally {
      setEventLoading(false);
    }
  };

  if (loading)
    return (
      <>
        <PageIntro
          eyebrow="AGENT REPORT"
          title={formatAgentName(afcId)}
          description={afcId}
        />
        <LoadingCard label="Loading score and evidence" />
      </>
    );
  if (!report || error)
    return (
      <>
        <PageIntro
          eyebrow="AGENT REPORT"
          title={formatAgentName(afcId)}
          description={afcId}
        />
        <ErrorCard
          message={error ?? "No report is available."}
          onRetry={reload}
          notFound={error?.toLowerCase().includes("not found")}
        />
      </>
    );

  const score = report.score;
  const calls = (servLog?.calls ?? []).filter((call) =>
    report.serv_call_ids.includes(call.id),
  );
  const reasons = visibleReasonCodes(score.reason_codes);
  return (
    <>
      <div className="backline">
        <AppLink to="/">← Back to leaderboard</AppLink>
        <span className="mono-label">{score.model_version}</span>
      </div>
      <div className="agent-heading-row">
        <PageIntro
          eyebrow="AGENT TRUST REPORT"
          title={formatAgentName(afcId)}
          description={
            <>
              <span className="mono-label">{afcId}</span>
              <span className="heading-dot">·</span>Last observed{" "}
              {formatDateTime(report.history.last_event_at)}
            </>
          }
          compact
        />
        <div className="heading-badges">
          {report.simulated_share > 0 && <SimulatedBadge />}
          <span className={`status-badge status-${score.status}`}>
            {statusLabel(score.status)}
          </span>
        </div>
      </div>
      <section className="score-overview-grid">
        <div className="card score-card">
          <ScoreGauge score={score} />
          <div className="score-card-copy">
            <span className="eyebrow">CURRENT TRUST SCORE</span>
            <h2>{score.band ?? statusLabel(score.status)}</h2>
            <p>
              Calculated from recorded behavior through{" "}
              {formatDateTime(score.as_of)}.
            </p>
            <div className="score-meta-row">
              <span className={`confidence confidence-${score.confidence}`}>
                {score.confidence} confidence
              </span>
              {report.simulated_share > 0 && (
                <span className="muted-small">
                  {formatShare(report.simulated_share)} simulated contribution
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="card quick-facts-card">
          <div className="card-title-row">
            <div>
              <span className="eyebrow">OBSERVATION WINDOW</span>
              <h3>History at a glance</h3>
            </div>
            <span className="small-icon" aria-hidden="true">
              ◷
            </span>
          </div>
          <FactRow
            label="First event"
            value={formatDateTime(report.history.first_event_at)}
          />
          <FactRow
            label="Latest event"
            value={formatDateTime(report.history.last_event_at)}
          />
          <FactRow
            label="Events in report"
            value={String(report.events.length)}
          />
          <FactRow
            label="Reppo evaluations"
            value={String(report.verdicts.length)}
          />
        </div>
      </section>
      <section className="card factor-card section-block">
        <div className="section-heading section-heading-card">
          <div>
            <span className="eyebrow">WHAT MOVES THE SCORE</span>
            <h2>Factor breakdown</h2>
          </div>
          <span className="weight-note">Factor result · model weight</span>
        </div>
        <div className="factor-list">
          {(Object.keys(FACTOR_META) as FactorKey[]).map((key) => (
            <FactorRow
              key={key}
              factor={key}
              value={score.factors[key]}
              weight={methodology?.weights[key] ?? null}
            />
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CITED REASONS</span>
            <h2>Why this score</h2>
          </div>
          <span className="section-side-note">
            Up to 4 negative · 2 positive
          </span>
        </div>
        {!reasons.length ? (
          <EmptyCard
            title="No reason codes returned"
            detail="This report has no scored reason codes for the selected history."
          />
        ) : (
          <div className="reason-grid">
            {(["hurts", "helps"] as const).map((direction) => {
              const items = reasons.filter(
                (reason) => reason.direction === direction,
              );
              return items.length ? (
                <div className="reason-column" key={direction}>
                  <h3 className={`reason-group-title reason-${direction}`}>
                    <span />
                    {direction === "hurts"
                      ? "Factors lowering the score"
                      : "Factors supporting the score"}
                  </h3>
                  {items.map((reason) => (
                    <ReasonCard
                      key={reason.code}
                      reason={reason}
                      onEvent={openEvent}
                    />
                  ))}
                </div>
              ) : null;
            })}
          </div>
        )}
      </section>

      <section className="card memo-card section-block">
        <div className="memo-mark" aria-hidden="true">
          “
        </div>
        <div>
          <span
            className={`eyebrow${report.trust_memo ? " offline-fixture-label" : ""}`}
          >
            {report.trust_memo ? "OFFLINE FIXTURE · TRUST MEMO" : "TRUST MEMO"}
          </span>
          <h2>In plain language</h2>
          <p>
            {report.trust_memo ??
              "A SERV trust memo is not available for this report."}
          </p>
        </div>
        <span className="memo-source">
          {report.trust_memo ? "Fixture-backed text" : "No annotation returned"}
        </span>
      </section>
      {/phoenix$/i.test(afcId) && (
        <PhoenixReplay afcId={afcId} history={report.history} />
      )}
      <section className="section-block" id="reppo-evidence">
        <div className="section-heading">
          <div>
            <span className="eyebrow">INDEPENDENT WORK REVIEW</span>
            <h2>Reppo evidence</h2>
          </div>
          <span className="section-side-note">
            {report.verdicts.length} recorded evaluations
          </span>
        </div>
        <ReppoEvidence report={report} />
      </section>
      <section className="section-block" id="event-history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">OBSERVED ACTIVITY</span>
            <h2>Event timeline</h2>
          </div>
          <span className="section-side-note">
            Latest {report.events.length} events
          </span>
        </div>
        {report.events.length === 0 ? (
          <EmptyCard
            title="No events in this report"
            detail="The report contains no behavior events in its current view."
          />
        ) : (
          <div className="timeline">
            {report.events.map((event) => (
              <TimelineEvent key={event.event_id} event={event} />
            ))}
          </div>
        )}
      </section>
      <section className="section-block" id="agent-serv-trace">
        <div className="section-heading">
          <div>
            <span className="eyebrow">REASONING AUDIT TRAIL</span>
            <h2>SERV trace</h2>
          </div>
          <AppLink to="/serv-trace" className="text-link">
            View global trace <span aria-hidden="true">↗</span>
          </AppLink>
        </div>
        {servError && (
          <InlineNotice
            tone="warning"
            title="SERV trace unavailable"
            detail={servError}
          />
        )}
        {!servLog && !servError && (
          <LoadingCard label="Loading SERV call log" compact />
        )}
        {servLog && calls.length === 0 && (
          <EmptyCard
            title="No linked SERV calls"
            detail="No call IDs from this report were found in the public SERV log."
          />
        )}
        {calls.length > 0 && (
          <div className="serv-call-list">
            {calls.map((call) => (
              <ServCallCard key={call.id} call={call} />
            ))}
          </div>
        )}
      </section>
      <div className="report-honesty-note">
        <span className="status-dot" />
        <span>
          Score numbers come from deterministic scoring. SERV adds explanation
          and review text only.
        </span>
      </div>
      {(eventEvidence || eventError || eventLoading) && (
        <EventEvidenceDialog
          event={eventEvidence}
          error={eventError}
          loading={eventLoading}
          onClose={() => {
            setEventEvidence(null);
            setEventError(null);
          }}
        />
      )}
    </>
  );
}

function ReasonCard({
  reason,
  onEvent,
}: {
  reason: ReasonCode;
  onEvent: (eventId: string) => void;
}) {
  const evidence = previewEvidence(reason.events, reason.eval_ids, 4);
  const remainingCount =
    evidence.remainingEvents.length + evidence.remainingEvals.length;
  return (
    <article className={`reason-card reason-card-${reason.direction}`}>
      <div className="reason-card-top">
        <span className={`reason-code ${reason.direction}`}>{reason.code}</span>
        <span className="reason-arrow" aria-hidden="true">
          {reason.direction === "hurts" ? "↘" : "↗"}
        </span>
      </div>
      <p>{reason.text}</p>
      <div className="citation-row">
        {evidence.visibleEvents.map((eventId) => (
          <EventCitation key={eventId} eventId={eventId} onOpen={onEvent} />
        ))}
        {evidence.visibleEvals.map((evalId) => (
          <a
            key={evalId}
            className="citation-link eval-link"
            href={`#${citationId("eval", evalId)}`}
            title={`Open Reppo evaluation ${evalId}`}
          >
            Reppo · {shortId(evalId)}
          </a>
        ))}
        {remainingCount > 0 && (
          <details className="citation-disclosure">
            <summary>View all evidence ({remainingCount} more)</summary>
            <div className="citation-row">
              {evidence.remainingEvents.map((eventId) => (
                <EventCitation
                  key={eventId}
                  eventId={eventId}
                  onOpen={onEvent}
                />
              ))}
              {evidence.remainingEvals.map((evalId) => (
                <a
                  key={evalId}
                  className="citation-link eval-link"
                  href={`#${citationId("eval", evalId)}`}
                  title={`Open Reppo evaluation ${evalId}`}
                >
                  Reppo · {shortId(evalId)}
                </a>
              ))}
            </div>
          </details>
        )}
        {reason.events.length === 0 && reason.eval_ids.length === 0 && (
          <span className="muted-small">No evidence IDs returned</span>
        )}
      </div>
    </article>
  );
}

function ServTracePage() {
  const [response, setResponse] = useState<ServLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResponse(await getServLog());
    } catch (reason) {
      setError(errorMessage(reason));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const offlineCount =
    response?.calls.filter((call) => call.offline).length ?? 0;
  return (
    <>
      <PageIntro
        eyebrow="TRANSPARENT REASONING LOG"
        title="SERV trace"
        description="A readable record of reasoning calls associated with AgentFICO scores. Model, features, tools, timing, and returned usage are shown as logged."
      />
      <div className="trace-summary">
        <StatCard
          label="Logged calls"
          value={response ? String(response.calls.length) : loading ? "…" : "—"}
          detail="Most recent 50"
          icon="⌁"
        />
        <StatCard
          label="Offline calls"
          value={response ? String(offlineCount) : loading ? "…" : "—"}
          detail="Fixture-backed responses"
          icon="◌"
        />
        <StatCard
          label="Live usage"
          value="As returned"
          detail="Missing fields stay unknown"
          icon="i"
        />
      </div>
      <div className="trace-legend">
        <span className="trace-legend-mark" />
        Calls are listed in recorded order; offline fixture calls are labeled
        individually.
      </div>
      {loading && !response && <LoadingCard label="Loading SERV call log" />}
      {!loading && error && <ErrorCard message={error} onRetry={reload} />}
      {!loading && !error && response?.calls.length === 0 && (
        <EmptyCard
          title="No SERV calls recorded"
          detail="Calls appear here when the service has stored a SERV trace row."
        />
      )}
      {response?.calls.length ? (
        <div className="serv-call-list global-serv-list">
          {response.calls.map((call) => (
            <ServCallCard key={call.id} call={call} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <PageIntro
        eyebrow="NOT FOUND"
        title="This page isn’t here."
        description="Check the address or return to the agent leaderboard."
      />
      <AppLink to="/" className="button button-primary">
        Open leaderboard <span aria-hidden="true">→</span>
      </AppLink>
    </>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function shortId(value: string): string {
  return value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
