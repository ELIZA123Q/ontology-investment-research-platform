import "server-only";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";
import {
  createActionExecutionRecord,
  createActionProposalRecord,
  createArtifact,
  getActionExecution,
  getActionProposal,
  getRun,
  getWorkItem,
  latestArtifact,
  listSources,
  listActionProposals,
  markActionProposalExecuted,
  saveInstanceGraph,
  updateWorkItem,
  upsertWorkItem,
  withImmediateTransaction,
} from "../../storage/db";
import {
  callFunction,
  executeAction,
  proposeAction,
  supportedActions,
} from "../../05_governance/ontology_changes/action_executor";
import {
  buildProvisionalProjection,
  loadDomainBusinessGraph,
  loadGraphForRun,
  mergeGraphs,
  queryObjectSet,
  summarizeGraph,
  type ObjectSetQuery,
} from "./instance_graph";
import { parseJson, type StoredActionExecution } from "../../schemas/types";
import { ONTOLOGY_MODEL_FILES } from "./catalog_loader";

export const ONTOLOGY_PROMPT_SOURCE_FILES = [
  ...ONTOLOGY_MODEL_FILES.map((file) => `01_semantic/01_ontology/models/${file}`),
  "01_semantic/01_ontology/domains/semiconductor/business_instances.yaml",
] as const;

export function ontologyPromptSourceFiles(): string[] {
  return [...ONTOLOGY_PROMPT_SOURCE_FILES];
}

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
    const domainGraph = loadDomainBusinessGraph();
    const queryGraph = domainGraph ? mergeGraphs(domainGraph, graph) : graph;
    const query: ObjectSetQuery = {
      type: args.type ? String(args.type) : undefined,
      ids: Array.isArray(args.ids) ? args.ids.map(String) : undefined,
      relatedTo: args.relatedTo ? String(args.relatedTo) : undefined,
      relationType: args.relationType ? String(args.relationType) : undefined,
      direction: args.direction as ObjectSetQuery["direction"],
      limit: typeof args.limit === "number" ? args.limit : 50,
    };
    return { graph_source: source, domain_parameters_included: Boolean(domainGraph), summary: summarizeGraph(queryGraph), ...queryObjectSet(queryGraph, query) };
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
    return { graph_source: source, ...createStoredActionProposal(runId, actionId, parameters) };
  }

  throw new Error(`未知工具 ${name}`);
}

export function createStoredActionProposal(runId: string, actionId: string, parameters: Record<string, unknown>) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const { graph, source } = loadGraphForRun(runId, run.package_path);
  const effectiveParameters = actionId === "RegisterSource"
    ? canonicalRegisteredSourceParameters(runId, parameters)
    : parameters;
  const graphArtifact = latestArtifact(runId, "instance_graph", ["approved"]);
  if (!graphArtifact) throw new Error("Action 提案只能基于已确认的正式实例图创建");
  const proposal = proposeAction(actionId, effectiveParameters, graph);
  const expectedGraphVersion = graphArtifact.version;
  const workItem = upsertWorkItem({
    run_id: runId,
    kind: "action_review",
    stage: "instance_graph",
    target_type: "ActionProposal",
    target_id: proposal.proposal_id,
    title: `批准 Action：${proposal.action_id}`,
    priority: "high",
    reason: `Action 将写入 ${proposal.planned_writes.objects.length} 个对象、${proposal.planned_writes.relations.length} 条关系`,
    source_event_id: null,
    artifact_id: graphArtifact?.id || "",
    attempt: expectedGraphVersion,
    payload_json: JSON.stringify({ proposal_id: proposal.proposal_id, expected_graph_version: expectedGraphVersion }),
  });
  const stored = createActionProposalRecord({
    id: proposal.proposal_id,
    run_id: runId,
    action_id: actionId,
    parameters_json: JSON.stringify(effectiveParameters),
    expected_graph_version: expectedGraphVersion,
    proposal_json: JSON.stringify(proposal),
    work_item_id: workItem.id,
  });
  createArtifact(runId, "action_audit", {
    status: "approved",
    json_content: JSON.stringify({ mode: "proposal_created", graph_source: source, proposal, work_item_id: workItem.id, expected_graph_version: expectedGraphVersion }, null, 2),
    markdown_content: `Action 提案 ${proposal.action_id} / ${proposal.proposal_id} 已创建，等待工作项批准`,
    approved_at: new Date().toISOString(),
  });
  return { proposal: stored, proposal_detail: proposal, approval_work_item: workItem };
}

function canonicalRegisteredSourceParameters(runId: string, parameters: Record<string, unknown>) {
  const requestedId = String(parameters.sourceId || "");
  const requestedUrl = String(parameters.url || parameters.locator || "");
  const source = listSources(runId).find((item) => item.id === requestedId
    || item.url === requestedUrl || item.normalized_url === requestedUrl);
  if (!source) throw new Error("RegisterSource 只能提案登记已在本运行 Source Registry 取得的来源");
  if (source.retrieval_status !== "captured" || source.usability_status !== "usable"
    || !source.quote_verified || !/^[a-f0-9]{64}$/.test(source.content_hash || "")) {
    throw new Error(`来源 ${source.id} 未完成正文抓取、原文定位和 hash 核验，不得写入权威图`);
  }
  if (!source.published_at) throw new Error(`来源 ${source.id} 缺少 published_at`);
  return {
    ...parameters,
    sourceId: source.id,
    title: source.title,
    url: source.final_url || source.url,
    locator: source.locator || source.url,
    publisher: source.publisher,
    publishedAt: source.published_at,
    capturedAt: source.captured_at,
    sourceTier: source.source_tier || "S8",
    sourceGroup: source.source_group || source.publisher,
    contentHash: source.content_hash,
    retrievalStatus: source.retrieval_status,
    usabilityStatus: source.usability_status,
    sourceQuote: source.source_quote,
    quoteVerified: true,
  };
}

export function getStoredActionProposals(runId: string) {
  if (!getRun(runId)) throw new Error("研究任务不存在");
  return listActionProposals(runId).map((proposal) => ({
    ...proposal,
    proposal: parseJson(proposal.proposal_json, {}),
    approval_work_item: getWorkItem(proposal.work_item_id) || null,
    execution: getActionExecution(proposal.id) || null,
  }));
}

export function executeApprovedAction(runId: string, proposalId: string, expectedGraphVersion: number): StoredActionExecution {
  return withImmediateTransaction(() => executeApprovedActionTransaction(runId, proposalId, expectedGraphVersion));
}

function executeApprovedActionTransaction(runId: string, proposalId: string, expectedGraphVersion: number): StoredActionExecution {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stored = getActionProposal(proposalId);
  if (!stored || stored.run_id !== runId) throw new Error("Action 提案不存在");
  const duplicate = getActionExecution(proposalId);
  if (duplicate) return duplicate;
  const workItem = getWorkItem(stored.work_item_id);
  if (!workItem || workItem.status !== "approved" || stored.status !== "approved") {
    throw new Error("Action 提案尚未通过人工批准工作项");
  }
  if (!Number.isInteger(expectedGraphVersion)) throw new Error("必须提交 expected_graph_version");
  const currentGraphArtifact = latestArtifact(runId, "instance_graph", ["approved"]);
  const currentGraphVersion = currentGraphArtifact?.version || 0;
  if (expectedGraphVersion !== stored.expected_graph_version || expectedGraphVersion !== currentGraphVersion) {
    throw new Error(`图版本冲突：期望 ${expectedGraphVersion}，当前 ${currentGraphVersion}`);
  }
  const loaded = loadGraphForRun(runId, run.package_path);
  const proposal = parseJson<any>(stored.proposal_json, null);
  if (!proposal?.proposal_id) throw new Error("Action 提案内容损坏");
  const execution = executeAction(stored.action_id, parseJson(stored.parameters_json, {}), loaded.graph, { requireProposal: proposal });
  let graphVersionAfter = currentGraphVersion;
  if (execution.status === "executed") {
    const graphArtifact = saveInstanceGraph(
      runId,
      { provisional: false, business_instance_graph: execution.graph, updated_by_action: stored.action_id, proposal_id: proposalId },
      `action ${stored.action_id} executed from approved proposal ${proposalId}`,
      { preserveActionWorkItemId: workItem.id },
    );
    graphVersionAfter = graphArtifact.version;
  }
  const record = createActionExecutionRecord({
    execution_id: execution.execution_id,
    proposal_id: proposalId,
    run_id: runId,
    action_id: stored.action_id,
    graph_version_before: currentGraphVersion,
    graph_version_after: graphVersionAfter,
    status: execution.status,
    result_json: JSON.stringify({ ...execution, graph: undefined }),
    created_at: new Date().toISOString(),
  });
  markActionProposalExecuted(proposalId, record.execution_id);
  updateWorkItem(workItem.id, { resolution: execution.status });
  createArtifact(runId, "action_audit", {
    status: execution.status === "executed" ? "approved" : "failed",
    json_content: JSON.stringify({ mode: "approved_execute", proposal_id: proposalId, work_item_id: workItem.id, graph_source: loaded.source, graph_version_before: currentGraphVersion, graph_version_after: graphVersionAfter, execution: { ...execution, graph: undefined }, graph_object_count: execution.graph.objects.length }, null, 2),
    markdown_content: execution.status === "executed"
      ? `已执行 ${stored.action_id}，写入对象 ${execution.written_object_ids.join(", ")}`
      : `拒绝 ${stored.action_id}: ${execution.rejected_reason}`,
    approved_at: execution.status === "executed" ? new Date().toISOString() : null,
    error_message: execution.rejected_reason || null,
  });
  return record;
}

/** 从本体 YAML 文件提取精简摘要：对象类型、关系类型、规则。
 *  估算大小约 9-12K chars，覆盖语义结构但不包含完整属性定义。
 *  YAML 结构为 dict（key=类型名, value={metadata, ...}），不是数组。
 */
export function ontologyDefinitionSummary(): string {
  const lines: string[] = ["# 本体定义摘要（对象类型、关系类型、规则）"];

  const modelFiles = [
    { path: ONTOLOGY_PROMPT_SOURCE_FILES[0], label: "语义模型" },
    { path: ONTOLOGY_PROMPT_SOURCE_FILES[1], label: "判断模型" },
    { path: ONTOLOGY_PROMPT_SOURCE_FILES[2], label: "证据模型" },
    { path: ONTOLOGY_PROMPT_SOURCE_FILES[3], label: "状态事件模型" },
    { path: ONTOLOGY_PROMPT_SOURCE_FILES[4], label: "场景模型" },
  ];

  for (const { path, label } of modelFiles) {
    try {
      const fullPath = repositoryPath(path);
      const content = readFileSync(fullPath, "utf8");
      const parsed = YAML.parse(content) as any;
      if (!parsed) continue;

      // 提取对象类型（dict 结构：key=类型名, value={metadata, primary_key, ...}）
      const otEntries = Object.entries(parsed.object_types || {});
      if (otEntries.length) {
        lines.push(`\n## ${label} - 对象类型 (${otEntries.length})`);
        for (const [name, val] of otEntries.slice(0, 20)) {
          const meta = (val as any)?.metadata || {};
          const def = String(meta.definition || meta.description || (val as any)?.definition || "").slice(0, 200);
          const pk = (val as any)?.primary_key || "";
          const labelZh = meta.label_zh || "";
          lines.push(`- ${name}${labelZh ? `(${labelZh})` : ""}: ${def}${pk ? ` [主键:${pk}]` : ""}`);
        }
      }

      // 提取关系类型（dict 结构：key=关系名, value={metadata, source_types, target_types, ...}）
      const rtEntries = Object.entries(parsed.relation_types || {});
      if (rtEntries.length) {
        lines.push(`\n## ${label} - 关系类型 (${rtEntries.length})`);
        for (const [name, val] of rtEntries.slice(0, 20)) {
          const meta = (val as any)?.metadata || {};
          const def = String(meta.definition || (val as any)?.definition || "").slice(0, 150);
          const src = Array.isArray((val as any)?.source_types)
            ? (val as any).source_types.join("|")
            : ((val as any)?.source_type || "?");
          const tgt = Array.isArray((val as any)?.target_types)
            ? (val as any).target_types.join("|")
            : ((val as any)?.target_type || "?");
          lines.push(`- ${name}: ${def} [${src} → ${tgt}]`);
        }
      }

      // 提取规则（dict 结构：key=规则名, value={metadata, rule_class, applies_to, ...}）
      const ruleEntries = Object.entries(parsed.rules || {});
      if (ruleEntries.length) {
        lines.push(`\n## ${label} - 规则 (${ruleEntries.length})`);
        for (const [name, val] of ruleEntries.slice(0, 10)) {
          const meta = (val as any)?.metadata || {};
          const def = String(meta.definition || (val as any)?.definition || "").slice(0, 200);
          const appliesTo = Array.isArray((val as any)?.applies_to)
            ? (val as any).applies_to.join(",")
            : "";
          lines.push(`- ${name}: ${def}${appliesTo ? ` [作用于:${appliesTo}]` : ""}`);
        }
      }
    } catch {
      // 文件可能不存在，跳过
    }
  }

  // 加载半导体扩展
  try {
    const extPath = repositoryPath(ONTOLOGY_PROMPT_SOURCE_FILES[5]);
    const extContent = readFileSync(extPath, "utf8");
    const extParsed = YAML.parse(extContent) as any;
    if (extParsed) {
      const otEntries = Object.entries(extParsed.object_types || {});
      if (otEntries.length) {
        lines.push(`\n## 半导体领域扩展 - 对象类型 (${otEntries.length})`);
        for (const [name, val] of otEntries.slice(0, 10)) {
          const meta = (val as any)?.metadata || {};
          const def = String(meta.definition || (val as any)?.definition || "").slice(0, 200);
          lines.push(`- ${name}: ${def}`);
        }
      }
      const rtEntries = Object.entries(extParsed.relation_types || {});
      if (rtEntries.length) {
        lines.push(`\n## 半导体领域扩展 - 关系类型 (${rtEntries.length})`);
        for (const [name, val] of rtEntries.slice(0, 10)) {
          const meta = (val as any)?.metadata || {};
          const def = String(meta.definition || "").slice(0, 150);
          lines.push(`- ${name}: ${def}`);
        }
      }
    }
  } catch {
    // 跳过
  }

  return lines.join("\n");
}

export function ontologyContextForPrompt(
  runId: string,
  options: { focusNodeIds?: string[]; focusJudgmentUnitIds?: string[] } = {},
): string {
  const run = getRun(runId);
  if (!run) return "";
  const loaded = loadGraphForRun(runId, run.package_path);
  const provisional = buildProvisionalProjection(runId);
  const domainGraph = loadDomainBusinessGraph();
  const focusNodes = new Set((options.focusNodeIds || []).map(String).filter(Boolean));
  const focusUnits = new Set((options.focusJudgmentUnitIds || []).map(String).filter(Boolean));
  const lines = [
    `权威图来源: ${loaded.source} (${loaded.authority}${loaded.provisional ? ", provisional" : ""})`,
    loaded.graph.objects.length ? summarizeGraph(loaded.graph) : "权威图为空；确认 stage_02/03/04 后会物化 instance_graph",
  ];
  if (focusUnits.size || focusNodes.size) {
    lines.push(
      `任务本体切片: JU=[${[...focusUnits].join(", ") || "(无)"}] nodes=[${[...focusNodes].slice(0, 40).join(", ") || "(无)"}]`,
    );
  }
  if (domainGraph) {
    const domainSummary = summarizeGraph(domainGraph, 80);
    // 有任务切片时压缩领域参数图，避免整图噪声
    lines.push(
      focusUnits.size || focusNodes.size
        ? `半导体业务参数图(只读,压缩): ${domainSummary.slice(0, 2_000)}`
        : `半导体业务参数图(只读): ${domainSummary}`,
    );
  }
  if (provisional.objects.length && loaded.authority !== "formal") {
    lines.push(`草稿投影(非权威): ${summarizeGraph(provisional)}`);
  }
  if (loaded.graph.objects.length) {
    const juAll = queryObjectSet(loaded.graph, { type: "JudgmentUnit", limit: 40 });
    const ju = focusUnits.size
      ? { objects: juAll.objects.filter((o) => focusUnits.has(o.id)).slice(0, 20) }
      : { objects: juAll.objects.slice(0, 20) };
    const claims = queryObjectSet(loaded.graph, { type: ["EvidenceClaim", "EvidenceFact", "SourceDocument"], limit: 20 });
    const judgments = queryObjectSet(loaded.graph, { type: "Judgment", limit: 20 });
    const methodApplications = queryObjectSet(loaded.graph, { type: "MethodApplication", limit: 40 });
    lines.push(`JudgmentUnit: ${ju.objects.map((o) => o.id).join(", ") || "(无)"}`);
    lines.push(`证据对象: ${claims.objects.map((o) => o.id).join(", ") || "(无)"}`);
    lines.push(`Judgment: ${judgments.objects.map((o) => o.id).join(", ") || "(无)"}`);
    lines.push(`MethodApplication: ${methodApplications.objects.map((o) => `${o.id}:${o.properties?.status || "unknown"}`).join(", ") || "(无)"}`);
  }
  // A2修复：注入本体定义摘要，让模型理解对象类型语义
  lines.push(ontologyDefinitionSummary());
  lines.push(`可用工具: query_object_set / call_function / propose_action；可执行 Action: ${supportedActions().join(", ")}`);
  return lines.join("\n");
}
