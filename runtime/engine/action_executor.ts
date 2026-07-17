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

export type ActionTypeDef = {
  id: string;
  name: string;
  description: string;
  target_types: string[];
  parameters: string[];
  preconditions: string[];
  effects: string[];
  outputs: string[];
  rule_refs: string[];
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

const ontologyFiles = [
  "ontology/01_通用/semantic.yaml",
  "ontology/01_通用/evidence.yaml",
  "ontology/01_通用/reasoning.yaml",
  "ontology/02_领域/semiconductor/semantic.yaml",
  "ontology/02_领域/semiconductor/evidence.yaml",
  "ontology/02_领域/semiconductor/reasoning.yaml",
];

let cachedActions: Map<string, ActionTypeDef> | null = null;
let cachedFunctions: Map<string, FunctionDef> | null = null;

function loadCatalogs() {
  if (cachedActions && cachedFunctions) return;
  cachedActions = new Map();
  cachedFunctions = new Map();
  for (const file of ontologyFiles) {
    const doc = YAML.parse(readFileSync(repositoryPath(file), "utf8")) || {};
    for (const [id, raw] of Object.entries<any>(doc.action_types || {})) {
      cachedActions.set(id, {
        id,
        name: raw.name || id,
        description: raw.description || "",
        target_types: raw.target_types || [],
        parameters: raw.parameters || [],
        preconditions: raw.preconditions || [],
        effects: raw.effects || [],
        outputs: raw.outputs || [],
        rule_refs: raw.rule_refs || [],
        function_ref: raw.function_ref,
        logic_refs: raw.logic_refs || [],
        write_scope: raw.write_scope || [],
        source_file: file,
      });
    }
    for (const [id, raw] of Object.entries<any>(doc.functions || {})) {
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
        source_file: file,
      });
    }
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

  if (functionId === "AssessEvidenceUsabilityFunction") {
    return assessEvidenceUsability(inputs, graph);
  }
  if (functionId === "CalculateConfidence") {
    return calculateConfidence(inputs, graph);
  }
  if (functionId === "AssessSourceReliability") {
    const tier = String(inputs.sourceTier || inputs.artifactType || "unknown");
    const reliability = /official|disclosure|监管|披露|primary/i.test(tier) ? "high" : /news|web/i.test(tier) ? "low" : "medium";
    return { reliability, reliabilityBasis: { sourceTier: tier } };
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
  const qualityHits = found.filter((object) => {
    const props = object.properties || {};
    const text = JSON.stringify(props);
    return /usable|high|primary|official|disclosure|监管|披露|一手/i.test(text);
  });
  const usable = found.length > 0 && missing.length === 0;
  const qualityLevel = !usable ? "insufficient" : qualityHits.length >= Math.ceil(found.length / 2) ? "high" : "medium";
  return {
    usability: usable ? "usable" : missing.length ? "partial" : "unusable",
    qualityLevel,
    rationale: usable
      ? `已定位 ${found.length} 条证据对象，可形成任务口径评估`
      : `证据不完整：缺失 ${missing.join(", ") || "无引用"}`,
    gapRefs: missing,
    scores: {
      coverage: found.length,
      missing: missing.length,
      quality_hits: qualityHits.length,
    },
  };
}

function calculateConfidence(inputs: Record<string, unknown>, graph: BusinessInstanceGraph) {
  const evidenceRefs = asStringArray(inputs.evidenceRefs);
  const signalRefs = asStringArray(inputs.signalRefs);
  const ruleEvaluations = asStringArray(inputs.ruleEvaluations);
  const present = [...evidenceRefs, ...signalRefs, ...ruleEvaluations].filter((id) =>
    graph.objects.some((object) => object.id === id),
  );
  const total = evidenceRefs.length + signalRefs.length + ruleEvaluations.length;
  const ratio = total ? present.length / total : 0;
  const confidence = ratio >= 0.8 ? "high" : ratio >= 0.5 ? "medium" : ratio > 0 ? "low" : "insufficient";
  return {
    confidence,
    confidenceBasis: {
      present_refs: present,
      total_refs: total,
      coverage_ratio: Number(ratio.toFixed(2)),
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
  const functionResult = action.function_ref
    ? callFunction(action.function_ref, parameters, graph)
    : {};
  const planned = planWrites(action, parameters, functionResult, graph);
  assertWriteScope(action, planned.objects, planned.relations);

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
        rule_refs: action.rule_refs,
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
  }
  if (action.id === "ExtractClaim") {
    const sourceRef = String(parameters.sourceRef || "").trim();
    if (!sourceRef) throw new Error("ExtractClaim 需要 sourceRef");
    if (!graph.objects.some((object) => object.id === sourceRef && object.type === "SourceDocument")) {
      throw new Error(`来源 ${sourceRef} 未登记为 SourceDocument`);
    }
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
  }
  if (action.id === "FormHypothesis") {
    if (!String(parameters.statement || "").trim()) throw new Error("FormHypothesis 需要 statement");
    const variableRef = String(parameters.variableRef || "").trim();
    if (!variableRef) throw new Error("FormHypothesis 需要 variableRef");
    if (!graph.objects.some((object) => object.id === variableRef)) {
      throw new Error(`状态变量 ${variableRef} 不在实例图中；请先物化 stage_02 或绑定样例包`);
    }
    if (!String(parameters.falsificationConditions || "").trim() && !asStringArray(parameters.falsificationConditions).length) {
      throw new Error("FormHypothesis 需要 falsificationConditions");
    }
  }
  if (action.id === "FormJudgment") {
    const statement = String(parameters.statement || "").trim();
    if (!statement) throw new Error("FormJudgment 需要 statement");
  }
  if (action.id === "RecordReasoningTrace") {
    const judgmentRef = String(parameters.judgmentRef || "").trim();
    if (!judgmentRef) throw new Error("RecordReasoningTrace 需要 judgmentRef");
    if (!graph.objects.some((object) => object.id === judgmentRef && object.type === "Judgment")) {
      throw new Error(`判断 ${judgmentRef} 不存在`);
    }
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
        source_id: sourceId,
        title: String(parameters.title),
        source_name: String(parameters.sourceName || parameters.publisher || ""),
        source_tier: String(parameters.sourceTier || "unknown"),
        publisher: String(parameters.publisher || ""),
        published_at: parameters.publishedAt || null,
        captured_at: parameters.capturedAt || new Date().toISOString(),
        locator: String(parameters.locator || parameters.url || ""),
        acquisition_channel: String(parameters.acquisitionChannel || "web"),
        access_scope: String(parameters.accessScope || "public"),
        artifact_type: String(parameters.artifactType || "web_page"),
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
          content_range: String(parameters.contentRange || ""),
          source_ref: sourceRef,
          extracted_by: "ExtractClaim",
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
        assessment_id: assessmentId,
        execution_id: String(parameters.executionId || "EXEC-WORKBENCH"),
        profile_ref: String(parameters.profileRef || ""),
        assessment_scope: String(parameters.assessmentScope || ""),
        usability: functionResult.usability,
        quality_level: functionResult.qualityLevel,
        rationale: functionResult.rationale,
        gap_refs: functionResult.gapRefs || [],
        evidence_refs: evidenceRefs,
        linked_judgment_unit_ids: judgmentUnitRefs,
        scores: functionResult.scores || {},
      },
      projection: { section: "evidence_assessments", index: graph.objects.filter((o) => o.type === "EvidenceAssessment").length },
    };
    return {
      objects: [object],
      relations: evidenceRefs.map((evidenceId, index) => ({
        id: `REL-${assessmentId}-${evidenceId}`,
        type: "assessmentEvaluatesEvidence",
        sourceId: assessmentId,
        targetId: evidenceId,
        properties: { index },
      })),
    };
  }

  if (action.id === "FormHypothesis") {
    const hypothesisId = String(parameters.hypothesisId || `HYP-${hashShort(String(parameters.statement))}`);
    const variableRef = String(parameters.variableRef || "");
    const object: GraphObject = {
      id: hypothesisId,
      type: "Hypothesis",
      properties: {
        hypothesis_id: hypothesisId,
        statement: String(parameters.statement),
        variable_ref: variableRef || null,
        direction: String(parameters.direction || "unknown"),
        time_horizon: String(parameters.timeHorizon || ""),
        conditions: String(parameters.conditions || ""),
        falsification_conditions: String(parameters.falsificationConditions || asStringArray(parameters.falsificationConditions).join("; ")),
        basis_refs: asStringArray(parameters.basisRefs),
        premise_statements: asStringArray(parameters.premiseStatements),
      },
      projection: { section: "hypotheses", index: graph.objects.filter((o) => o.type === "Hypothesis").length },
    };
    const relations: GraphRelation[] = [
      { id: `REL-${hypothesisId}-${variableRef}`, type: "hypothesisAbout", sourceId: hypothesisId, targetId: variableRef, properties: {} },
    ];
    for (const ref of asStringArray(parameters.basisRefs)) {
      if (graph.objects.some((o) => o.id === ref)) {
        relations.push({ id: `REL-${hypothesisId}-${ref}`, type: "hypothesisBasedOn", sourceId: hypothesisId, targetId: ref, properties: {} });
      }
    }
    return { objects: [object], relations };
  }

  if (action.id === "FormJudgment") {
    const judgmentId = String(parameters.judgmentId || `J-${hashShort(String(parameters.statement))}`);
    const hypothesisRefs = asStringArray(parameters.hypothesisRefs);
    const signalRefs = asStringArray(parameters.signalRefs);
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    const scenarioRef = parameters.scenarioRef ? String(parameters.scenarioRef) : "";
    const object: GraphObject = {
      id: judgmentId,
      type: "Judgment",
      properties: {
        judgment_id: judgmentId,
        statement: String(parameters.statement),
        judgment_level: String(parameters.judgmentLevel || "J1"),
        confidence: functionResult.confidence || "low",
        confidence_basis: functionResult.confidenceBasis || {},
        hypothesis_refs: hypothesisRefs,
        signal_refs: signalRefs,
        evidence_refs: evidenceRefs,
        time_horizon: String(parameters.timeHorizon || ""),
        uncertainty: String(parameters.uncertainty || ""),
        investment_interpretation: String(parameters.investmentInterpretation || ""),
        interpretation_basis: String(parameters.interpretationBasis || ""),
        scenario_ref: scenarioRef || null,
      },
      projection: { section: "judgments", index: graph.objects.filter((o) => o.type === "Judgment").length },
    };
    const relations: GraphRelation[] = [];
    for (const ref of [...hypothesisRefs, ...signalRefs, ...evidenceRefs]) {
      if (!graph.objects.some((object) => object.id === ref)) continue;
      relations.push({ id: `REL-${judgmentId}-${ref}`, type: "judgmentBasedOn", sourceId: judgmentId, targetId: ref, properties: {} });
    }
    if (scenarioRef && graph.objects.some((object) => object.id === scenarioRef)) {
      relations.push({ id: `REL-${judgmentId}-${scenarioRef}`, type: "judgmentUnderScenario", sourceId: judgmentId, targetId: scenarioRef, properties: {} });
    }
    return { objects: [object], relations };
  }

  if (action.id === "RecordReasoningTrace") {
    const judgmentRef = String(parameters.judgmentRef);
    const traceId = String(parameters.traceId || `RT-${hashShort(`${judgmentRef}:${Date.now()}`)}`);
    const ruleEvaluationRefs = asStringArray(parameters.ruleEvaluationRefs).filter((ref) => graph.objects.some((o) => o.id === ref));
    return {
      objects: [{
        id: traceId,
        type: "ReasoningTrace",
        properties: {
          trace_id: traceId,
          judgment_ref: judgmentRef,
          evaluated_at: String(parameters.evaluatedAt || new Date().toISOString()),
          input_refs: asStringArray(parameters.inputRefs),
          rule_evaluation_refs: asStringArray(parameters.ruleEvaluationRefs),
          steps: parameters.steps || [],
          rule_refs: asStringArray(parameters.ruleRefs),
          function_refs: asStringArray(parameters.functionRefs),
          logic_refs: asStringArray(parameters.logicRefs),
          output_refs: asStringArray(parameters.outputRefs),
          status: String(parameters.status || "recorded"),
        },
        projection: { section: "reasoning_traces", index: graph.objects.filter((o) => o.type === "ReasoningTrace").length },
      }],
      relations: [
        { id: `REL-${traceId}-${judgmentRef}`, type: "traceForJudgment", sourceId: traceId, targetId: judgmentRef, properties: {} },
        ...ruleEvaluationRefs.map((ref) => ({
          id: `REL-${traceId}-${ref}`,
          type: "traceIncludesRuleEvaluation",
          sourceId: traceId,
          targetId: ref,
          properties: {},
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
