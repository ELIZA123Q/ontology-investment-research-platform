import "server-only";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { latestArtifact } from "../adapters/db";
import { instancesPath, repositoryPath } from "../adapters/repo-paths";
import {
  normalizeCompetingExplanations,
  projectEvidenceRequirementsFromStructure,
  resolveDiscriminatingEvidence,
} from "./structure_candidates";
import { parseJson } from "./types";

export type GraphObject = {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
};

export type GraphRelation = {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties?: Record<string, unknown>;
};

export type BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph";
  schema_version: string;
  authority: string;
  objects: GraphObject[];
  relations: GraphRelation[];
  projection_fingerprints?: Record<string, string>;
};

export type ObjectSetQuery = {
  type?: string | string[];
  ids?: string[];
  relatedTo?: string;
  relationType?: string;
  direction?: "out" | "in" | "both";
  propertyContains?: { key: string; value: string };
  limit?: number;
};

export type ObjectSetResult = {
  objects: GraphObject[];
  relations: GraphRelation[];
  total_objects: number;
  total_relations: number;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional?: boolean;
};

export type GraphLoadResult = {
  graph: BusinessInstanceGraph;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional: boolean;
};

const EMPTY_GRAPH: BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph",
  schema_version: "1.0.0",
  authority: "business_parameters",
  objects: [],
  relations: [],
};

export function emptyGraph(): BusinessInstanceGraph {
  return structuredClone(EMPTY_GRAPH);
}

/** scopeIncludesObject 值域：不含 SemanticObject / StateVariable 等。 */
const SCOPE_MEMBER_TYPES = new Set([
  "Organization",
  "Company",
  "Industry",
  "ValueChainSegment",
  "Product",
  "Technology",
  "Region",
  "Metric",
  "Application",
  "Material",
  "ProcessStep",
  "PolicyInstrument",
  "Asset",
  "FinancialInstrument",
  "TradingVenue",
  "Listing",
]);

/** 仅靠 name 即可满足必填字段的成员类型；新建时其它类型回落到 Industry。 */
const SCOPE_MEMBER_TYPES_NAME_ONLY = new Set([
  "Organization",
  "Company",
  "Industry",
  "ValueChainSegment",
  "Product",
  "Technology",
  "Region",
  "Application",
  "Material",
  "ProcessStep",
  "Asset",
]);

export function isBusinessInstanceGraph(value: unknown): value is BusinessInstanceGraph {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return doc.schema_name === "ontology_business_instance_graph" && Array.isArray(doc.objects) && Array.isArray(doc.relations);
}

export function extractGraph(doc: unknown): BusinessInstanceGraph | null {
  if (!doc || typeof doc !== "object") return null;
  const root = doc as Record<string, unknown>;
  if (isBusinessInstanceGraph(root)) return normalizeGraph(root);
  if (isBusinessInstanceGraph(root.business_instance_graph)) {
    return normalizeGraph(root.business_instance_graph as BusinessInstanceGraph);
  }
  return null;
}

function normalizeGraph(graph: BusinessInstanceGraph): BusinessInstanceGraph {
  return {
    schema_name: "ontology_business_instance_graph",
    schema_version: String(graph.schema_version || "1.0.0"),
    authority: String(graph.authority || "business_parameters"),
    objects: (graph.objects || []).map((object) => ({
      id: String(object.id),
      type: String(object.type),
      properties: object.properties && typeof object.properties === "object" ? { ...object.properties } : {},
      projection: object.projection && typeof object.projection === "object" ? { ...object.projection } : undefined,
      validFrom: object.validFrom,
      validTo: object.validTo,
    })),
    relations: (graph.relations || []).map((relation) => ({
      id: String(relation.id),
      type: String(relation.type),
      sourceId: String(relation.sourceId),
      targetId: String(relation.targetId),
      properties: relation.properties && typeof relation.properties === "object" ? { ...relation.properties } : {},
    })),
    projection_fingerprints: graph.projection_fingerprints,
  };
}

export function queryObjectSet(graph: BusinessInstanceGraph, query: ObjectSetQuery = {}): ObjectSetResult {
  const types = query.type ? new Set(Array.isArray(query.type) ? query.type : [query.type]) : null;
  const ids = query.ids?.length ? new Set(query.ids) : null;
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  let objects = graph.objects.slice();

  if (types) objects = objects.filter((object) => types.has(object.type));
  if (ids) objects = objects.filter((object) => ids.has(object.id));
  if (query.propertyContains) {
    const { key, value } = query.propertyContains;
    objects = objects.filter((object) => {
      const raw = object.properties?.[key];
      return raw !== undefined && String(raw).includes(value);
    });
  }

  if (query.relatedTo) {
    const direction = query.direction || "both";
    const neighborIds = new Set<string>();
    for (const relation of graph.relations) {
      if (query.relationType && relation.type !== query.relationType) continue;
      if ((direction === "out" || direction === "both") && relation.sourceId === query.relatedTo) {
        neighborIds.add(relation.targetId);
      }
      if ((direction === "in" || direction === "both") && relation.targetId === query.relatedTo) {
        neighborIds.add(relation.sourceId);
      }
    }
    objects = objects.filter((object) => neighborIds.has(object.id) || object.id === query.relatedTo);
  }

  const objectIds = new Set(objects.map((object) => object.id));
  const relations = graph.relations.filter(
    (relation) => objectIds.has(relation.sourceId) || objectIds.has(relation.targetId),
  );

  return {
    objects: objects.slice(0, limit),
    relations: relations.slice(0, limit * 3),
    total_objects: objects.length,
    total_relations: relations.length,
    source: "business_instance_graph",
    authority: "formal",
  };
}

export function loadGraphFromYamlFile(absolutePath: string): BusinessInstanceGraph | null {
  if (!existsSync(absolutePath)) return null;
  const doc = YAML.parse(readFileSync(absolutePath, "utf8"));
  return extractGraph(doc);
}

let cachedDomainGraph: BusinessInstanceGraph | null | undefined;
export function loadDomainBusinessGraph(): BusinessInstanceGraph | null {
  if (cachedDomainGraph !== undefined) return cachedDomainGraph ? structuredClone(cachedDomainGraph) : null;
  cachedDomainGraph = loadGraphFromYamlFile(repositoryPath("ontology", "02_领域", "semiconductor", "business_instances.yaml"));
  return cachedDomainGraph ? structuredClone(cachedDomainGraph) : null;
}

export function loadGraphFromPackage(packageRelPath: string): BusinessInstanceGraph | null {
  const normalized = packageRelPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized.startsWith("instances/") || normalized.includes("../")) {
    throw new Error("样例包路径必须位于 instances/ 内");
  }
  const root = instancesPath(normalized.slice("instances/".length));
  if (!existsSync(root)) return null;
  const files = readdirSync(root).filter((name) => name.includes("本体视图") && name.endsWith(".yaml"));
  for (const file of files) {
    const graph = loadGraphFromYamlFile(path.join(/* turbopackIgnore: true */ root, file));
    if (graph?.objects.length) return graph;
  }

  // Ontology 3.0 的 semantic_fixture 样例按 02/03/04 分层保存，不再附带旧式“本体视图”文件。
  // 这里仅做只读、确定性的包投影；正式写入仍须生成 instance_graph artifact。
  const compactStages: Array<[string, string]> = [
    ["02_structure.yaml", "stage_02"],
    ["03_evidence.yaml", "stage_03"],
    ["04_judgment.yaml", "stage_04"],
  ];
  let projected = emptyGraph();
  projected.authority = "package_projection";
  for (const [file, stageKind] of compactStages) {
    const absolutePath = path.join(/* turbopackIgnore: true */ root, file);
    if (!existsSync(absolutePath)) continue;
    const document = YAML.parse(readFileSync(absolutePath, "utf8"));
    if (!document || typeof document !== "object") continue;
    projected = materializeStageIntoGraph(projected, stageKind, document as Record<string, unknown>);
    projected.authority = "package_projection";
  }
  if (projected.objects.length) return projected;
  return null;
}

/**
 * Load the run-scoped graph.
 * Formal authority = committed `instance_graph` artifact only.
 * Package / embedded stage graphs are read-only seeds.
 * Draft synthesis is NEVER returned as silent formal truth — use buildProvisionalProjection().
 */
export function loadGraphForRun(runId: string, packagePath?: string | null): GraphLoadResult {
  const graphArtifact = latestArtifact(runId, "instance_graph" as any, ["approved", "needs_review"]);
  if (graphArtifact) {
    const payload: any = parseJson(graphArtifact.json_content, {});
    const graph = extractGraph(payload);
    if (graph) {
      const provisional = Boolean(payload.provisional) || graph.authority === "workbench_provisional";
      return {
        graph,
        source: `artifact:${graphArtifact.id}`,
        authority: provisional ? "provisional" : "formal",
        provisional,
      };
    }
  }

  if (packagePath) {
    const graph = loadGraphFromPackage(packagePath);
    if (graph?.objects.length) {
      return { graph, source: `package:${packagePath}`, authority: "package", provisional: false };
    }
  }

  for (const kind of ["stage_02", "stage_04", "stage_03"] as const) {
    const artifact = latestArtifact(runId, kind, ["approved"]);
    if (!artifact) continue;
    const graph = extractGraph(parseJson(artifact.json_content, {}));
    if (graph?.objects.length) {
      return {
        graph,
        source: `${kind}:${artifact.id}`,
        authority: "package",
        provisional: false,
      };
    }
  }

  return { graph: emptyGraph(), source: "empty", authority: "empty", provisional: false };
}

/** Explicit draft projection — must not be treated as formal write authority. */
export function buildProvisionalProjection(runId: string): BusinessInstanceGraph {
  const graph = emptyGraph();
  graph.authority = "workbench_provisional";
  const stage02 = latestArtifact(runId, "stage_02", ["approved", "needs_review"]);
  if (stage02) {
    const data: any = parseJson(stage02.json_content, {});
    for (const [index, unit] of (data.judgment_units || []).entries()) {
      graph.objects.push({
        id: String(unit.id || `JU-${index + 1}`),
        type: "JudgmentUnit",
        properties: { ...unit, provisional: true },
        projection: { section: "judgment_units", index, provisional: true },
      });
    }
  }

  const stage03 = latestArtifact(runId, "stage_03", ["approved", "needs_review"]);
  if (stage03) {
    const data: any = parseJson(stage03.json_content, {});
    for (const [index, draft] of (data.evidence_drafts || []).entries()) {
      const id = String(draft.id || `EV-${index + 1}`);
      graph.objects.push({
        id,
        type: draft.kind === "gap" ? "EvidenceRequirement" : "EvidenceFact",
        properties: { ...draft, provisional: true },
        projection: { section: "evidence_drafts", index, provisional: true },
      });
    }
  }

  const stage04 = latestArtifact(runId, "stage_04", ["approved", "needs_review"]);
  if (stage04) {
    const data: any = parseJson(stage04.json_content, {});
    for (const [index, judgment] of (data.judgments || []).entries()) {
      const id = String(judgment.judgment_id || judgment.id || `J-${index + 1}`);
      graph.objects.push({
        id,
        type: "Judgment",
        properties: { ...judgment, provisional: true },
        projection: { section: "judgments", index, provisional: true },
      });
      for (const hypothesisId of judgment.hypothesis_ids || []) {
        graph.relations.push({
          id: `REL-${id}-${hypothesisId}`,
          type: "judgmentBasedOnHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: { provisional: true },
        });
      }
    }
  }

  const methodSource = stage04 || stage03 || stage02;
  if (methodSource) {
    const data: any = parseJson(methodSource.json_content, {});
    for (const [index, application] of (data.method_applications || []).entries()) {
      graph.objects.push({
        id: String(application.application_id || `MA-${index + 1}`),
        type: "MethodApplication",
        properties: { ...application, runtime_contract: "1.3.0", provisional: true },
        projection: { section: "method_applications", index, provisional: true },
      });
    }
  }

  return graph;
}

export function mergeGraphs(base: BusinessInstanceGraph, incoming: BusinessInstanceGraph): BusinessInstanceGraph {
  const next: BusinessInstanceGraph = {
    schema_name: "ontology_business_instance_graph",
    schema_version: base.schema_version || "1.0.0",
    authority: "business_parameters",
    objects: base.objects.map((object) => ({ ...object, properties: { ...(object.properties || {}) } })),
    relations: base.relations.map((relation) => ({ ...relation, properties: { ...(relation.properties || {}) } })),
  };
  const objectIds = new Set(next.objects.map((object) => object.id));
  const relationIds = new Set(next.relations.map((relation) => relation.id));
  for (const object of incoming.objects) {
    if (objectIds.has(object.id)) {
      next.objects = next.objects.map((existing) => (existing.id === object.id ? { ...object, properties: { ...(object.properties || {}) } } : existing));
    } else {
      next.objects.push({ ...object, properties: { ...(object.properties || {}) } });
      objectIds.add(object.id);
    }
  }
  for (const relation of incoming.relations) {
    if (relationIds.has(relation.id)) {
      next.relations = next.relations.map((existing) => (existing.id === relation.id ? { ...relation, properties: { ...(relation.properties || {}) } } : existing));
    } else {
      next.relations.push({ ...relation, properties: { ...(relation.properties || {}) } });
      relationIds.add(relation.id);
    }
  }
  return next;
}

/** Materialize stage drafts / embedded graphs into the committed instance_graph artifact payload. */
export function materializeStageIntoGraph(
  current: BusinessInstanceGraph,
  stageKind: string,
  stageJson: Record<string, unknown>,
): BusinessInstanceGraph {
  const embedded = extractGraph(stageJson);
  if (embedded?.objects.length) {
    return mergeGraphs({ ...current, authority: "business_parameters" }, embedded);
  }

  const slice = emptyGraph();
  slice.authority = "business_parameters";
  const addObjects = (
    values: unknown,
    type: string,
    idKeys: string[],
    section: string,
    typeFromItem = false,
  ) => {
    if (!Array.isArray(values)) return;
    for (const [index, raw] of values.entries()) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const id = idKeys.map((key) => item[key]).find((value) => value !== undefined && String(value).length);
      if (!id) continue;
      slice.objects.push({
        id: String(id),
        type: typeFromItem && item.type ? String(item.type) : type,
        properties: { ...item },
        projection: { section, index },
      });
    }
  };
  for (const [index, application] of ((stageJson.method_applications as any[]) || []).entries()) {
    const applicationId = String(application.application_id || `MA-${index + 1}`);
    slice.objects.push({
      id: applicationId,
      type: "MethodApplication",
      properties: { ...application, runtime_contract: "1.3.0" },
      projection: { section: "method_applications", index },
    });
    for (const judgmentUnitId of application.target_judgment_unit_refs || []) {
      slice.relations.push({
        id: `RUNTIME-${applicationId}-TARGET-${judgmentUnitId}`,
        type: "runtimeMethodApplicationTargets",
        sourceId: applicationId,
        targetId: String(judgmentUnitId),
        properties: { authority: "public_contract_1.3" },
      });
    }
  }
  if (stageKind === "stage_02") {
    const scope = stageJson.research_scope as any;
    if (scope?.id) {
      slice.objects.push({
        id: String(scope.id),
        type: "ResearchScope",
        properties: { label: scope.label, dimensions: scope.dimensions },
        projection: { section: "research_scope", index: 0 },
      });
    }
    addObjects(stageJson.ontology_instances, "SemanticObject", ["id"], "ontology_instances", true);
    // Re-type ontology instances that already carry an explicit ontology type.
    for (const instance of (Array.isArray(stageJson.ontology_instances) ? stageJson.ontology_instances as any[] : [])) {
      const id = String(instance?.id || "");
      const typed = String(instance?.type || instance?.object_type || "");
      if (!id || !typed) continue;
      const object = slice.objects.find((item) => item.id === id);
      if (object) object.type = typed;
    }
    addObjects(stageJson.variables, "StateVariable", ["id"], "variables");
    addObjects(stageJson.paths, "ResearchPath", ["id"], "paths");
    addObjects(stageJson.questions, "ResearchQuestion", ["question_id", "id"], "questions");
    if (scope?.id) {
      const scopeId = String(scope.id);
      const ensureScopeMember = (objectId: string, preferredType: string, name: string, dimension: string) => {
        if (!objectId || objectId.startsWith("task_local:")) return;
        const inSlice = slice.objects.find((item) => item.id === objectId);
        const inCurrent = current.objects.find((item) => item.id === objectId);
        const existing = inSlice || inCurrent;
        if (existing) {
          let type = String(existing.type);
          if (!SCOPE_MEMBER_TYPES.has(type)) {
            // SemanticObject 可就地升级为合法成员；StateVariable 等不可挂接。
            if (type !== "SemanticObject" || !inSlice) return;
            type = SCOPE_MEMBER_TYPES_NAME_ONLY.has(preferredType) ? preferredType : "Industry";
            inSlice.type = type;
            inSlice.properties = {
              ...(inSlice.properties || {}),
              name: name || String((inSlice.properties as any)?.name || objectId),
            };
          }
        } else {
          const type = SCOPE_MEMBER_TYPES_NAME_ONLY.has(preferredType) ? preferredType : "Industry";
          slice.objects.push({
            id: objectId,
            type,
            properties: { name: name || objectId },
            projection: { section: "scope_members", index: slice.objects.filter((item) => item.type === type).length },
          });
        }
        const relationId = `REL-${scopeId}-INCLUDES-${objectId}`;
        if (slice.relations.some((item) => item.id === relationId) || current.relations.some((item) => item.id === relationId)) return;
        slice.relations.push({
          id: relationId,
          type: "scopeIncludesObject",
          sourceId: scopeId,
          targetId: objectId,
          properties: { dimension },
        });
      };
      const coreObject = String(scope.dimensions?.core_object || "").trim();
      if (coreObject) {
        ensureScopeMember("OBJ-SCOPE-CORE", "Industry", coreObject, "core_object");
      }
      for (const instance of (Array.isArray(stageJson.ontology_instances) ? stageJson.ontology_instances as any[] : [])) {
        const id = String(instance?.id || "").trim();
        if (!id) continue;
        ensureScopeMember(
          id,
          String(instance?.type || instance?.object_type || "Industry"),
          String(instance?.name || instance?.label || id),
          String(instance?.dimension || "ontology_instance"),
        );
      }
      for (const unit of (Array.isArray(stageJson.judgment_units) ? stageJson.judgment_units as any[] : [])) {
        for (const nodeId of unit.ontology_node_ids || unit.target_ontology_object_refs || []) {
          const id = String(nodeId || "").trim();
          if (!id) continue;
          const known = [...current.objects, ...slice.objects].find((item) => item.id === id);
          ensureScopeMember(
            id,
            String(known?.type || "Industry"),
            String((known?.properties as any)?.name || id),
            "judgment_unit_ontology_node",
          );
        }
      }
    }
    for (const [index, unit] of ((stageJson.judgment_units as any[]) || []).entries()) {
      const unitId = String(unit.judgment_unit_id || unit.id || `JU-${index + 1}`);
      slice.objects.push({
        id: unitId,
        type: "JudgmentUnit",
        properties: {
          ...unit,
          statement: unit.statement || unit.question,
          scope_ref: unit.scope_ref || scope?.id,
        },
        projection: { section: "judgment_units", index },
      });
      if (unit.scope_ref || scope?.id) {
        slice.relations.push({
          id: `REL-${unitId}-SCOPE-${unit.scope_ref || scope.id}`,
          type: "unitUsesScope",
          sourceId: unitId,
          targetId: String(unit.scope_ref || scope.id),
          properties: {},
        });
      }
    }
    const stageUnits = Array.isArray(stageJson.judgment_units) ? stageJson.judgment_units as any[] : [];
    const projectedRequirements = Array.isArray(stageJson.evidence_requirements) && (stageJson.evidence_requirements as any[]).length
      ? stageJson.evidence_requirements as any[]
      : projectEvidenceRequirementsFromStructure({
        units: stageUnits.map((unit: any) => ({
          id: String(unit.judgment_unit_id || unit.id || ""),
          evidence_requirements: unit.evidence_requirements,
        })),
        counter_evidence_directions: stageJson.counter_evidence_directions,
      });
    const unitEvidenceById = new Map<string, string[]>();
    for (const unit of stageUnits) {
      const unitId = String(unit.judgment_unit_id || unit.id || "").trim();
      if (!unitId) continue;
      const requirements = Array.isArray(unit.evidence_requirements)
        ? unit.evidence_requirements.map(String).map((item: string) => item.trim()).filter(Boolean)
        : [];
      if (requirements.length) unitEvidenceById.set(unitId, requirements);
    }
    const evidenceRequirementById = new Map<string, string>();
    for (const requirement of projectedRequirements) {
      const requirementId = String(requirement.id || requirement.evidence_requirement_id || "").trim();
      const text = String(requirement.requirement || requirement.statement || "").trim();
      if (requirementId && text) evidenceRequirementById.set(requirementId, text);
    }
    const competing = normalizeCompetingExplanations(stageJson.competing_explanations, {
      unitIds: stageUnits.map((unit: any) => String(unit.judgment_unit_id || unit.id || "")).filter(Boolean),
      unitEvidenceById,
      evidenceRequirementById,
    });
    for (const [index, explanation] of competing.entries()) {
      slice.objects.push({
        id: explanation.explanation_id,
        type: "CompetingExplanation",
        properties: {
          statement: explanation.statement,
          discriminating_evidence: explanation.discriminating_evidence,
          judgment_unit_ids: explanation.judgment_unit_ids,
        },
        projection: { section: "competing_explanations", index },
      });
      for (const unitId of explanation.judgment_unit_ids) {
        slice.relations.push({
          id: `REL-${explanation.explanation_id}-UNIT-${unitId}`,
          type: "competingExplanationForUnit",
          sourceId: explanation.explanation_id,
          targetId: String(unitId),
          properties: {},
        });
      }
    }
    for (const [index, requirement] of projectedRequirements.entries()) {
      if (!requirement || typeof requirement !== "object") continue;
      const requirementId = String(requirement.id || requirement.evidence_requirement_id || `ER-${index + 1}`);
      slice.objects.push({
        id: requirementId,
        type: "EvidenceRequirement",
        properties: {
          requirement: requirement.requirement || requirement.statement,
          evidence_role: requirement.evidence_role || "support",
          minimum_independent_sources: Number(requirement.minimum_independent_sources ?? 1),
          source: requirement.source,
          source_ref: requirement.source_ref,
        },
        projection: { section: "evidence_requirements", index },
      });
      for (const unitId of requirement.judgment_unit_ids || []) {
        if (!unitId) continue;
        slice.relations.push({
          id: `REL-${requirementId}-UNIT-${unitId}`,
          type: "requirementForJudgmentUnit",
          sourceId: requirementId,
          targetId: String(unitId),
          properties: {},
        });
      }
    }
    const questions = Array.isArray(stageJson.questions) ? stageJson.questions as any[] : [];
    const researchScope = stageJson.research_scope as any;
    const questionId = String(
      questions[0]?.id
      || questions[0]?.question_id
      || (researchScope?.dimensions?.question || researchScope?.label ? "RQ-01" : ""),
    );
    const questionStatement = String(
      questions[0]?.statement
      || questions[0]?.question
      || researchScope?.dimensions?.question
      || researchScope?.label
      || "",
    ).trim();
    if (questionId && questionStatement) {
      const existing = slice.objects.find((item) => item.id === questionId);
      const questionProperties = {
        question: questionStatement,
        statement: questionStatement,
        scope_ref: String(researchScope?.id || questions[0]?.scope_ref || "SCOPE-UNRESOLVED"),
        failure_route: String(questions[0]?.failure_route || "return_to_structure"),
      };
      if (existing) {
        existing.properties = { ...existing.properties, ...questionProperties };
        existing.type = "ResearchQuestion";
      } else {
        slice.objects.push({
          id: questionId,
          type: "ResearchQuestion",
          properties: questionProperties,
          projection: { section: "questions", index: 0 },
        });
      }
      for (const [index, unit] of stageUnits.entries()) {
        const unitId = String(unit.judgment_unit_id || unit.id || `JU-${index + 1}`);
        slice.relations.push({
          id: `REL-${questionId}-UNIT-${unitId}`,
          type: "questionDecomposesIntoUnit",
          sourceId: questionId,
          targetId: unitId,
          properties: { sequence: index + 1 },
        });
      }
    }
  }
  if (stageKind === "stage_03") {
    addObjects(stageJson.claims, "EvidenceClaim", ["claim_id", "id"], "claims");
    addObjects(stageJson.facts, "EvidenceFact", ["evidence_id", "id"], "facts", true);
    addObjects(stageJson.assessments, "EvidenceAssessment", ["assessment_id", "id"], "assessments");
    addObjects(stageJson.baskets, "EvidenceBasket", ["basket_id", "id"], "baskets");
    const sourceByKey = new Map<string, any>();
    for (const [index, source] of ((stageJson.sources as any[]) || []).entries()) {
      const id = String(source.source_id || source.source_key || source.id || `SD-${index + 1}`);
      sourceByKey.set(String(source.source_key || id), { ...source, id });
      slice.objects.push({
        id,
        type: "SourceDocument",
        properties: {
          ...source,
          title: source.title,
          uri: source.final_url || source.url,
          published_at: source.published_at,
          source_tier: source.source_tier,
        },
        projection: { section: "sources", index },
      });
    }
    for (const [index, draft] of ((stageJson.evidence_drafts as any[]) || []).entries()) {
      const evidenceId = String(draft.id || `EV-${index + 1}`);
      if (draft.kind === "gap") {
        slice.objects.push({
          id: evidenceId,
          type: "EvidenceRequirement",
          properties: {
            ...draft,
            requirement: draft.requirement || draft.statement,
            evidence_role: draft.evidence_role,
            minimum_independent_sources: draft.minimum_independent_sources,
          },
          projection: { section: "evidence_drafts", index },
        });
        for (const unitId of draft.judgment_unit_ids || []) {
          slice.relations.push({
            id: `REL-${evidenceId}-UNIT-${unitId}`,
            type: "requirementForJudgmentUnit",
            sourceId: evidenceId,
            targetId: String(unitId),
            properties: {},
          });
        }
        continue;
      }
      slice.objects.push({
        id: evidenceId,
        type: "EvidenceFact",
        properties: {
          ...draft,
          statement: draft.statement,
          subject_ref: draft.subject_ref,
          time_basis: draft.time_basis,
          scope_ref: draft.scope_ref,
          observed_at: draft.observed_at,
          valid_from: draft.valid_from,
          valid_to: draft.valid_to ?? null,
          published_at: draft.published_at,
          cutoff_at: draft.cutoff_at,
        },
        projection: { section: "evidence_drafts", index },
      });
      for (const [sourceIndex, sourceKey] of (draft.source_keys || []).entries()) {
        const source = sourceByKey.get(String(sourceKey));
        if (!source) continue;
        const claimId = `CL-${evidenceId}-${sourceIndex + 1}`;
        slice.objects.push({
          id: claimId,
          type: "EvidenceClaim",
          properties: {
            statement: source.source_quote,
            locator: source.locator,
            extracted_at: source.captured_at,
            cutoff_at: draft.cutoff_at,
          },
          projection: { section: "derived_claims", index: slice.objects.filter((o) => o.type === "EvidenceClaim").length },
        });
        slice.relations.push(
          { id: `REL-${claimId}-SOURCE`, type: "claimCitesSource", sourceId: claimId, targetId: source.id, properties: {} },
          { id: `REL-${evidenceId}-${claimId}`, type: "factDerivedFromClaim", sourceId: evidenceId, targetId: claimId, properties: {} },
        );
      }
      const role = draft.direction === "weaken" || draft.kind === "counter"
        ? "counter"
        : draft.direction === "neutral"
          ? "context"
          : "support";
      for (const unitIdRaw of draft.judgment_unit_ids || []) {
        const unitId = String(unitIdRaw || "").trim();
        if (!unitId) continue;
        const assessmentId = `EA-${evidenceId}-${unitId}`;
        const basketId = `EB-${unitId}-${role}`;
        const requirementId = `ER-RUNTIME-${unitId}-${role}`;
        if (!slice.objects.some((item) => item.id === assessmentId)) {
          slice.objects.push({
            id: assessmentId,
            type: "EvidenceAssessment",
            properties: {
              assessment: "usable_with_caveat",
              directness: draft.directness || "indirect",
              limitations: draft.limitations || [],
              judgment_unit_id: unitId,
            },
            projection: { section: "derived_assessments", index: slice.objects.filter((o) => o.type === "EvidenceAssessment").length },
          });
        }
        slice.relations.push({
          id: `REL-${assessmentId}-FACT-${evidenceId}`,
          type: "assessmentEvaluatesFact",
          sourceId: assessmentId,
          targetId: evidenceId,
          properties: {},
        });
        if (!slice.objects.some((item) => item.id === basketId)) {
          slice.objects.push({
            id: basketId,
            type: "EvidenceBasket",
            properties: {
              label: `${unitId} · ${role === "counter" ? "反证" : role === "context" ? "背景" : "支持"}篮子`,
              role,
              judgment_unit_id: unitId,
            },
            projection: { section: "derived_baskets", index: slice.objects.filter((o) => o.type === "EvidenceBasket").length },
          });
        }
        slice.relations.push({
          id: `REL-${basketId}-ASSESS-${assessmentId}`,
          type: "basketIncludesAssessment",
          sourceId: basketId,
          targetId: assessmentId,
          properties: {},
        });
        if (!slice.objects.some((item) => item.id === requirementId)) {
          slice.objects.push({
            id: requirementId,
            type: "EvidenceRequirement",
            properties: {
              requirement: `${unitId} 的${role === "counter" ? "反证" : role === "context" ? "背景" : "支持"}证据门槛`,
              evidence_role: role,
              minimum_independent_sources: 1,
            },
            projection: { section: "derived_requirements", index: slice.objects.filter((o) => o.type === "EvidenceRequirement").length },
          });
          slice.relations.push({
            id: `REL-${requirementId}-UNIT-${unitId}`,
            type: "requirementForJudgmentUnit",
            sourceId: requirementId,
            targetId: unitId,
            properties: {},
          });
        }
        if (!slice.relations.some((item) => item.id === `REL-${basketId}-REQ-${requirementId}`)) {
          slice.relations.push({
            id: `REL-${basketId}-REQ-${requirementId}`,
            type: "basketFulfillsRequirement",
            sourceId: basketId,
            targetId: requirementId,
            properties: { fulfillment: "partially_met" },
          });
        }
      }
    }
  }
  if (stageKind === "stage_04") {
    for (const [index, signal] of ((stageJson.signals as any[]) || []).entries()) {
      const id = String(signal.signal_id || signal.id || `SIG-${index + 1}`);
      slice.objects.push({
        id,
        type: "Signal",
        properties: { ...signal },
        projection: { section: "signals", index },
      });
      for (const evidenceId of signal.evidence_refs || signal.evidence_draft_ids || []) {
        slice.relations.push({
          id: `REL-${id}-EVIDENCE-${evidenceId}`,
          type: "signalGroundedByFact",
          sourceId: id,
          targetId: String(evidenceId),
          properties: { role: signal.role },
        });
      }
      for (const hypothesisId of signal.target_hypothesis_ids || []) {
        slice.relations.push({
          id: `REL-${id}-HYPOTHESIS-${hypothesisId}`,
          type: "signalEvaluatesHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: {},
        });
      }
    }
    addObjects(stageJson.hypotheses, "Hypothesis", ["hypothesis_id", "id"], "hypotheses");
    for (const [index, hypothesis] of ((stageJson.hypotheses as any[]) || []).entries()) {
      const hypothesisId = String(hypothesis.hypothesis_id || hypothesis.id || `H-${index + 1}`);
      for (const unitId of hypothesis.judgment_unit_ids || []) {
        if (!unitId) continue;
        const relationId = `REL-${unitId}-HYPOTHESIS-${hypothesisId}`;
        if (slice.relations.some((item) => item.id === relationId)) continue;
        slice.relations.push({
          id: relationId,
          type: "unitHasHypothesis",
          sourceId: String(unitId),
          targetId: hypothesisId,
          properties: { role: "primary" },
        });
      }
    }
    for (const [index, explanation] of ((stageJson.competing_explanations as any[]) || []).entries()) {
      const explanationId = String(explanation.explanation_id || explanation.id || `CE-${index + 1}`);
      const statement = String(explanation.statement || "").trim();
      slice.objects.push({
        id: explanationId,
        type: "CompetingExplanation",
        properties: {
          ...explanation,
          statement,
          discriminating_evidence: resolveDiscriminatingEvidence(explanation, { statement }),
        },
        projection: { section: "competing_explanations", index },
      });
      for (const unitId of explanation.judgment_unit_ids || []) {
        if (!unitId) continue;
        slice.relations.push({
          id: `REL-${explanationId}-UNIT-${unitId}`,
          type: "competingExplanationForUnit",
          sourceId: explanationId,
          targetId: String(unitId),
          properties: { stage: "stage_04" },
        });
      }
    }
    addObjects(stageJson.rule_evaluations, "RuleEvaluation", ["rule_evaluation_id", "id"], "rule_evaluations");
    for (const [index, trace] of ((stageJson.reasoning_traces as any[]) || []).entries()) {
      slice.objects.push({
        id: String(trace.trace_id || trace.id || `RT-${index + 1}`),
        type: "ReasoningTrace",
        properties: {
          ...trace,
          judgment_ref: trace.judgment_ref || trace.judgment_id,
          node_refs: trace.node_refs || trace.node_ids,
          created_at: trace.created_at,
        },
        projection: { section: "reasoning_traces", index },
      });
    }
    for (const [index, judgment] of ((stageJson.judgments as any[]) || []).entries()) {
      const id = String(judgment.judgment_id || judgment.id || `J-${index + 1}`);
      slice.objects.push({
        id,
        type: "Judgment",
        properties: {
          ...judgment,
          statement: judgment.statement || judgment.conclusion,
          level: judgment.level || judgment.strength,
          confidence: judgment.confidence,
          decision_status: judgment.decision_status,
          conflict_status: judgment.conflict_status,
          not_judgeable_reason: judgment.not_judgeable_reason,
          scope_ref: judgment.scope_ref,
          cutoff_at: judgment.cutoff_at,
          conditions: judgment.conditions || [],
          invalidation_conditions: judgment.invalidation_conditions,
        },
        projection: { section: "judgments", index },
      });
      for (const hypothesisId of judgment.hypothesis_ids || []) {
        slice.relations.push({
          id: `REL-${id}-${hypothesisId}`,
          type: "judgmentBasedOnHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: {},
        });
        if (judgment.judgment_unit_id) {
          slice.relations.push({
            id: `REL-${judgment.judgment_unit_id}-HYPOTHESIS-${hypothesisId}`,
            type: "unitHasHypothesis",
            sourceId: String(judgment.judgment_unit_id),
            targetId: String(hypothesisId),
            properties: { role: "primary" },
          });
        }
      }
      for (const ruleId of judgment.rule_evaluation_ids || []) {
        slice.relations.push({
          id: `REL-${id}-RULE-${ruleId}`,
          type: "judgmentHasRuleEvaluation",
          sourceId: id,
          targetId: String(ruleId),
          properties: {},
        });
      }
      if (judgment.judgment_unit_id) {
        slice.relations.push({
          id: `REL-${id}-UNIT-${judgment.judgment_unit_id}`,
          type: "judgmentResolvesUnit",
          sourceId: id,
          targetId: String(judgment.judgment_unit_id),
          properties: {},
        });
      }
      for (const applicationId of judgment.method_application_refs || judgment.method_application_ids || []) {
        slice.relations.push({
          id: `RUNTIME-${id}-METHOD-${applicationId}`,
          type: "runtimeJudgmentUsesMethodApplication",
          sourceId: id,
          targetId: String(applicationId),
          properties: { authority: "public_contract_1.3" },
        });
      }
    }
    const traceNodeTargetTypes = new Set([
      "ResearchScope", "JudgmentUnit", "Observation", "StateSnapshot", "StateChange", "Event",
      "EvidenceFact", "EvidenceAssessment", "EvidenceBasket", "Signal", "Hypothesis",
      "CompetingExplanation", "BlockingFactor", "RuleEvaluation",
    ]);
    for (const trace of (stageJson.reasoning_traces as any[]) || []) {
      const traceId = String(trace.trace_id || trace.id);
      const judgmentId = String(trace.judgment_ref || trace.judgment_id);
      slice.relations.push({
        id: `REL-${traceId}-JUDGMENT-${judgmentId}`,
        type: "reasoningTraceForJudgment",
        sourceId: traceId,
        targetId: judgmentId,
        properties: {},
      });
      for (const [sequence, nodeId] of ((trace.node_refs || trace.node_ids || []) as string[]).entries()) {
        const target = [...current.objects, ...slice.objects].find((object) => object.id === String(nodeId));
        if (!target || !traceNodeTargetTypes.has(target.type)) continue;
        slice.relations.push({
          id: `REL-${traceId}-NODE-${sequence + 1}-${nodeId}`,
          type: "traceIncludesNode",
          sourceId: traceId,
          targetId: String(nodeId),
          properties: { sequence: sequence + 1 },
        });
      }
    }
  }
  return mergeGraphs({ ...current, authority: "business_parameters" }, slice);
}

export function summarizeGraph(graph: BusinessInstanceGraph, limit = 40): string {
  const byType = new Map<string, number>();
  for (const object of graph.objects) byType.set(object.type, (byType.get(object.type) || 0) + 1);
  const typeLines = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}:${count}`);
  const sample = graph.objects.slice(0, limit).map((object) => `${object.id}(${object.type})`).join(", ");
  return `objects=${graph.objects.length}; relations=${graph.relations.length}; types=[${typeLines.join(", ")}]; sample=[${sample}]`;
}

const DOWNSTREAM_DIRECTIONS: Record<string, "forward" | "reverse"> = {
  claimCitesSource: "reverse",
  factDerivedFromClaim: "reverse",
  assessmentEvaluatesFact: "reverse",
  basketIncludesAssessment: "reverse",
  basketFulfillsRequirement: "reverse",
  requirementForJudgmentUnit: "reverse",
  factSupportsSignal: "forward",
  signalGroundedByFact: "reverse",
  signalEvaluatesHypothesis: "forward",
  hypothesisEvaluatedBySignal: "reverse",
  hypothesisSupportsJudgment: "forward",
  judgmentBasedOnHypothesis: "reverse",
  judgmentHasRuleEvaluation: "reverse",
  ruleEvaluationForJudgment: "forward",
  unitUsesScope: "forward",
  scopeIncludesObject: "forward",
  questionDecomposesIntoUnit: "forward",
  unitHasHypothesis: "forward",
  hypothesisForUnit: "reverse",
  competingExplanationForUnit: "reverse",
  judgmentResolvesUnit: "reverse",
  judgmentHasReasoningTrace: "forward",
  reasoningTraceForJudgment: "reverse",
  traceIncludesNode: "reverse",
  runtimeMethodApplicationTargets: "reverse",
  runtimeJudgmentUsesMethodApplication: "reverse",
};

export function markReachableDownstreamStale(graph: BusinessInstanceGraph, affectedObjectRefs: string[]) {
  const next = structuredClone(graph);
  const stale = new Set(affectedObjectRefs.filter((id) => next.objects.some((object) => object.id === id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of next.relations) {
      const direction = DOWNSTREAM_DIRECTIONS[relation.type];
      if (!direction) continue;
      const upstream = direction === "forward" ? relation.sourceId : relation.targetId;
      const downstream = direction === "forward" ? relation.targetId : relation.sourceId;
      if (stale.has(upstream) && !stale.has(downstream)) {
        stale.add(downstream);
        changed = true;
      }
    }
  }
  next.objects = next.objects.map((object) => stale.has(object.id)
    ? { ...object, properties: { ...(object.properties || {}), validity_status: "stale" } }
    : object);
  return { graph: next, stale_object_ids: [...stale] };
}

/** Resolve a formal example package relative path for binding. */
export function defaultExamplePackages(): string[] {
  const root = instancesPath("02_V3样例");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("instances", "02_V3样例", entry.name));
}
