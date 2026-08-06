import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  accumulateTokenUsage,
  parseDirectJson,
  resolveDeepSeekThinkingConfig,
  resolveStructuredToolMode,
  resolveMaxToolRounds,
  shouldEnableProviderReasoning,
  shouldForceEvidenceAcquisition,
} from "@/skills/model_client/deepseek_client";

describe("DeepSeek structured-output recovery", () => {
  const schema = z.object({ decision: z.enum(["supported", "indeterminate"]), evidence_ids: z.array(z.string()) });

  it("uses test-friendly tool-round defaults and option/env overrides", () => {
    const prev = {
      MODEL_TOOL_ROUNDS: process.env.MODEL_TOOL_ROUNDS,
      MODEL_TOOL_ROUNDS_WEB: process.env.MODEL_TOOL_ROUNDS_WEB,
      MODEL_MAX_TOOL_ROUNDS: process.env.MODEL_MAX_TOOL_ROUNDS,
    };
    try {
      delete process.env.MODEL_TOOL_ROUNDS;
      delete process.env.MODEL_TOOL_ROUNDS_WEB;
      delete process.env.MODEL_MAX_TOOL_ROUNDS;
      expect(resolveMaxToolRounds({})).toBe(6);
      expect(resolveMaxToolRounds({ webSearch: true })).toBe(8);
      expect(resolveMaxToolRounds({ maxToolRounds: 4 })).toBe(4);
      process.env.MODEL_TOOL_ROUNDS = "20";
      process.env.MODEL_TOOL_ROUNDS_WEB = "32";
      expect(resolveMaxToolRounds({})).toBe(20);
      expect(resolveMaxToolRounds({ webSearch: true })).toBe(32);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

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

  it("forces one auditable acquisition call before evidence submission", () => {
    expect(shouldForceEvidenceAcquisition({ requireEvidenceAcquisition: true }, [])).toBe(true);
    expect(shouldForceEvidenceAcquisition(
      { requireEvidenceAcquisition: true },
      [{ name: "query_object_set" }],
    )).toBe(true);
    expect(shouldForceEvidenceAcquisition(
      { requireEvidenceAcquisition: true },
      [{ name: "search_public_web" }],
    )).toBe(false);
    expect(shouldForceEvidenceAcquisition(
      { requireEvidenceAcquisition: false },
      [],
    )).toBe(false);
    expect(resolveStructuredToolMode(
      { requireEvidenceAcquisition: true },
      [],
    )).toEqual({ forceAcquisition: true, toolChoice: "auto" });
  });

  it("turns off DeepSeek thinking for tool-first acquisition without changing other rounds", () => {
    expect(shouldEnableProviderReasoning("deepseek", "high", {})).toBe(true);
    expect(shouldEnableProviderReasoning("deepseek", "high", { disableReasoning: true })).toBe(false);
    expect(shouldEnableProviderReasoning("deepseek", null, {})).toBe(false);
    expect(shouldEnableProviderReasoning("openai_compatible", null, { disableReasoning: true })).toBe(false);
    expect(resolveDeepSeekThinkingConfig("deepseek", "high", { disableReasoning: true }))
      .toEqual({ extraBody: { thinking: { type: "disabled" } } });
    expect(resolveDeepSeekThinkingConfig("deepseek", "high", {}))
      .toEqual({ reasoningEffort: "high", extraBody: { thinking: { type: "enabled" } } });
  });

  it("records onProgress-shaped events into heartbeat payloads", async () => {
    const { buildGenerationProgressHeartbeat } = await import("@/runner/generation_progress");
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
