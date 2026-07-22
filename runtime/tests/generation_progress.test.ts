import { describe, expect, it } from "vitest";
import {
  buildGenerationProgressHeartbeat,
  formatElapsedMs,
  isGenerationProgressStale,
  parseGenerationProgress,
} from "@/engine/generation_progress";

describe("generation progress heartbeat", () => {
  it("builds and parses an in-progress heartbeat payload", () => {
    const startedAt = "2026-07-21T06:00:00.000Z";
    const nowMs = Date.parse("2026-07-21T06:02:05.000Z");
    const heartbeat = buildGenerationProgressHeartbeat({
      phase: "tool_call",
      round: 4,
      max_rounds: 32,
      tool_names: ["search_public_web", "fetch_public_pages"],
      last_tool: "fetch_public_pages",
      message: "已抓取公开页面正文",
    }, startedAt, nowMs);
    expect(heartbeat).toMatchObject({
      in_progress: true,
      phase: "tool_call",
      round: 4,
      max_rounds: 32,
      last_tool: "fetch_public_pages",
      elapsed_ms: 125_000,
      heartbeat_at: "2026-07-21T06:02:05.000Z",
    });
    expect(parseGenerationProgress(JSON.stringify(heartbeat))).toEqual(heartbeat);
    expect(parseGenerationProgress('{"tool_calls":2}')).toBeNull();
    expect(formatElapsedMs(125_000)).toBe("2 分 5 秒");
  });

  it("marks heartbeats older than three minutes as stale", () => {
    const startedAt = "2026-07-21T06:00:00.000Z";
    const heartbeat = buildGenerationProgressHeartbeat({
      phase: "model_round",
      round: 1,
      max_rounds: 20,
      tool_names: [],
      message: "等待模型第 1/20 轮",
    }, startedAt, Date.parse("2026-07-21T06:00:10.000Z"));
    expect(isGenerationProgressStale(heartbeat, Date.parse("2026-07-21T06:02:00.000Z"))).toBe(false);
    expect(isGenerationProgressStale(heartbeat, Date.parse("2026-07-21T06:03:11.000Z"))).toBe(true);
  });
});
