import { describe, expect, it } from "vitest";
import { evaluateResearchJobBudget, parseResearchJobBudget, summarizeTokenUsage } from "@/engine/research_job_budget";

describe("research job budgets", () => {
  it("normalizes OpenAI and DeepSeek token usage shapes", () => {
    expect(summarizeTokenUsage({ prompt_tokens: 120, completion_tokens: 30 })).toMatchObject({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });
    expect(summarizeTokenUsage({ input_tokens: 80, output_tokens: 20, total_tokens: 100 })).toMatchObject({
      total_tokens: 100,
    });
  });

  it("detects source, token, cost and timeout violations together", () => {
    const job = {
      budget_json: JSON.stringify({
        max_sources: 2,
        max_tokens: 100,
        max_cost_usd: 0.001,
        input_usd_per_million_tokens: 10,
        output_usd_per_million_tokens: 20,
        hard_timeout_ms: 1_000,
      }),
    } as any;
    const result = evaluateResearchJobBudget({
      job,
      artifact: { token_usage: JSON.stringify({ prompt_tokens: 100, completion_tokens: 50 }) },
      totalSourceCount: 3,
      newSourceCount: 2,
      elapsedMs: 1_500,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((item) => item.code)).toEqual([
      "source_limit", "token_limit", "cost_limit", "hard_timeout",
    ]);
  });

  it("uses safe defaults when optional budget fields are absent", () => {
    expect(parseResearchJobBudget({ budget_json: "{}" } as any)).toMatchObject({
      max_sources: null,
      max_tokens: null,
      max_cost_usd: null,
      hard_timeout_ms: 3_600_000,
    });
  });
});
