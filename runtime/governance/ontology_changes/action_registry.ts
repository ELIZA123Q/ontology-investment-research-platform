import { readFileSync } from "node:fs";
import "server-only";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";
import type { BusinessInstanceGraph, GraphObject } from "../../skills/ontology/instance_graph";

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

const operationRegistryFile = "governance/contracts/runtime_operations.yaml";

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

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value)
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

