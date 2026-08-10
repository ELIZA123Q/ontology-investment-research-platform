import { createHash } from "node:crypto";
import type { RuntimeStore } from "@/src/runtime/store";
import type { ModelProvider } from "@/src/providers/model-provider";
import { RESEARCH_NODE_CATALOG } from "@/src/runtime/node-catalog";
import { parsePlannerProposal, type PlannerProposal } from "@/src/runtime/plan-compiler";

export interface PlannerModelAttempt {
  attempted: boolean;
  proposal?: PlannerProposal;
  provider?: string;
  model?: string;
  cached: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
}

const schema = {
  type: "object",
  required: ["intent", "rationale", "nodes", "stopConditions"],
  properties: {
    intent: { enum: ["full_research", "evidence_only", "update_judgment", "compose_only", "clarify"] },
    rationale: { type: "string" },
    nodes: { type: "array", items: { type: "object", required: ["key", "kind", "title", "dependsOn"], properties: {
      key: { type: "string" }, kind: { enum: RESEARCH_NODE_CATALOG.map((node) => node.kind) }, title: { type: "string" },
      dependsOn: { type: "array", items: { type: "string" } }, reason: { type: "string" }, budget: { type: "object" },
    } } },
    parallelGroups: { type: "array", items: { type: "array", items: { type: "string" } } },
    stopConditions: { type: "array", items: { type: "string" } },
  },
} as const;

export async function requestPlannerProposal(store: RuntimeStore, provider: ModelProvider | null, goal: string): Promise<PlannerModelAttempt> {
  if (!provider) return { attempted: true, cached: false, error: "No configured model provider" };
  const input = { goal, nodeCatalog: RESEARCH_NODE_CATALOG.map(({ kind, preconditions, invariants }) => ({ kind, preconditions, invariants })), schema };
  const cacheKey = `planner:${createHash("sha256").update(JSON.stringify({ provider: provider.id, input })).digest("hex")}`;
  const cached = store.getCachedModelResult<{ text: string; model: string; provider: string; usage?: PlannerModelAttempt["usage"] }>(cacheKey);
  if (cached) {
    const proposal = parsePlannerProposal(cached.text);
    return proposal ? { attempted: true, proposal, provider: cached.provider, model: cached.model, usage: cached.usage, cached: true }
      : { attempted: true, provider: cached.provider, model: cached.model, cached: true, error: "Cached planner output is not valid JSON" };
  }
  try {
    const result = await provider.generate({
      system: "You propose a research task graph. Output JSON only. You cannot create node kinds or capabilities. Runtime will enforce evidence capture, dependencies and budget.",
      prompt: JSON.stringify(input),
      responseSchema: schema as unknown as Record<string, unknown>,
      maxOutputTokens: 1600,
    });
    store.cacheModelResult(cacheKey, result.provider, result.model, result);
    const proposal = parsePlannerProposal(result.text);
    return proposal ? { attempted: true, proposal, provider: result.provider, model: result.model, usage: result.usage, cached: false }
      : { attempted: true, provider: result.provider, model: result.model, usage: result.usage, cached: false, error: "Planner output is not valid JSON" };
  } catch (error) {
    return { attempted: true, provider: provider.id, cached: false, error: error instanceof Error ? error.message : String(error) };
  }
}
