import type { Artifact, ResearchJob } from "../schemas/types";

export type ParsedResearchJobBudget = {
  max_sources: number | null;
  max_tokens: number | null;
  max_cost_usd: number | null;
  input_usd_per_million_tokens: number | null;
  output_usd_per_million_tokens: number | null;
  hard_timeout_ms: number;
};

export type TokenUsageSummary = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
};

export type BudgetViolation = {
  code: "source_limit" | "token_limit" | "cost_limit" | "hard_timeout";
  message: string;
};

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseResearchJobBudget(job: Pick<ResearchJob, "budget_json">): ParsedResearchJobBudget {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(job.budget_json || "{}"); } catch { raw = {}; }
  return {
    max_sources: finitePositive(raw.max_sources),
    max_tokens: finitePositive(raw.max_tokens),
    max_cost_usd: finitePositive(raw.max_cost_usd),
    input_usd_per_million_tokens: finitePositive(raw.input_usd_per_million_tokens),
    output_usd_per_million_tokens: finitePositive(raw.output_usd_per_million_tokens),
    hard_timeout_ms: finitePositive(raw.hard_timeout_ms) || 3_600_000,
  };
}

export function summarizeTokenUsage(
  tokenUsage: string | Record<string, unknown> | null | undefined,
  budget?: Pick<ParsedResearchJobBudget, "input_usd_per_million_tokens" | "output_usd_per_million_tokens">,
): TokenUsageSummary {
  let usage: Record<string, unknown> = {};
  try { usage = typeof tokenUsage === "string" ? JSON.parse(tokenUsage || "{}") : tokenUsage || {}; } catch { usage = {}; }
  const input = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0);
  const output = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0);
  const explicitTotal = Math.max(0, Number(usage.total_tokens ?? usage.total ?? 0) || 0);
  const total = explicitTotal || input + output;
  const canEstimateCost = Boolean(budget?.input_usd_per_million_tokens && budget?.output_usd_per_million_tokens);
  const estimatedCost = canEstimateCost
    ? input / 1_000_000 * budget!.input_usd_per_million_tokens!
      + output / 1_000_000 * budget!.output_usd_per_million_tokens!
    : null;
  return { input_tokens: input, output_tokens: output, total_tokens: total, estimated_cost_usd: estimatedCost };
}

export function evaluateResearchJobBudget(input: {
  job: Pick<ResearchJob, "budget_json">;
  artifact?: Pick<Artifact, "token_usage">;
  totalSourceCount: number;
  newSourceCount: number;
  elapsedMs: number;
}) {
  const budget = parseResearchJobBudget(input.job);
  const usage = summarizeTokenUsage(input.artifact?.token_usage, budget);
  const violations: BudgetViolation[] = [];
  if (budget.max_sources !== null && input.totalSourceCount > budget.max_sources) {
    violations.push({ code: "source_limit", message: `本研究累计来源 ${input.totalSourceCount} 个，超过上限 ${budget.max_sources} 个` });
  }
  if (budget.max_tokens !== null && usage.total_tokens > budget.max_tokens) {
    violations.push({ code: "token_limit", message: `累计 token ${usage.total_tokens}，超过上限 ${budget.max_tokens}` });
  }
  if (budget.max_cost_usd !== null && usage.estimated_cost_usd !== null && usage.estimated_cost_usd > budget.max_cost_usd) {
    violations.push({ code: "cost_limit", message: `估算调用成本 $${usage.estimated_cost_usd.toFixed(4)}，超过上限 $${budget.max_cost_usd}` });
  }
  if (input.elapsedMs > budget.hard_timeout_ms) {
    violations.push({ code: "hard_timeout", message: `执行 ${input.elapsedMs}ms，超过硬时限 ${budget.hard_timeout_ms}ms` });
  }
  return {
    ok: violations.length === 0,
    budget,
    usage,
    total_source_count: input.totalSourceCount,
    new_source_count: input.newSourceCount,
    elapsed_ms: input.elapsedMs,
    violations,
  };
}

export function budgetViolationMessage(violations: BudgetViolation[]) {
  return `JOB_BUDGET_EXCEEDED: ${violations.map((item) => item.message).join("；")}`;
}
