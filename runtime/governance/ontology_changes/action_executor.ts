import { createHash } from "node:crypto";
import "server-only";
import {
  callFunction,
  getActionType,
  type ActionTypeDef,
} from "./action_registry";
import { validateRuntimeGraph } from "../../schemas/graph_contract";
import {
emptyGraph,
type BusinessInstanceGraph,
type GraphObject,
type GraphRelation,
} from "../../skills/ontology/instance_graph";
import { loadOntologyCatalog } from "../../skills/ontology/catalog_loader";
import { assertFormalRelationChoice } from "../../skills/ontology/relation_options";
import { ONTOLOGY_JUDGMENT_LEVELS } from "../../skills/ontology/vocabulary";
import { REQUIRED_RULES,ENGINE_VERSION as SEMANTIC_ENGINE_VERSION } from "../../skills/ontology/semantic_execution";
import {
  assertWriteScope,
  markActionProjection,
  planWrites,
} from "./action_write_planner";

export * from "./action_registry";

const TRACE_NODE_TYPES = new Set(
  loadOntologyCatalog().relation_types.get("traceIncludesNode")?.target_types || [],
);

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
  const planned = markActionProjection(planWrites(action, parameters, functionResult, graph));
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
    const planned = markActionProjection(proposal.planned_writes);
    assertWriteScope(action, planned.objects, planned.relations);

    const next = cloneGraph(graph);
    const objectIds = new Set(next.objects.map((object) => object.id));
    const relationIds = new Set(next.relations.map((relation) => relation.id));

    for (const object of planned.objects) {
      if (objectIds.has(object.id)) {
        next.objects = next.objects.map((existing) => (existing.id === object.id ? object : existing));
      } else {
        next.objects.push(object);
        objectIds.add(object.id);
      }
    }
    for (const relation of planned.relations) {
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
      written_object_ids: planned.objects.map((object) => object.id),
      written_relation_ids: planned.relations.map((relation) => relation.id),
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
  "LinkOntologyObjects",
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
  if (action.id === "LinkOntologyObjects") {
    const sourceId = String(parameters.sourceId || "").trim();
    const relationType = String(parameters.relationType || "").trim();
    const targetId = String(parameters.targetId || "").trim();
    if (!sourceId || !relationType || !targetId) {
      throw new Error("LinkOntologyObjects 需要 sourceId、relationType 与 targetId");
    }
    if (parameters.properties !== undefined
      && (!parameters.properties || typeof parameters.properties !== "object" || Array.isArray(parameters.properties))) {
      throw new Error("LinkOntologyObjects.properties 必须是对象");
    }
    assertFormalRelationChoice(graph, sourceId, relationType, targetId);
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
    if (!ONTOLOGY_JUDGMENT_LEVELS.includes(level as typeof ONTOLOGY_JUDGMENT_LEVELS[number])) {
      throw new Error("FormJudgment 需要合法 judgmentLevel");
    }
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
    requireObjects(graph, nodeRefs, [...TRACE_NODE_TYPES], "推理节点");
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
