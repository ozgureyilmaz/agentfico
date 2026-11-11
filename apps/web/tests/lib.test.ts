import { describe, expect, test } from "bun:test";
import {
  agentPath,
  citationId,
  formatAgentName,
  formatDateTime,
  formatScore,
  formatShare,
  humanizeToolName,
  parseRoute,
  previewEvidence,
  readLegacyReppoCritiques,
  readReppoResult,
  sampleHistoryAsOfPoints,
  tokenUsageLabel,
  visibleReasonCodes,
} from "../src/lib";

describe("dashboard formatting and navigation helpers", () => {
  test("builds readable names and encodes agent IDs in deep links", () => {
    const id = "afc:sim:phoenix-runner";
    expect(formatAgentName(id)).toBe("Phoenix Runner");
    expect(formatAgentName("afc:sim:nova-7")).toBe("Nova-7");
    expect(agentPath(id)).toBe("/agents/afc%3Asim%3Aphoenix-runner");
    expect(parseRoute(agentPath(id))).toEqual({ page: "agent", afcId: id });
  });

  test("rejects malformed encoded routes and resolves the top-level pages", () => {
    expect(parseRoute("/serv-trace")).toEqual({ page: "serv-trace" });
    expect(parseRoute("/score")).toEqual({ page: "score" });
    expect(parseRoute("/phoenix-replay")).toEqual({ page: "phoenix" });
    expect(parseRoute("/agents/%E0%A4%A")).toEqual({ page: "not-found" });
    expect(parseRoute("/missing")).toEqual({ page: "not-found" });
  });

  test("formats missing and numeric score values without inventing data", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(742)).toBe(new Intl.NumberFormat().format(742));
    expect(formatShare(0.256)).toBe("26%");
  });

  test("formats local timestamps with a zone and handles absent timestamps", () => {
    expect(formatDateTime(null)).toBe("Not recorded");
    expect(formatDateTime("not-a-date")).toBe("Unknown time");
    expect(formatDateTime("2026-11-10T12:00:00.000Z", "UTC")).toContain("UTC");
  });

  test("limits displayed reasons to four negative and two positive citations", () => {
    const reasons = [
      ...Array.from({ length: 5 }, (_, index) => ({
        code: `H${index}`,
        direction: "hurts" as const,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        code: `P${index}`,
        direction: "helps" as const,
      })),
    ];
    expect(visibleReasonCodes(reasons).map(({ code }) => code)).toEqual([
      "H0",
      "H1",
      "H2",
      "H3",
      "P0",
      "P1",
    ]);
  });

  test("samples historical scores across the full window, including the first month", () => {
    const firstEventAt = "2026-08-01T00:00:00.000Z";
    const lastEventAt = "2026-10-30T00:00:00.000Z";
    const points = sampleHistoryAsOfPoints(firstEventAt, lastEventAt, 7);

    expect(points).toHaveLength(7);
    expect(points[0]).toBe(firstEventAt);
    expect(points.at(-1)).toBe(lastEventAt);
    expect(points[2]).toBe("2026-08-31T00:00:00.000Z");
    expect(sampleHistoryAsOfPoints(null, lastEventAt)).toEqual([]);
    expect(sampleHistoryAsOfPoints("invalid", lastEventAt)).toEqual([]);
  });

  test("reads current Reppo summary and preserves raw rubric values", () => {
    expect(
      readReppoResult({
        score: 76,
        decision: "revise",
        confidence: "low",
        route: "review",
        reason: "Two criteria need another pass.",
        rubric_scores: {
          safety: 100,
          completeness: 56,
          instruction_adherence: 46,
        },
      }),
    ).toEqual({
      score: 76,
      decision: "revise",
      confidence: "low",
      route: "review",
      reason: "Two criteria need another pass.",
      rubricScores: [
        { criterion: "safety", value: 100 },
        { criterion: "completeness", value: 56 },
        { criterion: "instruction_adherence", value: 46 },
      ],
    });
  });

  test("retains legacy criterion scores on their original ten-point scale", () => {
    expect(
      readLegacyReppoCritiques({
        verdicts: [
          {
            criterion: "accuracy",
            score: 8,
            critique: "One detail was missed.",
          },
        ],
      }),
    ).toEqual([
      { criterion: "accuracy", score: 8, critique: "One detail was missed." },
    ]);
  });

  test("shows only token counts actually returned by the API", () => {
    expect(tokenUsageLabel(null)).toBe("Token usage not returned");
    expect(tokenUsageLabel({ cached: true })).toBe("Token usage not returned");
    expect(
      tokenUsageLabel({
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
      }),
    ).toBe("input 12 · output 8 · total 20");
  });

  test("creates stable citation anchors for evidence links", () => {
    expect(citationId("event", "01JABC:xyz")).toBe("event-01JABC%3Axyz");
  });

  test("previews four actual citations and retains all remaining IDs", () => {
    expect(
      previewEvidence(
        ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"],
        ["eval-1", "eval-2"],
        4,
      ),
    ).toEqual({
      visibleEvents: ["evt-1", "evt-2", "evt-3", "evt-4"],
      remainingEvents: ["evt-5"],
      visibleEvals: [],
      remainingEvals: ["eval-1", "eval-2"],
    });
  });

  test("turns SERV tool identifiers into readable badge labels", () => {
    expect(humanizeToolName("serv_shadow_agent")).toBe("Shadow Agent");
    expect(humanizeToolName("serv_prompt_guard")).toBe("Prompt Guard");
  });
});
