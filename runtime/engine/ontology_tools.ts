import "server-only";
import { createArtifact, getRun, saveInstanceGraph } from "../adapters/db";
import {
  callFunction,
  executeAction,
  proposeAction,
  supportedActions,
} from "./action_executor";
import {
  buildProvisionalProjection,
  loadGraphForRun,
  queryObjectSet,
  summarizeGraph,
  type ObjectSetQuery,
} from "./instance_graph";

export type OntologyToolName = "query_object_set" | "call_function" | "propose_action";

export const ontologyToolDefinitions = [
  {
    type: "function" as const,
    name: "query_object_set",
    description: "按类型、ID 或关系查询当前运行的 business_instance_graph Object Set。",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "对象类型，如 JudgmentUnit / EvidenceClaim / Judgment" },
        ids: { type: "array", items: { type: "string" } },
        relatedTo: { type: "string" },
        relationType: { type: "string" },
        direction: { type: "string", enum: ["out", "in", "both"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "call_function",
    description: "调用本体 Function（只读计算，禁止写图）。常用：AssessEvidenceUsabilityFunction、CalculateConfidence。",
    parameters: {
      type: "object",
      properties: {
        function_id: { type: "string" },
        inputs: { type: "object", additionalProperties: true },
      },
      required: ["function_id", "inputs"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "propose_action",
    description: `提出受 write_scope 约束的 Action 提案，不直接写图。V1 支持：${supportedActions().join(", ")}。高风险写入需后续人工确认执行。`,
    parameters: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
      },
      required: ["action_id", "parameters"],
      additionalProperties: false,
    },
  },
];

export function runOntologyTool(runId: string, name: OntologyToolName, args: Record<string, unknown>) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const { graph, source } = loadGraphForRun(runId, run.package_path);

  if (name === "query_object_set") {
    const query: ObjectSetQuery = {
      type: args.type ? String(args.type) : undefined,
      ids: Array.isArray(args.ids) ? args.ids.map(String) : undefined,
      relatedTo: args.relatedTo ? String(args.relatedTo) : undefined,
      relationType: args.relationType ? String(args.relationType) : undefined,
      direction: args.direction as ObjectSetQuery["direction"],
      limit: typeof args.limit === "number" ? args.limit : 50,
    };
    return { graph_source: source, summary: summarizeGraph(graph), ...queryObjectSet(graph, query) };
  }

  if (name === "call_function") {
    const functionId = String(args.function_id || "");
    const inputs = (args.inputs && typeof args.inputs === "object" ? args.inputs : {}) as Record<string, unknown>;
    return { graph_source: source, result: callFunction(functionId, inputs, graph) };
  }

  if (name === "propose_action") {
    const actionId = String(args.action_id || "");
    const parameters = (args.parameters && typeof args.parameters === "object" ? args.parameters : {}) as Record<
      string,
      unknown
    >;
    const proposal = proposeAction(actionId, parameters, graph);
    createArtifact(runId, "action_audit", {
      status: "needs_review",
      json_content: JSON.stringify({ mode: "propose", proposal }, null, 2),
      markdown_content: `Action 提案 ${proposal.action_id} / ${proposal.proposal_id}`,
    });
    return { graph_source: source, proposal };
  }

  throw new Error(`未知工具 ${name}`);
}

export function executeProposedAction(runId: string, actionId: string, parameters: Record<string, unknown>) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const { graph, source } = loadGraphForRun(runId, run.package_path);
  const execution = executeAction(actionId, parameters, graph);
  if (execution.status === "executed") {
    saveInstanceGraph(
      runId,
      { provisional: false, business_instance_graph: execution.graph, updated_by_action: actionId },
      `action ${actionId} executed`,
    );
  }
  createArtifact(runId, "action_audit", {
    status: execution.status === "executed" ? "approved" : "failed",
    json_content: JSON.stringify({ mode: "execute", source, execution: { ...execution, graph: undefined }, graph_object_count: execution.graph.objects.length }, null, 2),
    markdown_content: execution.status === "executed"
      ? `已执行 ${actionId}，写入对象 ${execution.written_object_ids.join(", ")}`
      : `拒绝 ${actionId}: ${execution.rejected_reason}`,
    approved_at: execution.status === "executed" ? new Date().toISOString() : null,
    error_message: execution.rejected_reason || null,
  });
  return execution;
}

export function ontologyContextForPrompt(runId: string): string {
  const run = getRun(runId);
  if (!run) return "";
  const loaded = loadGraphForRun(runId, run.package_path);
  const provisional = buildProvisionalProjection(runId);
  const lines = [
    `权威图来源: ${loaded.source} (${loaded.authority}${loaded.provisional ? ", provisional" : ""})`,
    loaded.graph.objects.length ? summarizeGraph(loaded.graph) : "权威图为空；确认 stage_02/03/04 后会物化 instance_graph",
  ];
  if (provisional.objects.length && loaded.authority !== "formal") {
    lines.push(`草稿投影(非权威): ${summarizeGraph(provisional)}`);
  }
  if (loaded.graph.objects.length) {
    const ju = queryObjectSet(loaded.graph, { type: "JudgmentUnit", limit: 20 });
    const claims = queryObjectSet(loaded.graph, { type: ["EvidenceClaim", "EvidenceFact", "SourceDocument"], limit: 20 });
    const judgments = queryObjectSet(loaded.graph, { type: "Judgment", limit: 20 });
    lines.push(`JudgmentUnit: ${ju.objects.map((o) => o.id).join(", ") || "(无)"}`);
    lines.push(`证据对象: ${claims.objects.map((o) => o.id).join(", ") || "(无)"}`);
    lines.push(`Judgment: ${judgments.objects.map((o) => o.id).join(", ") || "(无)"}`);
  }
  lines.push(`可用工具: query_object_set / call_function / propose_action；可执行 Action: ${supportedActions().join(", ")}`);
  return lines.join("\n");
}
