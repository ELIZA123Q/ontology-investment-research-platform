import type { RuntimeStore } from "@/src/runtime/store";
import type { ModelProvider } from "@/src/providers/model-provider";
import { ModelGateway } from "@/src/providers/model-gateway";
import { deriveModelDataPolicy } from "@/src/providers/model-data-policy";
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
    nodes: { type: "array", items: { type: "object", required: ["key", "kind", "title", "dependsOn", "frontierRef"], properties: {
      key: { type: "string" }, kind: { enum: RESEARCH_NODE_CATALOG.map((node) => node.kind) }, title: { type: "string" },
      dependsOn: { type: "array", items: { type: "string" } }, reason: { type: "string" }, budget: { type: "object" },
      frontierRef: { type: "object", required: ["problemGraphId", "compilerBoundary"], properties: {
        problemGraphId: { const: "pending-problem-graph" }, compilerBoundary: { enum: ["scope", "synthesis", "compose", "audit"] },
      } },
    } } },
    parallelGroups: { type: "array", items: { type: "array", items: { type: "string" } } },
    stopConditions: { type: "array", items: { type: "string" } },
  },
} as const;

export async function requestPlannerProposal(store: RuntimeStore, provider: ModelProvider | null, goal: string): Promise<PlannerModelAttempt> {
  if (!provider) return { attempted: true, cached: false, error: "No configured model provider" };
  const input = { goal, nodeCatalog: RESEARCH_NODE_CATALOG.map(({ kind, preconditions, invariants }) => ({ kind, preconditions, invariants })), schema };
  try {
    const result = await new ModelGateway(store, provider).generate({
      operation: "research_planner",
      promptVersion: "research-planner/2.0.0",
      schemaVersion: "planner-proposal/1.0.0",
      system: "You propose a research task graph. Output JSON only. You cannot create node kinds or capabilities. Every node must include frontierRef with problemGraphId=pending-problem-graph and an allowed compilerBoundary; Runtime will rebind it to the materialized Problem Graph. Runtime enforces evidence capture, dependencies and budget.",
      prompt: JSON.stringify(input),
      responseSchema: schema as unknown as Record<string, unknown>,
      schemaName: "research_plan_proposal",
      maxOutputTokens: 1600,
      dataPolicy: deriveModelDataPolicy([]),
      validateResponse: (value) => {
        const parsed = parsePlannerProposal(JSON.stringify(value));
        if (!parsed || parsed.nodes.some((node) => !node.frontierRef?.problemGraphId || !node.frontierRef.compilerBoundary)) throw new Error("Planner response failed the proposal frontier contract");
      },
    });
    const proposal = parsePlannerProposal(result.text);
    return proposal ? { attempted: true, proposal, provider: result.provider, model: result.model, usage: result.usage, cached: result.cached }
      : { attempted: true, provider: result.provider, model: result.model, usage: result.usage, cached: result.cached, error: "Planner output is not valid JSON" };
  } catch (error) {
    return { attempted: true, provider: provider.id, cached: false, error: `Planner output is not valid JSON or provider call failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
