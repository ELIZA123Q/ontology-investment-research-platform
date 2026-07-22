import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import {
  emptyGraph,
  type BusinessInstanceGraph,
  type GraphObject,
  type GraphRelation,
} from "./instance_graph";
import { validateRuntimeGraph } from "./graph_contract";
import { ENGINE_VERSION as SEMANTIC_ENGINE_VERSION, REQUIRED_RULES } from "./semantic_execution";

export type ActionTypeDef = {
  id: string;
  name: string;
  description: string;
  target_types: string[];
  parameters: string[];
  /** 审计元数据，不由执行器解释；可执行检查见 assertPreconditions */
  audit_preconditions: string[];
  effects: string[];
  outputs: string[];
  formal_rule_refs: string[];
  method_refs: string[];
  governance_rule_refs: string[];
  runtime_rule_refs: string[];
  function_ref?: string;
  logic_refs: string[];
  write_scope: string[];
  source_file: string;
};

export type FunctionDef = {
  id: string;
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  reads: string[];
  writes: string[];
  deterministic: boolean;
  side_effects: boolean;
  implementation: "real" | "stub";
  source_file: string;
};

export type ActionProposal = {
  proposal_id: string;
  action_id: string;
  status: "proposed";
  parameters: Record<string, unknown>;
  function_result: Record<string, unknown>;
  planned_writes: { objects: GraphObject[]; relations: GraphRelation[] };
  write_scope: string[];
  rationale: string;
  created_at: string;
};

export type ActionExecution = {
  execution_id: string;
  action_id: string;
  status: "executed" | "rejected";
  parameters: Record<string, unknown>;
  function_result: Record<string, unknown>;
  written_object_ids: string[];
  written_relation_ids: string[];
  rejected_reason?: string;
  graph: BusinessInstanceGraph;
  audit: Record<string, unknown>;
};

const operationRegistryFile = "runtime/engine/runtime_operations.yaml";

let cachedActions: Map<string, ActionTypeDef> | null = null;
let cachedFunctions: Map<string, FunctionDef> | null = null;

function loadCatalogs() {
  if (cachedActions && cachedFunctions) return;
  cachedActions = new Map();
  cachedFunctions = new Map();
  const doc = YAML.parse(readFileSync(repositoryPath(operationRegistryFile), "utf8")) || {};
  if (doc.schema_name !== "runtime_operation_registry" || doc.authority !== "runtime") {
    throw new Error("Runtime 操作注册表缺少正确的 schema_name/authority");
  }
  for (const [id, raw] of Object.entries<any>(doc.actions || {})) {
    cachedActions.set(id, {
      id,
      name: raw.name || id,
      description: raw.description || "",
      target_types: raw.target_types || [],
      parameters: raw.parameters || [],
      audit_preconditions: raw.audit_preconditions || raw.preconditions || [],
      effects: raw.effects || [],
      outputs: raw.outputs || [],
      formal_rule_refs: raw.formal_rule_refs || [],
      method_refs: raw.method_refs || [],
      governance_rule_refs: raw.governance_rule_refs || [],
      runtime_rule_refs: raw.runtime_rule_refs || [],
      function_ref: raw.function_ref,
      logic_refs: raw.logic_refs || [],
      write_scope: raw.write_scope || [],
      source_file: operationRegistryFile,
    });
  }
  for (const [id, raw] of Object.entries<any>(doc.functions || {})) {
    const implementation = raw.implementation === "stub" ? "stub" : "real";
    cachedFunctions.set(id, {
      id,
      name: raw.name || id,
      description: raw.description || "",
      inputs: raw.inputs || [],
      outputs: raw.outputs || [],
      reads: raw.reads || [],
      writes: raw.writes || [],
      deterministic: Boolean(raw.deterministic),
      side_effects: Boolean(raw.side_effects),
      implementation,
      source_file: operationRegistryFile,
    });
  }
}

export function listActionTypes(): ActionTypeDef[] {
  loadCatalogs();
  return [...cachedActions!.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getActionType(actionId: string): ActionTypeDef {
  loadCatalogs();
  const action = cachedActions!.get(actionId);
  if (!action) throw new Error(`未知 Action: ${actionId}`);
  return action;
}

export function getFunctionDef(functionId: string): FunctionDef {
  loadCatalogs();
  const fn = cachedFunctions!.get(functionId);
  if (!fn) throw new Error(`未知 Function: ${functionId}`);
  return fn;
}

export function callFunction(
  functionId: string,
  inputs: Record<string, unknown>,
  graph: BusinessInstanceGraph,
): Record<string, unknown> {
  const fn = getFunctionDef(functionId);
  if (fn.writes.length) {
    throw new Error(`Function ${functionId} 声明了 writes，工作台执行器禁止 Function 直接写图`);
  }
  if (fn.implementation === "stub") {
    return {
      status: "unsupported_stub",
      function_id: functionId,
      message: `Function ${functionId} 标记为 stub，不提供可执行实现`,
      available_object_types: [...new Set(graph.objects.map((object) => object.type))],
      inputs,
    };
  }

  if (functionId === "AssessEvidenceUsabilityFunction") {
    return assessEvidenceUsability(inputs, graph);
  }
  if (functionId === "CalculateConfidence") {
    return calculateConfidence(inputs, graph);
  }
  if (functionId === "AssessSourceReliability") {
    const tier = String(inputs.sourceTier || "");
    const tierNumber = Number(/^S([1-8])$/.exec(tier)?.[1] || 8);
    const reliability = tierNumber <= 3 ? "high" : tierNumber <= 6 ? "medium" : "low";
    return {
      reliability,
      reliabilityBasis: {
        sourceTier: tier,
        rule: "S1-S3=high; S4-S6=medium; S7-S8=low",
        traceabilityVerified: inputs.retrievalStatus === "captured"
          && inputs.usabilityStatus === "usable"
          && inputs.quoteVerified === true,
      },
    };
  }
  if (functionId === "ExtractClaims") {
    const statement = String(inputs.statement || inputs.contentRange || "").trim();
    return { claimCandidates: statement ? [statement] : [] };
  }
  if (functionId === "NormalizeClaimValue") {
    return {
      normalizedClaim: {
        claimRef: inputs.claimRef,
        unit: inputs.unit || null,
        businessTime: inputs.businessTime || null,
        semanticRefs: inputs.semanticRefs || [],
      },
    };
  }

  return {
    status: "unsupported_stub",
    function_id: functionId,
    message: `Function ${functionId} 尚未注册可执行实现；仅返回只读摘要`,
    available_object_types: [...new Set(graph.objects.map((object) => object.type))],
    inputs,
  };
}

function assessEvidenceUsability(inputs: Record<string, unknown>, graph: BusinessInstanceGraph) {
  const evidenceRefs = asStringArray(inputs.evidenceRefs);
  const found = evidenceRefs
    .map((id) => graph.objects.find((object) => object.id === id))
    .filter(Boolean) as GraphObject[];
  const missing = evidenceRefs.filter((id) => !found.some((object) => object.id === id));
  const claims = found.flatMap((object) => {
    if (object.type === "EvidenceClaim") return [object];
    return graph.relations
      .filter((relation) => relation.type === "factDerivedFromClaim" && relation.sourceId === object.id)
      .map((relation) => graph.objects.find((item) => item.id === relation.targetId && item.type === "EvidenceClaim"))
      .filter(Boolean) as GraphObject[];
  });
  const untracedEvidence = found
    .filter((object) => object.type === "EvidenceFact"
      && !graph.relations.some((relation) => relation.type === "factDerivedFromClaim" && relation.sourceId === object.id))
    .map((object) => object.id);
  const sources = claims.flatMap((claim) => graph.relations
    .filter((relation) => relation.type === "claimCitesSource" && relation.sourceId === claim.id)
    .map((relation) => graph.objects.find((item) => item.id === relation.targetId && item.type === "SourceDocument"))
    .filter(Boolean) as GraphObject[]);
  const untracedClaims = claims
    .filter((claim) => !graph.relations.some((relation) => relation.type === "claimCitesSource" && relation.sourceId === claim.id))
    .map((claim) => claim.id);
  const verifiedSources = sources.filter((source) => {
    const props = source.properties || {};
    return props.retrieval_status === "captured"
      && props.usability_status === "usable"
      && props.quote_verified === true
      && /^[a-f0-9]{64}$/.test(String(props.content_hash || ""))
      && Boolean(String(props.locator || "").trim())
      && Boolean(String(props.published_at || "").trim());
  });
  const unverifiedSources = sources.filter((source) => !verifiedSources.includes(source)).map((source) => source.id);
  const requestedScope = String(inputs.assessmentScope || "");
  const scopeIsGraphObject = graph.objects.some((object) => object.id === requestedScope && object.type === "ResearchScope");
  const scopeMismatches = scopeIsGraphObject
    ? found.filter((object) => object.type === "EvidenceFact" && object.properties?.scope_ref !== requestedScope).map((object) => object.id)
    : [];
  const sourceGroups = new Set(verifiedSources.map((source) => String(
    source.properties?.source_group || source.properties?.publisher || source.properties?.uri || source.id,
  ).toLowerCase()));
  const highTierGroups = new Set(verifiedSources
    .filter((source) => Number(/^S([1-8])$/.exec(String(source.properties?.source_tier || "S8"))?.[1] || 8) <= 3)
    .map((source) => String(source.properties?.source_group || source.id).toLowerCase()));
  const traceGaps = [...missing, ...untracedEvidence, ...untracedClaims, ...unverifiedSources, ...scopeMismatches];
  const usable = found.length > 0 && claims.length > 0 && sources.length > 0 && traceGaps.length === 0;
  const qualityLevel = !usable ? "insufficient"
    : sourceGroups.size >= 2 && highTierGroups.size >= 1 ? "high"
      : "medium";
  return {
    usability: usable ? "usable" : missing.length ? "partial" : "unusable",
    qualityLevel,
    rationale: usable
      ? `已验证 ${found.length} 条证据对象、${claims.length} 条原始主张和 ${verifiedSources.length} 个来源快照；独立来源组 ${sourceGroups.size} 个`
      : `证据链不完整或来源快照不可复核：${traceGaps.join(", ") || "无有效来源"}`,
    gapRefs: [...new Set(traceGaps)],
    scores: {
      coverage: found.length,
      missing: missing.length,
      claims: claims.length,
      verified_sources: verifiedSources.length,
      independent_source_groups: sourceGroups.size,
      high_tier_source_groups: highTierGroups.size,
      scope_mismatches: scopeMismatches.length,
    },
  };
}

function calculateConfidence(inputs: Record<string, unknown>, graph: BusinessInstanceGraph) {
  const evidenceRefs = asStringArray(inputs.evidenceRefs);
  const signalRefs = asStringArray(inputs.signalRefs);
  const ruleEvaluations = asStringArray(inputs.ruleEvaluationRefs || inputs.ruleEvaluations);
  const facts = evidenceRefs.map((id) => graph.objects.find((object) => object.id === id && object.type === "EvidenceFact")).filter(Boolean) as GraphObject[];
  const sources = facts.flatMap((fact) => {
    const claimIds = graph.relations.filter((relation) => relation.type === "factDerivedFromClaim" && relation.sourceId === fact.id).map((relation) => relation.targetId);
    const sourceIds = graph.relations.filter((relation) => relation.type === "claimCitesSource" && claimIds.includes(relation.sourceId)).map((relation) => relation.targetId);
    return sourceIds.map((id) => graph.objects.find((object) => object.id === id && object.type === "SourceDocument")).filter(Boolean) as GraphObject[];
  });
  const sourceGroups = new Set(sources.map((source) => String(source.properties?.source_group || source.properties?.publisher || source.properties?.uri || source.id).toLowerCase()));
  const directFacts = facts.filter((fact) => fact.properties?.directness === "direct"
    || graph.relations.some((relation) => relation.type === "assessmentEvaluatesFact" && relation.targetId === fact.id
      && graph.objects.find((object) => object.id === relation.sourceId)?.properties?.directness === "direct")).length;
  const rules = ruleEvaluations.map((id) => graph.objects.find((object) => object.id === id && object.type === "RuleEvaluation")).filter(Boolean) as GraphObject[];
  const failedRules = rules.filter((rule) => ["fail", "blocked"].includes(String(rule.properties?.result))).map((rule) => rule.id);
  const contestedRules = rules.filter((rule) => rule.properties?.result === "contested").map((rule) => rule.id);
  const mediatedSignals = signalRefs.filter((signalId) => facts.some((fact) => graph.relations.some((relation) => relation.type === "signalGroundedByFact"
    && relation.sourceId === signalId && relation.targetId === fact.id)));
  let confidence: "low" | "medium" | "high" = "low";
  if (!failedRules.length && !contestedRules.length && sourceGroups.size >= 3 && directFacts >= 2 && mediatedSignals.length === signalRefs.length) confidence = "high";
  else if (!failedRules.length && sourceGroups.size >= 2 && directFacts >= 1 && mediatedSignals.length === signalRefs.length) confidence = "medium";
  return {
    confidence,
    confidenceBasis: {
      evidence_fact_count: facts.length,
      independent_source_groups: [...sourceGroups],
      direct_fact_count: directFacts,
      mediated_signal_count: mediatedSignals.length,
      requested_signal_count: signalRefs.length,
      failed_rule_refs: failedRules,
      contested_rule_refs: contestedRules,
    },
  };
}

export function proposeAction(
  actionId: string,
  parameters: Record<string, unknown>,
  graph: BusinessInstanceGraph,
): ActionProposal {
  const action = getActionType(actionId);
  assertSupportedAction(actionId);
  assertPreconditions(action, parameters, graph);
  const functionResult = action.function_ref
    ? callFunction(action.function_ref, parameters, graph)
    : {};
  const planned = planWrites(action, parameters, functionResult, graph);
  assertWriteScope(action, planned.objects, planned.relations);
  validateRuntimeGraph(applyPlannedWrites(graph, planned.objects, planned.relations));

  return {
    proposal_id: `AP-${hashShort(`${actionId}:${JSON.stringify(parameters)}:${Date.now()}`)}`,
    action_id: actionId,
    status: "proposed",
    parameters,
    function_result: functionResult,
    planned_writes: planned,
    write_scope: action.write_scope,
    rationale: String((functionResult as any).rationale || (functionResult as any).confidenceBasis || action.description),
    created_at: new Date().toISOString(),
  };
}

function applyPlannedWrites(graph: BusinessInstanceGraph, objects: GraphObject[], relations: GraphRelation[]) {
  const next = cloneGraph(graph);
  for (const object of objects) {
    const index = next.objects.findIndex((item) => item.id === object.id);
    if (index >= 0) next.objects[index] = object;
    else next.objects.push(object);
  }
  for (const relation of relations) {
    const index = next.relations.findIndex((item) => item.id === relation.id);
    if (index >= 0) next.relations[index] = relation;
    else next.relations.push(relation);
  }
  return next;
}

export function executeAction(
  actionId: string,
  parameters: Record<string, unknown>,
  graph: BusinessInstanceGraph,
  options: { requireProposal?: ActionProposal } = {},
): ActionExecution {
  const action = getActionType(actionId);
  assertSupportedAction(actionId);

  try {
    assertPreconditions(action, parameters, graph);
    const proposal = options.requireProposal || proposeAction(actionId, parameters, graph);
    if (proposal.action_id !== actionId) throw new Error("提案 Action 与执行 Action 不一致");
    assertWriteScope(action, proposal.planned_writes.objects, proposal.planned_writes.relations);

    const next = cloneGraph(graph);
    const objectIds = new Set(next.objects.map((object) => object.id));
    const relationIds = new Set(next.relations.map((relation) => relation.id));

    for (const object of proposal.planned_writes.objects) {
      if (objectIds.has(object.id)) {
        next.objects = next.objects.map((existing) => (existing.id === object.id ? object : existing));
      } else {
        next.objects.push(object);
        objectIds.add(object.id);
      }
    }
    for (const relation of proposal.planned_writes.relations) {
      if (!objectIds.has(relation.sourceId) || !objectIds.has(relation.targetId)) {
        throw new Error(`关系 ${relation.id} 指向不存在的对象`);
      }
      if (relationIds.has(relation.id)) {
        next.relations = next.relations.map((existing) => (existing.id === relation.id ? relation : existing));
      } else {
        next.relations.push(relation);
        relationIds.add(relation.id);
      }
    }

    validateRuntimeGraph(next);
    const executionId = `AX-${hashShort(`${actionId}:${Date.now()}`)}`;
    return {
      execution_id: executionId,
      action_id: actionId,
      status: "executed",
      parameters,
      function_result: proposal.function_result,
      written_object_ids: proposal.planned_writes.objects.map((object) => object.id),
      written_relation_ids: proposal.planned_writes.relations.map((relation) => relation.id),
      graph: next,
      audit: {
        action_id: actionId,
        function_ref: action.function_ref || null,
        write_scope: action.write_scope,
        audit_preconditions: action.audit_preconditions,
        formal_rule_refs: action.formal_rule_refs,
        method_refs: action.method_refs,
        governance_rule_refs: action.governance_rule_refs,
        runtime_rule_refs: action.runtime_rule_refs,
        logic_refs: action.logic_refs,
        executed_at: new Date().toISOString(),
        proposal_id: proposal.proposal_id,
      },
    };
  } catch (error) {
    return {
      execution_id: `AX-${hashShort(`${actionId}:reject:${Date.now()}`)}`,
      action_id: actionId,
      status: "rejected",
      parameters,
      function_result: {},
      written_object_ids: [],
      written_relation_ids: [],
      rejected_reason: error instanceof Error ? error.message : String(error),
      graph,
      audit: {
        action_id: actionId,
        rejected_at: new Date().toISOString(),
        rejected_reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

const SUPPORTED_ACTIONS = new Set([
  "RegisterSource",
  "ExtractClaim",
  "NormalizeClaim",
  "AssessEvidenceForUse",
  "FormHypothesis",
  "FormJudgment",
  "RecordReasoningTrace",
]);

function assertSupportedAction(actionId: string) {
  if (!SUPPORTED_ACTIONS.has(actionId)) {
    throw new Error(`工作台 V1.3 可执行 Action: ${[...SUPPORTED_ACTIONS].join(", ")}；收到 ${actionId}`);
  }
}

function assertPreconditions(action: ActionTypeDef, parameters: Record<string, unknown>, graph: BusinessInstanceGraph) {
  if (action.id === "RegisterSource") {
    if (!String(parameters.title || "").trim()) throw new Error("RegisterSource 需要 title");
    if (!String(parameters.url || parameters.locator || "").trim()) throw new Error("RegisterSource 需要可定位 URL");
    if (!String(parameters.publishedAt || "").trim()) throw new Error("RegisterSource 需要 publishedAt");
    if (!/^S[1-8]$/.test(String(parameters.sourceTier || ""))) throw new Error("RegisterSource 需要 S1-S8 sourceTier");
    if (parameters.retrievalStatus !== "captured" || parameters.usabilityStatus !== "usable"
      || parameters.quoteVerified !== true || !/^[a-f0-9]{64}$/.test(String(parameters.contentHash || ""))) {
      throw new Error("RegisterSource 仅允许写入已抓取且原文定位验证通过的来源");
    }
  }
  if (action.id === "ExtractClaim") {
    const sourceRef = String(parameters.sourceRef || "").trim();
    if (!sourceRef) throw new Error("ExtractClaim 需要 sourceRef");
    if (!graph.objects.some((object) => object.id === sourceRef && object.type === "SourceDocument")) {
      throw new Error(`来源 ${sourceRef} 未登记为 SourceDocument`);
    }
    if (!String(parameters.locator || "").trim()) throw new Error("ExtractClaim 需要可复核 locator");
    if (!String(parameters.statement || "").trim()) throw new Error("ExtractClaim 需要原文 statement");
    if (!String(parameters.cutoffAt || "").trim()) throw new Error("ExtractClaim 需要 cutoffAt");
  }
  if (action.id === "NormalizeClaim") {
    const claimRef = String(parameters.claimRef || "").trim();
    if (!claimRef) throw new Error("NormalizeClaim 需要 claimRef");
    if (!graph.objects.some((object) => object.id === claimRef && object.type === "EvidenceClaim")) {
      throw new Error(`主张 ${claimRef} 不存在`);
    }
  }
  if (action.id === "AssessEvidenceForUse") {
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    if (!evidenceRefs.length) throw new Error("AssessEvidenceForUse 需要 evidenceRefs");
    if (!graph.objects.length) throw new Error("实例图为空，无法评估证据");
    requireObjects(graph, evidenceRefs, ["EvidenceClaim", "EvidenceFact"], "证据");
    const directness = String(parameters.directness || "");
    if (!["direct", "indirect", "proxy"].includes(directness)) throw new Error("AssessEvidenceForUse 需要 direct/indirect/proxy directness");
  }
  if (action.id === "FormHypothesis") {
    if (!String(parameters.statement || "").trim()) throw new Error("FormHypothesis 需要 statement");
    const variableRef = String(parameters.variableRef || "").trim();
    if (!variableRef) throw new Error("FormHypothesis 需要 variableRef");
    if (!graph.objects.some((object) => object.id === variableRef && object.type === "StateVariable")) {
      throw new Error(`状态变量 ${variableRef} 不在关系图中；请先确认研究结构，或新建时选择预置样例研究对象`);
    }
    if (!String(parameters.falsificationConditions || "").trim() && !asStringArray(parameters.falsificationConditions).length) {
      throw new Error("FormHypothesis 需要 falsificationConditions");
    }
    if (!String(parameters.timeHorizon || "").trim()) throw new Error("FormHypothesis 需要 timeHorizon");
    const unitRef = String(parameters.judgmentUnitRef || "");
    requireObjects(graph, [unitRef], ["JudgmentUnit"], "判断单元");
  }
  if (action.id === "FormJudgment") {
    const statement = String(parameters.statement || "").trim();
    if (!statement) throw new Error("FormJudgment 需要 statement");
    const level = String(parameters.judgmentLevel || "");
    if (!["J0", "J1", "J2", "J3", "J4"].includes(level)) throw new Error("FormJudgment 需要合法 judgmentLevel");
    const indeterminate = level === "J0" && ["blocked", "indeterminate", "contested"].includes(String(parameters.decisionStatus));
    if (level === "J0" && (!indeterminate || !String(parameters.notJudgeableReason || "").trim())) {
      throw new Error("J0 必须标记 blocked/indeterminate/contested 并给出 notJudgeableReason");
    }
    const methodApplicationRefs = asStringArray(parameters.methodApplicationRefs);
    if (!methodApplicationRefs.length) throw new Error("FormJudgment 需要 MethodApplication");
    for (const ref of methodApplicationRefs) {
      const application = graph.objects.find((object) => object.id === ref && object.type === "MethodApplication");
      const status = String(application?.properties?.status || "");
      if (!application || (status !== "executed" && !(indeterminate && ["blocked", "degraded", "rejected"].includes(status)))) {
        throw new Error(`方法应用 ${ref} 不存在或状态不允许形成 ${level}`);
      }
    }
    const hypothesisRefs = asStringArray(parameters.hypothesisRefs);
    const signalRefs = asStringArray(parameters.signalRefs);
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    const ruleEvaluationRefs = asStringArray(parameters.ruleEvaluationRefs);
    const judgmentUnitRef = String(parameters.judgmentUnitRef || "");
    const scopeRef = String(parameters.scopeRef || "");
    requireObjects(graph, hypothesisRefs, ["Hypothesis"], "假设");
    if (signalRefs.length) requireObjects(graph, signalRefs, ["Signal"], "信号");
    if (evidenceRefs.length) requireObjects(graph, evidenceRefs, ["EvidenceFact"], "归一事实");
    requireObjects(graph, ruleEvaluationRefs, ["RuleEvaluation"], "规则评估");
    requireObjects(graph, [judgmentUnitRef], ["JudgmentUnit"], "判断单元");
    requireObjects(graph, [scopeRef], ["ResearchScope"], "研究范围");
    if (!hypothesisRefs.length || !ruleEvaluationRefs.length || (!indeterminate && (!signalRefs.length || !evidenceRefs.length))) {
      throw new Error("FormJudgment 必须绑定假设和确定性规则；非 J0 还必须绑定事实与信号");
    }
    for (const evidenceRef of evidenceRefs) {
      const linkedSignals = graph.relations.filter((relation) => relation.type === "signalGroundedByFact"
        && relation.targetId === evidenceRef && signalRefs.includes(relation.sourceId));
      if (!linkedSignals.length) throw new Error(`事实 ${evidenceRef} 未通过 signalGroundedByFact 进入所选信号`);
    }
    for (const signalRef of signalRefs) {
      if (!graph.relations.some((relation) => relation.type === "signalEvaluatesHypothesis"
        && relation.sourceId === signalRef && hypothesisRefs.includes(relation.targetId))) {
        throw new Error(`信号 ${signalRef} 未评估所选假设`);
      }
    }
    const requiredRules = REQUIRED_RULES;
    const evaluations = ruleEvaluationRefs.map((ref) => graph.objects.find((object) => object.id === ref)!);
    for (const rule of requiredRules) {
      const evaluation = evaluations.find((item) => item.properties?.rule_ref === rule);
      if (!evaluation) throw new Error(`FormJudgment 缺少确定性规则 ${rule}`);
      const result = String(evaluation.properties?.result || "");
      const deterministic = evaluation.properties?.deterministic_result as Record<string, unknown> | undefined;
      if (!deterministic || deterministic.engine_version !== SEMANTIC_ENGINE_VERSION || deterministic.result !== result) {
        throw new Error(`规则 ${rule} 缺少可验证的 Runtime 确定性执行留痕`);
      }
      if (result !== "pass" && !(level === "J0" && result === "contested")) {
        throw new Error(`规则 ${rule} 结果为 ${result}，不允许形成 ${level} 判断`);
      }
    }
    const requestedLevel = Number(level.slice(1));
    const evidenceCeiling = actionEvidenceCeiling(graph, evidenceRefs);
    if (requestedLevel > evidenceCeiling) throw new Error(`证据链只能支持 J${evidenceCeiling}，不得形成 ${level}`);
    if (!String(parameters.cutoffAt || "").trim()) throw new Error("FormJudgment 需要 cutoffAt");
    if (!asStringArray(parameters.invalidationConditions).length) throw new Error("FormJudgment 需要 invalidationConditions");
  }
  if (action.id === "RecordReasoningTrace") {
    const judgmentRef = String(parameters.judgmentRef || "").trim();
    if (!judgmentRef) throw new Error("RecordReasoningTrace 需要 judgmentRef");
    if (!graph.objects.some((object) => object.id === judgmentRef && object.type === "Judgment")) {
      throw new Error(`判断 ${judgmentRef} 不存在`);
    }
    const nodeRefs = asStringArray(parameters.inputRefs);
    requireObjects(graph, nodeRefs, ["ResearchScope", "JudgmentUnit", "Observation", "StateSnapshot", "StateChange", "Event", "EvidenceFact", "EvidenceAssessment", "EvidenceBasket", "Signal", "Hypothesis", "CompetingExplanation", "BlockingFactor", "RuleEvaluation"], "推理节点");
    if (!nodeRefs.some((id) => graph.objects.find((object) => object.id === id)?.type === "RuleEvaluation")) {
      throw new Error("RecordReasoningTrace 至少包含一个 RuleEvaluation 节点");
    }
    const methodRefs = asStringArray(parameters.methodApplicationRefs);
    requireObjects(graph, methodRefs, ["MethodApplication"], "方法应用");
    for (const ref of methodRefs) {
      if (!graph.relations.some((relation) => relation.type === "runtimeJudgmentUsesMethodApplication"
        && relation.sourceId === judgmentRef && relation.targetId === ref)) {
        throw new Error(`方法应用 ${ref} 未与判断 ${judgmentRef} 绑定`);
      }
    }
    const judgment = graph.objects.find((object) => object.id === judgmentRef)!;
    const requiredHypotheses = graph.relations
      .filter((relation) => relation.type === "judgmentBasedOnHypothesis" && relation.sourceId === judgmentRef)
      .map((relation) => relation.targetId);
    const requiredRules = graph.relations
      .filter((relation) => relation.type === "judgmentHasRuleEvaluation" && relation.sourceId === judgmentRef)
      .map((relation) => relation.targetId);
    const requiredMethods = graph.relations
      .filter((relation) => relation.type === "runtimeJudgmentUsesMethodApplication" && relation.sourceId === judgmentRef)
      .map((relation) => relation.targetId);
    const linkedSignals = graph.relations
      .filter((relation) => relation.type === "signalEvaluatesHypothesis" && requiredHypotheses.includes(relation.targetId))
      .map((relation) => relation.sourceId);
    const linkedFacts = graph.relations
      .filter((relation) => relation.type === "signalGroundedByFact" && linkedSignals.includes(relation.sourceId))
      .map((relation) => relation.targetId);
    const required = new Set([...requiredHypotheses, ...requiredRules, ...requiredMethods]);
    if (judgment.properties?.level !== "J0") {
      linkedSignals.forEach((ref) => required.add(ref));
      linkedFacts.forEach((ref) => required.add(ref));
    }
    const declared = new Set([...nodeRefs, ...methodRefs, judgmentRef]);
    const absent = [...required].filter((ref) => !declared.has(ref));
    if (absent.length) throw new Error(`ReasoningTrace 缺少判断依赖节点: ${absent.join(", ")}`);
    if ([...requiredMethods].some((ref) => !methodRefs.includes(ref))) {
      throw new Error("ReasoningTrace 的 methodApplicationRefs 未覆盖判断使用的方法应用");
    }
  }
}

function actionEvidenceCeiling(graph: BusinessInstanceGraph, evidenceRefs: string[]) {
  if (!evidenceRefs.length) return 0;
  const sources = evidenceRefs.flatMap((factId) => {
    const claimIds = graph.relations.filter((relation) => relation.type === "factDerivedFromClaim" && relation.sourceId === factId).map((relation) => relation.targetId);
    return graph.relations.filter((relation) => relation.type === "claimCitesSource" && claimIds.includes(relation.sourceId))
      .map((relation) => graph.objects.find((object) => object.id === relation.targetId && object.type === "SourceDocument"))
      .filter(Boolean) as GraphObject[];
  });
  const group = (source: GraphObject) => String(source.properties?.source_group || source.properties?.publisher || source.properties?.uri || source.id).toLowerCase();
  const tier = (source: GraphObject) => Number(/^S([1-8])$/.exec(String(source.properties?.source_tier || "S8"))?.[1] || 8);
  const groups = new Set(sources.map(group));
  const qualified = new Set(sources.filter((source) => tier(source) <= 6).map(group));
  const high = new Set(sources.filter((source) => tier(source) <= 3).map(group));
  const direct = evidenceRefs.filter((id) => graph.objects.find((object) => object.id === id)?.properties?.directness === "direct").length;
  let ceiling = groups.size ? 1 : 0;
  if (evidenceRefs.length >= 2 && qualified.size >= 2 && direct >= 1) ceiling = 2;
  if (evidenceRefs.length >= 3 && qualified.size >= 3 && high.size >= 1 && direct >= 2) ceiling = 3;
  if (evidenceRefs.length >= 4 && qualified.size >= 4 && high.size >= 2 && direct >= 3) ceiling = 4;
  return ceiling;
}

function requireObjects(graph: BusinessInstanceGraph, refs: string[], types: string[], label: string) {
  if (!refs.length || refs.some((ref) => !ref)) throw new Error(`${label}引用不得为空`);
  for (const ref of refs) {
    const object = graph.objects.find((item) => item.id === ref);
    if (!object || !types.includes(object.type)) throw new Error(`${label} ${ref} 不存在或类型不符`);
  }
}

function planWrites(
  action: ActionTypeDef,
  parameters: Record<string, unknown>,
  functionResult: Record<string, unknown>,
  graph: BusinessInstanceGraph,
): { objects: GraphObject[]; relations: GraphRelation[] } {
  if (action.id === "RegisterSource") {
    const sourceId = String(parameters.sourceId || `SD-${hashShort(String(parameters.locator || parameters.url || parameters.title))}`);
    const object: GraphObject = {
      id: sourceId,
      type: "SourceDocument",
      properties: {
        title: String(parameters.title),
        source_tier: String(parameters.sourceTier || "unknown"),
        uri: String(parameters.url || parameters.locator || ""),
        publisher: String(parameters.publisher || ""),
        published_at: String(parameters.publishedAt),
        captured_at: parameters.capturedAt || new Date().toISOString(),
        locator: String(parameters.locator || parameters.url || ""),
        content_hash: String(parameters.contentHash),
        source_group: String(parameters.sourceGroup || parameters.publisher || ""),
        retrieval_status: String(parameters.retrievalStatus),
        usability_status: String(parameters.usabilityStatus),
        source_quote: String(parameters.sourceQuote || ""),
        quote_verified: parameters.quoteVerified === true,
        reliability: functionResult.reliability || "unassessed",
        reliability_basis: functionResult.reliabilityBasis || {},
      },
      projection: { section: "sources", index: graph.objects.filter((o) => o.type === "SourceDocument").length },
    };
    const relations: GraphRelation[] = [];
    const profileId = parameters.sourceProfileId ? String(parameters.sourceProfileId) : "";
    if (profileId && graph.objects.some((o) => o.id === profileId)) {
      relations.push({ id: `REL-${sourceId}-profile`, type: "sourceDocumentUsesProfile", sourceId, targetId: profileId, properties: {} });
    }
    const publisherRef = parameters.publisherRef ? String(parameters.publisherRef) : "";
    if (publisherRef && graph.objects.some((o) => o.id === publisherRef)) {
      relations.push({ id: `REL-${sourceId}-publisher`, type: "sourcePublishedBy", sourceId, targetId: publisherRef, properties: {} });
    }
    return { objects: [object], relations };
  }

  if (action.id === "ExtractClaim") {
    const sourceRef = String(parameters.sourceRef);
    const claimId = String(parameters.claimId || `CL-${hashShort(`${sourceRef}:${parameters.locator || parameters.contentRange || parameters.statement || Date.now()}`)}`);
    const statement = String(parameters.statement || (functionResult as any).claimCandidates?.[0] || parameters.contentRange || "未命名主张");
    return {
      objects: [{
        id: claimId,
        type: "EvidenceClaim",
        properties: {
          claim_id: claimId,
          statement,
          locator: String(parameters.locator || ""),
          extracted_at: String(parameters.extractedAt || new Date().toISOString()),
          cutoff_at: String(parameters.cutoffAt || parameters.extractedAt || new Date().toISOString()),
        },
        projection: { section: "evidence_claims", index: graph.objects.filter((o) => o.type === "EvidenceClaim").length },
      }],
      relations: [{ id: `REL-${claimId}-${sourceRef}`, type: "claimCitesSource", sourceId: claimId, targetId: sourceRef, properties: {} }],
    };
  }

  if (action.id === "NormalizeClaim") {
    const claimRef = String(parameters.claimRef);
    const existing = graph.objects.find((object) => object.id === claimRef)!;
    const semanticRefs = asStringArray(parameters.semanticRefs).filter((ref) => graph.objects.some((o) => o.id === ref));
    return {
      objects: [{
        ...existing,
        properties: {
          ...(existing.properties || {}),
          normalized: true,
          semantic_refs: asStringArray(parameters.semanticRefs),
          unit: String(parameters.unit || ""),
          business_time: String(parameters.businessTime || ""),
          normalization: functionResult.normalizedClaim || functionResult,
        },
      }],
      relations: semanticRefs.map((ref) => ({ id: `REL-${claimRef}-${ref}`, type: "claimAbout", sourceId: claimRef, targetId: ref, properties: {} })),
    };
  }

  if (action.id === "AssessEvidenceForUse") {
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    const judgmentUnitRefs = asStringArray(parameters.judgmentUnitRefs);
    const assessmentId = String(parameters.assessmentId || `EA-${hashShort(evidenceRefs.join("|"))}`);
    const object: GraphObject = {
      id: assessmentId,
      type: "EvidenceAssessment",
      properties: {
        assessment: functionResult.usability === "usable" ? "usable"
          : functionResult.usability === "partial" ? "usable_with_caveat" : "unusable",
        directness: String(parameters.directness),
        limitations: asStringArray(parameters.limitations),
      },
      projection: { section: "evidence_assessments", index: graph.objects.filter((o) => o.type === "EvidenceAssessment").length },
    };
    return {
      objects: [object],
      relations: evidenceRefs.map((evidenceId, index) => ({
        id: `REL-${assessmentId}-${evidenceId}`,
        type: "assessmentEvaluatesFact",
        sourceId: assessmentId,
        targetId: evidenceId,
          properties: { index },
      })),
    };
  }

  if (action.id === "FormHypothesis") {
    const hypothesisId = String(parameters.hypothesisId || `HYP-${hashShort(String(parameters.statement))}`);
    const variableRef = String(parameters.variableRef || "");
    const judgmentUnitRef = String(parameters.judgmentUnitRef || "");
    const object: GraphObject = {
      id: hypothesisId,
      type: "Hypothesis",
      properties: {
        statement: String(parameters.statement),
        time_horizon: String(parameters.timeHorizon || ""),
        falsification_conditions: asStringArray(parameters.falsificationConditions),
        variable_ref: variableRef,
        direction: String(parameters.direction || "unknown"),
      },
      projection: { section: "hypotheses", index: graph.objects.filter((o) => o.type === "Hypothesis").length },
    };
    return { objects: [object], relations: [{
      id: `REL-${judgmentUnitRef}-${hypothesisId}`,
      type: "unitHasHypothesis",
      sourceId: judgmentUnitRef,
      targetId: hypothesisId,
      properties: { role: String(parameters.hypothesisRole || "primary") },
    }] };
  }

  if (action.id === "FormJudgment") {
    const judgmentId = String(parameters.judgmentId || `J-${hashShort(String(parameters.statement))}`);
    const hypothesisRefs = asStringArray(parameters.hypothesisRefs);
    const signalRefs = asStringArray(parameters.signalRefs);
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    const methodApplicationRefs = asStringArray(parameters.methodApplicationRefs);
    const ruleEvaluationRefs = asStringArray(parameters.ruleEvaluationRefs);
    const judgmentUnitRef = String(parameters.judgmentUnitRef || "");
    const object: GraphObject = {
      id: judgmentId,
      type: "Judgment",
      properties: {
        statement: String(parameters.statement),
        level: String(parameters.judgmentLevel),
        confidence: functionResult.confidence || "low",
        decision_status: String(parameters.decisionStatus || "supported"),
        conflict_status: String(parameters.conflictStatus || "none"),
        not_judgeable_reason: parameters.notJudgeableReason ? String(parameters.notJudgeableReason) : null,
        scope_ref: String(parameters.scopeRef),
        cutoff_at: String(parameters.cutoffAt),
        conditions: asStringArray(parameters.conditions),
        invalidation_conditions: asStringArray(parameters.invalidationConditions),
        confidence_basis: functionResult.confidenceBasis || {},
      },
      projection: { section: "judgments", index: graph.objects.filter((o) => o.type === "Judgment").length },
    };
    const relations: GraphRelation[] = [];
    for (const ref of hypothesisRefs) {
      if (!graph.objects.some((object) => object.id === ref)) continue;
      relations.push({ id: `REL-${judgmentId}-${ref}`, type: "judgmentBasedOnHypothesis", sourceId: judgmentId, targetId: ref, properties: {} });
    }
    for (const ref of methodApplicationRefs) {
      relations.push({
        id: `RUNTIME-${judgmentId}-${ref}`,
        type: "runtimeJudgmentUsesMethodApplication",
        sourceId: judgmentId,
        targetId: ref,
        properties: { authority: "public_contract_1.3" },
      });
    }
    for (const ref of ruleEvaluationRefs) {
      relations.push({ id: `REL-${judgmentId}-${ref}`, type: "judgmentHasRuleEvaluation", sourceId: judgmentId, targetId: ref, properties: {} });
    }
    relations.push({ id: `REL-${judgmentId}-${judgmentUnitRef}`, type: "judgmentResolvesUnit", sourceId: judgmentId, targetId: judgmentUnitRef, properties: {} });
    return { objects: [object], relations };
  }

  if (action.id === "RecordReasoningTrace") {
    const judgmentRef = String(parameters.judgmentRef);
    const traceId = String(parameters.traceId || `RT-${hashShort(`${judgmentRef}:${Date.now()}`)}`);
    const nodeRefs = [...new Set([
      ...asStringArray(parameters.inputRefs),
      ...asStringArray(parameters.methodApplicationRefs),
      judgmentRef,
    ])];
    const traceRelationTargetTypes = new Set([
      "ResearchScope", "JudgmentUnit", "Observation", "StateSnapshot", "StateChange", "Event",
      "EvidenceFact", "EvidenceAssessment", "EvidenceBasket", "Signal", "Hypothesis",
      "CompetingExplanation", "BlockingFactor", "RuleEvaluation",
    ]);
    const relationNodeRefs = nodeRefs.filter((ref) => {
      const target = graph.objects.find((object) => object.id === ref);
      return target && traceRelationTargetTypes.has(target.type);
    });
    return {
      objects: [{
        id: traceId,
        type: "ReasoningTrace",
        properties: {
          judgment_ref: judgmentRef,
          node_refs: nodeRefs,
          method_application_refs: asStringArray(parameters.methodApplicationRefs),
          created_at: String(parameters.evaluatedAt || new Date().toISOString()),
        },
        projection: { section: "reasoning_traces", index: graph.objects.filter((o) => o.type === "ReasoningTrace").length },
      }],
      relations: [
        { id: `REL-${traceId}-${judgmentRef}`, type: "reasoningTraceForJudgment", sourceId: traceId, targetId: judgmentRef, properties: {} },
        ...relationNodeRefs.map((ref, index) => ({
          id: `REL-${traceId}-${ref}`,
          type: "traceIncludesNode",
          sourceId: traceId,
          targetId: ref,
          properties: { sequence: index + 1 },
        })),
      ],
    };
  }

  return { objects: [], relations: [] };
}

function assertWriteScope(action: ActionTypeDef, objects: GraphObject[], relations: GraphRelation[]) {
  const scope = new Set(action.write_scope);
  for (const object of objects) {
    if (!scope.has(object.type)) throw new Error(`对象类型 ${object.type} 超出 write_scope`);
  }
  for (const relation of relations) {
    if (!scope.has(relation.type)) throw new Error(`关系类型 ${relation.type} 超出 write_scope`);
  }
}

function cloneGraph(graph: BusinessInstanceGraph): BusinessInstanceGraph {
  return {
    schema_name: "ontology_business_instance_graph",
    schema_version: graph.schema_version || "1.0.0",
    authority: graph.authority || "business_parameters",
    objects: graph.objects.map((object) => ({ ...object, properties: { ...(object.properties || {}) } })),
    relations: graph.relations.map((relation) => ({ ...relation, properties: { ...(relation.properties || {}) } })),
    projection_fingerprints: graph.projection_fingerprints ? { ...graph.projection_fingerprints } : undefined,
  };
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value)
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export function supportedActions(): string[] {
  return [...SUPPORTED_ACTIONS];
}

export function bootstrapGraph(): BusinessInstanceGraph {
  return emptyGraph();
}
