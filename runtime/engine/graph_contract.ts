import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { BusinessInstanceGraph, GraphObject, GraphRelation } from "./instance_graph";

type FieldDefinition = { type?: string; required?: boolean; allowed_values?: string[]; cardinality?: string };
type ObjectDefinition = { attributes?: Record<string, FieldDefinition> };
type RelationDefinition = { source_types?: string[]; target_types?: string[]; attributes?: Record<string, FieldDefinition> };
type RuntimeProfile = {
  runtime_object_types?: Record<string, { required_properties?: string[] }>;
  runtime_relation_types?: Record<string, RelationDefinition>;
};

const MODEL_FILES = ["semantic.yaml", "state_event.yaml", "evidence.yaml", "judgment.yaml", "scenario.yaml", "semiconductor_extension.yaml"];
const BUSINESS_PARAMETER_OBJECT_TYPES = new Set([
  "EvidenceProfile", "EvidenceRecipe", "SourceProfile", "ProxyIndicator", "PropagationTemplate",
  "ScenarioTemplate", "BusinessScenarioTag", "JudgmentLevelCriterionTemplate",
]);
const TASK_VIEW_OBJECT_TYPES = new Set([
  "ResearchPlan", "ResearchFrameworkSelection", "SemanticScopeSelection", "EvidenceContract", "ReasoningPlan",
  "OntologyBindingSet", "OntologyCandidateSet", "OntologyGapSet", "JudgmentUnit", "InstanceRequirement",
  "EvidenceRequirement", "ResearchScope", "ResearchPath", "PathNode", "PathCondition", "CompetingExplanation",
  "AggregationContract", "JudgmentLevelCriterion", "EvidenceBasketRequirement", "CandidateClaim", "EvidenceBasket",
]);
const BUSINESS_PARAMETER_RELATIONS: Record<string, RelationDefinition> = {
  propagationTemplateUsesSourceVariable: { source_types: ["PropagationTemplate"], target_types: ["StateVariable"] },
  propagationTemplateProducesVariable: { source_types: ["PropagationTemplate"], target_types: ["StateVariable"] },
  stateVariableUsesEvidenceProfile: { source_types: ["StateVariable"], target_types: ["EvidenceProfile"] },
  scenarioTemplateConstrainsVariable: { source_types: ["ScenarioTemplate"], target_types: ["StateVariable"] },
  propagationTemplateUsesEvidenceProfile: { source_types: ["PropagationTemplate"], target_types: ["EvidenceProfile"] },
};
const RETIRED_RELATIONS = new Set(["judgmentBasedOn", "signalDerivedFromEvidence", "traceForJudgment", "traceIncludesRuleEvaluation"]);

let cached: {
  objectTypes: Set<string>;
  objectDefinitions: Map<string, ObjectDefinition>;
  relationTypes: Map<string, RelationDefinition>;
  runtimeRequired: Map<string, string[]>;
  parentsOf: Map<string, string[]>;
} | null = null;

function catalog() {
  if (cached) return cached;
  const objectTypes = new Set<string>([...BUSINESS_PARAMETER_OBJECT_TYPES, ...TASK_VIEW_OBJECT_TYPES]);
  const objectDefinitions = new Map<string, ObjectDefinition>();
  const relationTypes = new Map<string, RelationDefinition>(Object.entries(BUSINESS_PARAMETER_RELATIONS));
  const parentsOf = new Map<string, string[]>();
  for (const file of MODEL_FILES) {
    const document = YAML.parse(readFileSync(repositoryPath("ontology", "01_通用", "models", file), "utf8")) as any;
    for (const [id, definition] of Object.entries<any>(document.object_types || {})) {
      // draft = 已定义但未纳入当前运行投影；不得写入 business_instance_graph
      if ((definition?.metadata?.status || "active") === "active") {
        objectTypes.add(id);
        objectDefinitions.set(id, { attributes: definition.attributes || definition.properties || {} });
        const parents = [definition.extends, definition.projects_to].filter((value: unknown) => typeof value === "string" && value);
        if (parents.length) parentsOf.set(id, parents.map(String));
      }
    }
    // scenario_types 是 catalog_only 任务枚举，不得写入 business_instance_graph
    for (const [id, definition] of Object.entries<any>(document.relation_types || {})) {
      if ((definition?.metadata?.status || "active") !== "active") continue;
      relationTypes.set(id, {
        source_types: definition.source_types || [],
        target_types: definition.target_types || [],
        attributes: definition.attributes || definition.properties || {},
      });
    }
  }
  const profile = YAML.parse(readFileSync(repositoryPath("governance", "02_合同", "runtime_supported_profile.yaml"), "utf8")) as RuntimeProfile;
  const runtimeRequired = new Map<string, string[]>();
  for (const [id, definition] of Object.entries(profile.runtime_object_types || {})) {
    objectTypes.add(id);
    runtimeRequired.set(id, definition.required_properties || []);
  }
  for (const [id, definition] of Object.entries(profile.runtime_relation_types || {})) relationTypes.set(id, definition);
  cached = { objectTypes, objectDefinitions, relationTypes, runtimeRequired, parentsOf };
  return cached;
}

function ancestors(type: string, parentsOf: Map<string, string[]>) {
  const found = new Set<string>();
  const pending = [type];
  while (pending.length) {
    const current = pending.pop()!;
    if (found.has(current)) continue;
    found.add(current);
    for (const parent of parentsOf.get(current) || []) pending.push(parent);
  }
  return found;
}

function endpointMatches(actual: string, allowed: string[], parentsOf: Map<string, string[]>) {
  if (!allowed.length) return true;
  const actualAncestors = ancestors(actual, parentsOf);
  return allowed.some((item) => actualAncestors.has(item));
}

export function validateRuntimeGraph(graph: BusinessInstanceGraph): BusinessInstanceGraph {
  const { objectTypes, objectDefinitions, relationTypes, runtimeRequired, parentsOf } = catalog();
  if (graph.schema_name !== "ontology_business_instance_graph" || graph.schema_version !== "1.0.0") {
    throw new Error("实例图必须使用 ontology_business_instance_graph 1.0.0");
  }
  const objects = new Map<string, GraphObject>();
  for (const object of graph.objects) {
    if (!object.id || objects.has(object.id)) throw new Error(`实例图对象 ID 为空或重复: ${object.id || "<empty>"}`);
    if (!objectTypes.has(object.type)) throw new Error(`${object.id}.type 未在 Ontology 3.0 或 Runtime Supported Profile 登记: ${object.type}`);
    validateFields(`${object.id}.properties`, object.properties || {}, objectDefinitions.get(object.type)?.attributes || {});
    for (const field of runtimeRequired.get(object.type) || []) {
      if (object.properties?.[field] === undefined || object.properties?.[field] === "") {
        throw new Error(`${object.id}.properties 缺少 Runtime 必填字段 ${field}`);
      }
    }
    objects.set(object.id, object);
  }
  const relationIds = new Set<string>();
  for (const relation of graph.relations) validateRelation(relation, objects, relationTypes, relationIds, parentsOf);
  validateSemanticClosure(graph, objects);
  return graph;
}

function validateSemanticClosure(graph: BusinessInstanceGraph, objects: Map<string, GraphObject>) {
  const incoming = (id: string, type: string) => graph.relations.filter((relation) => relation.targetId === id && relation.type === type);
  const outgoing = (id: string, type: string) => graph.relations.filter((relation) => relation.sourceId === id && relation.type === type);
  for (const object of objects.values()) {
    if (object.type === "JudgmentUnit" && !outgoing(object.id, "unitUsesScope").length) {
      throw new Error(`${object.id} 缺少 unitUsesScope，判断单元未绑定冻结范围`);
    }
    if (object.type === "EvidenceClaim" && !outgoing(object.id, "claimCitesSource").length) {
      throw new Error(`${object.id} 缺少 claimCitesSource，原始陈述无法追溯`);
    }
    if (object.type === "EvidenceFact" && !outgoing(object.id, "factDerivedFromClaim").length) {
      throw new Error(`${object.id} 缺少 factDerivedFromClaim，归一事实无原文血缘`);
    }
    if (object.type === "Signal") {
      if (!outgoing(object.id, "signalGroundedByFact").length) throw new Error(`${object.id} 缺少 signalGroundedByFact`);
      if (!outgoing(object.id, "signalEvaluatesHypothesis").length) throw new Error(`${object.id} 缺少 signalEvaluatesHypothesis`);
    }
    if (object.type === "Judgment") {
      if (!outgoing(object.id, "judgmentBasedOnHypothesis").length) throw new Error(`${object.id} 缺少假设中介`);
      if (!outgoing(object.id, "judgmentHasRuleEvaluation").length) throw new Error(`${object.id} 缺少规则评估`);
      if (outgoing(object.id, "judgmentResolvesUnit").length !== 1) throw new Error(`${object.id} 必须且只能裁决一个 JudgmentUnit`);
      if (!outgoing(object.id, "runtimeJudgmentUsesMethodApplication").length) throw new Error(`${object.id} 缺少 MethodApplication 追溯`);
    }
    if (object.type === "ReasoningTrace") {
      const judgmentLinks = outgoing(object.id, "reasoningTraceForJudgment");
      if (judgmentLinks.length !== 1) throw new Error(`${object.id} 必须对应一个 Judgment`);
      if (!outgoing(object.id, "traceIncludesNode").length) throw new Error(`${object.id} 未物化任何推理节点`);
      const judgmentId = judgmentLinks[0].targetId;
      const judgment = objects.get(judgmentId);
      const declared = new Set<string>((object.properties?.node_refs as string[] | undefined) || []);
      declared.add(judgmentId);
      for (const ref of (object.properties?.method_application_refs as string[] | undefined) || []) declared.add(ref);
      const required = [
        ...outgoing(judgmentId, "judgmentBasedOnHypothesis").map((relation) => relation.targetId),
        ...outgoing(judgmentId, "judgmentHasRuleEvaluation").map((relation) => relation.targetId),
        ...outgoing(judgmentId, "runtimeJudgmentUsesMethodApplication").map((relation) => relation.targetId),
      ];
      if (judgment?.properties?.level !== "J0") {
        const hypothesisIds = outgoing(judgmentId, "judgmentBasedOnHypothesis").map((relation) => relation.targetId);
        const signalIds = graph.relations
          .filter((relation) => relation.type === "signalEvaluatesHypothesis" && hypothesisIds.includes(relation.targetId))
          .map((relation) => relation.sourceId);
        required.push(...signalIds);
        required.push(...graph.relations
          .filter((relation) => relation.type === "signalGroundedByFact" && signalIds.includes(relation.sourceId))
          .map((relation) => relation.targetId));
      }
      const missing = [...new Set(required)].filter((ref) => !declared.has(ref));
      if (missing.length) throw new Error(`${object.id} 未覆盖判断依赖节点: ${missing.join(", ")}`);
    }
    if (object.type === "MethodApplication" && !outgoing(object.id, "runtimeMethodApplicationTargets").length) {
      throw new Error(`${object.id} 未绑定 JudgmentUnit`);
    }
    if (object.type === "Hypothesis" && !incoming(object.id, "unitHasHypothesis").length) {
      throw new Error(`${object.id} 未绑定 JudgmentUnit`);
    }
  }
}

function validateRelation(relation: GraphRelation, objects: Map<string, GraphObject>, definitions: Map<string, RelationDefinition>, ids: Set<string>, parentsOf: Map<string, string[]>) {
  if (!relation.id || ids.has(relation.id)) throw new Error(`实例图关系 ID 为空或重复: ${relation.id || "<empty>"}`);
  ids.add(relation.id);
  if (RETIRED_RELATIONS.has(relation.type)) throw new Error(`${relation.id} 使用了已退役关系 ${relation.type}`);
  const definition = definitions.get(relation.type);
  if (!definition) throw new Error(`${relation.id}.type 未在 Ontology 3.0 或 Runtime Supported Profile 登记: ${relation.type}`);
  const source = objects.get(relation.sourceId);
  const target = objects.get(relation.targetId);
  if (!source || !target) throw new Error(`${relation.id} 存在悬空端点`);
  if (definition.source_types?.length && !endpointMatches(source.type, definition.source_types, parentsOf)) throw new Error(`${relation.id} 源端 ${source.type} 不符合 ${relation.type} 定义域`);
  if (definition.target_types?.length && !endpointMatches(target.type, definition.target_types, parentsOf)) throw new Error(`${relation.id} 目标端 ${target.type} 不符合 ${relation.type} 值域`);
  validateFields(`${relation.id}.properties`, relation.properties || {}, definition.attributes || {});
  if (((source.type === "EvidenceClaim" || source.type === "EvidenceFact") && target.type === "Judgment")
    || ((target.type === "EvidenceClaim" || target.type === "EvidenceFact") && source.type === "Judgment")) {
    throw new Error(`${relation.id} 违反 no_direct_evidence_to_judgment`);
  }
}

function validateFields(label: string, values: Record<string, unknown>, definitions: Record<string, FieldDefinition>) {
  for (const [field, definition] of Object.entries(definitions)) {
    const value = values[field];
    if (definition.required && (value === undefined || value === null || value === "")) {
      throw new Error(`${label} 缺少 Ontology 3.0 必填字段 ${field}`);
    }
    if (value === undefined || value === null) continue;
    const type = definition.type || "";
    const valid = type === "array" ? Array.isArray(value)
      : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isInteger(value)
          : type === "number" ? typeof value === "number" && Number.isFinite(value)
            : type === "boolean" ? typeof value === "boolean"
              : ["string", "object_ref", "uri", "datetime", "enum"].includes(type) ? typeof value === "string"
                : true;
    if (!valid) throw new Error(`${label}.${field} 不符合 ${type}`);
    if (type === "enum" && definition.allowed_values?.length && !definition.allowed_values.includes(String(value))) {
      throw new Error(`${label}.${field} 非法枚举值 ${String(value)}`);
    }
    if (definition.required && Array.isArray(value) && definition.cardinality?.startsWith("1..") && !value.length) {
      throw new Error(`${label}.${field} 不得为空数组`);
    }
  }
}

export function runtimeSupportedProfileSummary() {
  const { objectTypes, relationTypes, runtimeRequired } = catalog();
  return { object_types: objectTypes.size, relation_types: relationTypes.size, runtime_object_types: [...runtimeRequired.keys()] };
}
