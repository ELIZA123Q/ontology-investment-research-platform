import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { accumulateTokenUsage, parseDirectJson } from "@/adapters/deepseek";

describe("DeepSeek structured-output recovery", () => {
  const schema = z.object({ decision: z.enum(["supported", "indeterminate"]), evidence_ids: z.array(z.string()) });

  it("accepts a validated plain JSON result and strips a defensive code fence", () => {
    expect(parseDirectJson('{"decision":"supported","evidence_ids":["EV-1"]}', schema))
      .toEqual({ decision: "supported", evidence_ids: ["EV-1"] });
    expect(parseDirectJson('```json\n{"decision":"indeterminate","evidence_ids":[]}\n```', schema))
      .toEqual({ decision: "indeterminate", evidence_ids: [] });
  });

  it("applies an optional repair hook before schema validation", () => {
    const repaired = parseDirectJson(
      '{"decision":"supported","evidence_ids":"EV-1"}',
      schema,
      (value: any) => ({ ...value, evidence_ids: [String(value.evidence_ids)] }),
    );
    expect(repaired).toEqual({ decision: "supported", evidence_ids: ["EV-1"] });
  });

  it("still rejects malformed or contract-breaking fallback output", () => {
    expect(() => parseDirectJson("not-json", schema)).toThrow(/无法解析/);
    expect(() => parseDirectJson('{"decision":"supported","evidence_ids":"EV-1"}', schema)).toThrow();
  });

  it("accumulates usage across model and fallback rounds", () => {
    expect(accumulateTokenUsage(
      { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      { input_tokens: 80, output_tokens: 10, total_tokens: 90 },
    )).toEqual({ prompt_tokens: 180, completion_tokens: 30, total_tokens: 210 });
  });

  it("records onProgress-shaped events into heartbeat payloads", async () => {
    const { buildGenerationProgressHeartbeat } = await import("@/engine/generation_progress");
    const events: Array<{ phase: string; message: string }> = [];
    const onProgress = (event: {
      phase: string;
      round: number;
      max_rounds: number;
      tool_names: string[];
      message: string;
    }) => {
      events.push(event);
      expect(buildGenerationProgressHeartbeat(event as any, "2026-07-21T06:00:00.000Z", Date.parse("2026-07-21T06:00:01.000Z")).in_progress).toBe(true);
    };
    onProgress({ phase: "model_round", round: 1, max_rounds: 20, tool_names: [], message: "等待模型第 1/20 轮" });
    onProgress({
      phase: "tool_call",
      round: 1,
      max_rounds: 20,
      tool_names: ["query_object_set"],
      message: "已调用本体工具 query_object_set",
    });
    expect(events.map((item) => item.phase)).toEqual(["model_round", "tool_call"]);
  });
});
