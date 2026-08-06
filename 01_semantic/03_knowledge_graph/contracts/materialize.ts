import "server-only";
import { normalizeCompetingExplanations, projectEvidenceRequirementsFromStructure } from "@/agents/02_structure/structure_candidates";
import { extractGraph, loadDomainBusinessGraph } from "./load";
import { mergeGraphs } from "./projection";
import { emptyGraph, type BusinessInstanceGraph } from "./types";
import { loadOntologyCatalog } from "@/skills/ontology/catalog_loader";
import { materializeStage04 } from "./materialize_stage04";

const SCOPE_MEMBER_TYPES = new Set(
  loadOntologyCatalog().relation_types.get("scopeIncludesObject")?.target_types || [],
);
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

const SCOPE_MEMBER_TYPE_BY_PREFIX = new Map(
  [...SCOPE_MEMBER_TYPES_NAME_ONLY]
    .filter((type) => SCOPE_MEMBER_TYPES.has(type))
    .map((type) => [type.toLowerCase(), type]),
);

/**
 * Stage02 可以引用任务内的业务实例（例如 product:HBM），而不应把这些实例
 * 混同为正式本体 schema node。只有关系端点正式允许、且仅靠 name 即可形成
 * 合法实例的类型才可在运行时确定性物化；未知 ID 继续由 authority gate 拒绝。
 */
function parseTypedScopeMemberRef(objectId: string): { type: string; name: string } | null {
  const separator = objectId.indexOf(":");
  if (separator <= 0 || separator === objectId.length - 1) return null;
  const type = SCOPE_MEMBER_TYPE_BY_PREFIX.get(objectId.slice(0, separator).toLowerCase());
  const localId = objectId.slice(separator + 1);
  if (!type || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(localId)) return null;
  return {
    type,
    name: localId.replace(/[_-]+/g, " "),
  };
}

/**
 * 为同一研究范围内的业务实体自动生成商业语义关系。
 *
 * 当多个业务实体（Company / Product / Industry / Region）通过 ontology_instances
 * 注册到同一 ResearchScope 时，它们之间仅存在 scopeIncludesObject 连接——在
 * 「实体关系图」中这些关系会被过滤（两端必须都是业务实体类型）。本函数补齐：
 *   - Company "produces" Product
 *   - Company "supplies_to" Company（区分研究主体与下游客户）
 *   - Industry "contains" Company / Product
 *   - Company "located_in" Region
 */
function generateEntityRelations(
  slice: { objects: BusinessInstanceGraph["objects"]; relations: BusinessInstanceGraph["relations"] },
  scopeId: string,
) {
  const businessTypes = new Set(["Company", "Product", "Industry", "Region"]);
  const scopeObjects = slice.objects.filter((obj) => businessTypes.has(obj.type));

  // 按类型分组
  const companies = scopeObjects.filter((obj) => obj.type === "Company");
  const products = scopeObjects.filter((obj) => obj.type === "Product");
  const industries = scopeObjects.filter((obj) => obj.type === "Industry");
  const regions = scopeObjects.filter((obj) => obj.type === "Region");

  const existingRelationIds = new Set(slice.relations.map((r) => r.id));

  const ensureRelation = (
    sourceId: string,
    targetId: string,
    relationType: string,
    properties: Record<string, unknown> = {},
  ) => {
    const id = `ENTREL-${scopeId}-${sourceId}-${relationType}-${targetId}`;
    if (existingRelationIds.has(id)) return;
    slice.relations.push({ id, type: relationType, sourceId, targetId, properties });
    existingRelationIds.add(id);
  };

  // 研究主体公司（通过 A 股代码匹配的）→ Product(s)
  const subjectCompanies = companies.filter((c) => c.id.startsWith("company-"));
  for (const company of subjectCompanies) {
    for (const product of products) {
      ensureRelation(company.id, product.id, "produces", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
  }

  // 研究主体公司 → 客户公司（下游客户，ID 以 customer- 开头）
  const customerCompanies = companies.filter((c) => c.id.startsWith("customer-"));
  for (const company of subjectCompanies) {
    for (const customer of customerCompanies) {
      ensureRelation(company.id, customer.id, "supplies_to", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
  }

  // Industry 包含同一范围内的 Company / Product
  for (const industry of industries) {
    for (const company of companies) {
      ensureRelation(industry.id, company.id, "contains", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
    for (const product of products) {
      ensureRelation(industry.id, product.id, "contains", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
  }

  // Company / Industry → Region（仅在中国大陆场景下生成，避免误挂政策上下文中的外国地域）
  // 地理位置关系对确定性推断来说噪声过高，仅当 scope 明确以中国大陆为主时才生成
  const hasChinaRegion = regions.some((r) => r.id.startsWith("region-中国大陆"));
  if (hasChinaRegion) {
    const chinaRegion = regions.find((r) => r.id.startsWith("region-中国大陆"))!;
    for (const company of companies) {
      ensureRelation(company.id, chinaRegion.id, "located_in", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
    for (const industry of industries) {
      ensureRelation(industry.id, chinaRegion.id, "located_in", {
        authority: "ontology_instance_inference",
        scope_ref: scopeId,
      });
    }
  }
}

export function materializeStageIntoGraph(
  current: BusinessInstanceGraph,
  stageKind: string,
  stageJson: Record<string, unknown>,
): BusinessInstanceGraph {
  const embedded = extractGraph(stageJson);
  if (embedded?.objects.length) {
    return mergeGraphs(
      { ...current, authority: "business_parameters" },
      markStageProjection(embedded, stageKind),
    );
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
          let resolved = true;
          let resolvedFromDomain = false;
          let domainProperties: Record<string, unknown> | null = null;
          if (dimension === "judgment_unit_ontology_node") {
            const typedInstance = parseTypedScopeMemberRef(objectId);
            if (typedInstance) {
              preferredType = typedInstance.type;
              name = typedInstance.name;
            } else {
              // JU 本体节点允许直接以裸 ID 引用领域业务图（business_instances.yaml）
              // 中的语义对象/状态变量；回查领域图解析真实类型与名称，避免权威门禁
              // 误杀合法领域引用（bindEvidenceRequirementsToOntology 在同一条审批链路中
              // 已回查领域图）。领域图也未命中的未知对象仍按原门禁拒绝。
              const domain = loadDomainBusinessGraph();
              const domainObject = domain?.objects.find((item) => item.id === objectId);
              if (domainObject) {
                preferredType = String(domainObject.type || "Industry");
                name = String((domainObject.properties as any)?.name || objectId);
                domainProperties = (domainObject.properties as Record<string, unknown>) || null;
                resolvedFromDomain = true;
              } else {
                resolved = false;
              }
            }
          }
          if (!resolved) {
            throw new Error(`JudgmentUnit 引用的本体对象未解析: ${objectId}`);
          }
          // 领域已知对象（如 StateVariable）保留真实类型入图；其余沿用原回落规则
          // （作用域成员类型或通用缺省回落 Industry）。
          const type = resolvedFromDomain
            ? preferredType
            : (SCOPE_MEMBER_TYPES_NAME_ONLY.has(preferredType) ? preferredType : "Industry");
          slice.objects.push({
            id: objectId,
            type,
            properties: resolvedFromDomain
              ? { ...(domainProperties || {}), name: name || objectId }
              : { name: name || objectId },
            projection: { section: "scope_members", index: slice.objects.filter((item) => item.type === type).length },
          });
          // 非作用域成员类型（如 StateVariable）按既有语义不挂接 scopeIncludesObject 关系，
          // 仅作为领域对象入图供规则引擎读取。
          if (!SCOPE_MEMBER_TYPES_NAME_ONLY.has(preferredType)) {
            return;
          }
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
      // 生成实体间业务关系：检测同一研究范围内 co-occurring 的实体类型组合，
      // 自动添加 Company↔Product、Company↔Customer 等业务语义关系，
      // 使「实体关系图」展示的不仅是指定范围，还有实体间的商业联系。
      generateEntityRelations(slice, scopeId);
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
    const stageVariables = Array.isArray(stageJson.variables) ? stageJson.variables as any[] : [];
    const stateVariableTargetByRuntimeId = new Map<string, string>();
    for (const [index, variable] of stageVariables.entries()) {
      const runtimeId = String(variable?.id || "").trim();
      const ontologyNodeId = String(variable?.ontology_node_id || "").trim();
      if (!runtimeId || !ontologyNodeId) continue;
      const targetId = ontologyNodeId === `task_local:${runtimeId}` ? runtimeId : ontologyNodeId;
      stateVariableTargetByRuntimeId.set(runtimeId, targetId);
      const exists = [...current.objects, ...slice.objects].some((item) => item.id === targetId);
      if (!exists) {
        slice.objects.push({
          id: targetId,
          type: "StateVariable",
          properties: {
            name: String(variable?.name || runtimeId),
            category: String(variable?.category || "task_specific"),
            definition: String(variable?.definition || variable?.name || runtimeId),
            variable_kind: String(variable?.variable_kind || "task_local"),
            anchors: Array.isArray(variable?.anchors) && variable.anchors.length
              ? variable.anchors.map(String)
              : [String(variable?.metric_ref || "task_scope")],
            variable_role: String(variable?.role || "judgment_input"),
            metric_ref: variable?.metric_ref ?? null,
            scope_ref: (stageJson.research_scope as any)?.id ?? null,
          },
          projection: { section: "variables", index },
        });
      }
    }
    const stagePaths = Array.isArray(stageJson.paths) ? stageJson.paths as any[] : [];
    const variableRolesByUnit = new Map<string, Map<string, string>>();
    const rolePriority = new Map([
      ["direct", 4],
      ["path_outcome", 3],
      ["path_input", 2],
      ["path_intermediate", 1],
    ]);
    const bindVariable = (unitId: string, variableId: string, role: string) => {
      if (!unitId || !stateVariableTargetByRuntimeId.has(variableId)) return;
      const currentRoles = variableRolesByUnit.get(unitId) || new Map<string, string>();
      const prior = currentRoles.get(variableId);
      if (!prior || Number(rolePriority.get(role) || 0) > Number(rolePriority.get(prior) || 0)) {
        currentRoles.set(variableId, role);
      }
      variableRolesByUnit.set(unitId, currentRoles);
    };
    for (const path of stagePaths) {
      const variableIds = Array.isArray(path?.variable_ids) ? path.variable_ids.map(String) : [];
      const unitIds = Array.isArray(path?.judgment_unit_ids)
        ? path.judgment_unit_ids.map(String)
        : Array.isArray(path?.linked_judgment_units)
          ? path.linked_judgment_units.map(String)
          : [];
      variableIds.forEach((variableId: string, variableIndex: number) => {
        const role = variableIndex === variableIds.length - 1
          ? "path_outcome"
          : variableIndex === 0
            ? "path_input"
            : "path_intermediate";
        unitIds.forEach((unitId: string) => bindVariable(unitId, variableId, role));
      });
    }

    for (const [index, unit] of ((stageJson.judgment_units as any[]) || []).entries()) {
      const unitId = String(unit.judgment_unit_id || unit.id || `JU-${index + 1}`);
      const ontologyRefs = new Set(
        Array.isArray(unit.ontology_node_ids || unit.target_ontology_object_refs)
          ? (unit.ontology_node_ids || unit.target_ontology_object_refs).map(String)
          : [],
      );
      for (const variable of stageVariables) {
        const runtimeId = String(variable?.id || "").trim();
        const ontologyNodeId = String(variable?.ontology_node_id || "").trim();
        if (ontologyRefs.has(runtimeId) || ontologyRefs.has(ontologyNodeId)) {
          bindVariable(unitId, runtimeId, "direct");
        }
      }
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
      for (const [runtimeVariableId, role] of variableRolesByUnit.get(unitId) || []) {
        const targetId = stateVariableTargetByRuntimeId.get(runtimeVariableId);
        if (!targetId) continue;
        slice.relations.push({
          id: `REL-${unitId}-STATE-${runtimeVariableId}`,
          type: "unitEvaluatesStateVariable",
          sourceId: unitId,
          targetId,
          properties: { role },
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
          evidence_profile_refs: Array.isArray(requirement.evidence_profile_refs)
            ? requirement.evidence_profile_refs.map(String)
            : [],
          evidence_recipe_ref: requirement.evidence_recipe_ref || null,
          derivation_refs: requirement.derivation_refs || null,
          no_profile_reason: requirement.no_profile_reason || null,
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
      const availableParameterIds = new Set(
        [...current.objects, ...slice.objects]
          .filter((item) => item.type === "EvidenceProfile" || item.type === "EvidenceRecipe")
          .map((item) => item.id),
      );
      for (const profileId of Array.isArray(requirement.evidence_profile_refs)
        ? requirement.evidence_profile_refs.map(String)
        : []) {
        if (!availableParameterIds.has(profileId)) continue;
        slice.relations.push({
          id: `RUNTIME-${requirementId}-PROFILE-${profileId}`,
          type: "requirementUsesEvidenceProfile",
          sourceId: requirementId,
          targetId: profileId,
          properties: { authority: "public_contract_1.3" },
        });
      }
      const recipeId = String(requirement.evidence_recipe_ref || "").trim();
      if (recipeId && availableParameterIds.has(recipeId)) {
        slice.relations.push({
          id: `RUNTIME-${requirementId}-RECIPE-${recipeId}`,
          type: "requirementGovernedByRecipe",
          sourceId: requirementId,
          targetId: recipeId,
          properties: { authority: "public_contract_1.3" },
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
    const requirementObjects = new Map(
      current.objects
        .filter((item) => item.type === "EvidenceRequirement")
        .map((item) => [item.id, item]),
    );
    const requirementAssessmentById = new Map<string, any>(
      ((stageJson.evidence_requirement_assessments as any[]) || [])
        .map((item): [string, any] => [String(item?.requirement_id || ""), item])
        .filter(([id]: [string, any]) => Boolean(id)),
    );
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
        // 缺口是“某个既有 ER 尚未满足”的运行状态，不是另一条新的
        // EvidenceRequirement。把它物化为 BlockingFactor，保留原 ER 主键。
        slice.objects.push({
          id: evidenceId,
          type: "BlockingFactor",
          properties: {
            ...draft,
            statement: draft.statement || draft.requirement,
            effect: draft.evidence_role === "counter" ? "level_cap" : "method_block",
            evidence_requirement_ids: draft.evidence_requirement_ids || [],
          },
          projection: { section: "evidence_drafts", index },
        });
        for (const unitId of draft.judgment_unit_ids || []) {
          slice.relations.push({
            id: `REL-${evidenceId}-UNIT-${unitId}`,
            type: "blockingFactorForUnit",
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
        const explicitRequirementIds = (draft.evidence_requirement_ids || [])
          .map(String)
          .filter((requirementId: string) => {
            const requirement = requirementObjects.get(requirementId);
            if (!requirement) return false;
            return String(requirement.properties?.evidence_role || "") === role
              && current.relations.some((relation) =>
                relation.type === "requirementForJudgmentUnit"
                && relation.sourceId === requirementId
                && relation.targetId === unitId,
              );
          });
        const compatibleRequirementIds = explicitRequirementIds.length
          ? explicitRequirementIds
          : [...requirementObjects.values()]
            .filter((requirement) =>
              String(requirement.properties?.evidence_role || "") === role
              && current.relations.some((relation) =>
                relation.type === "requirementForJudgmentUnit"
                && relation.sourceId === requirement.id
                && relation.targetId === unitId,
              ),
            )
            .map((requirement) => requirement.id);
        // 旧产物仅在同 JU+同角色唯一候选时兼容推断；多候选时不猜。
        const requirementIds = explicitRequirementIds.length
          ? explicitRequirementIds
          : compatibleRequirementIds.length === 1
            ? compatibleRequirementIds
            : [];
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
        for (const requirementId of requirementIds) {
          if (slice.relations.some((item) => item.id === `REL-${basketId}-REQ-${requirementId}`)) continue;
          const assessment = requirementAssessmentById.get(requirementId);
          const fulfillment = assessment?.status === "met"
            ? "met"
            : assessment?.status === "partial"
              ? "partially_met"
              : "unmet";
          slice.relations.push({
            id: `REL-${basketId}-REQ-${requirementId}`,
            type: "basketFulfillsRequirement",
            sourceId: basketId,
            targetId: requirementId,
            properties: { fulfillment },
          });
        }
      }
    }
  }
  if (stageKind === "stage_04") {
    materializeStage04(current, slice, stageJson, addObjects);
  }
  return mergeGraphs(
    { ...current, authority: "business_parameters" },
    markStageProjection(slice, stageKind),
  );
}

function markStageProjection(graph: BusinessInstanceGraph, stageKind: string): BusinessInstanceGraph {
  return {
    ...graph,
    objects: graph.objects.map((object) => ({
      ...object,
      properties: { ...(object.properties || {}) },
      projection: {
        ...(object.projection || {}),
        stage: stageKind,
        origin: "stage_projection",
      },
    })),
    relations: graph.relations.map((relation) => ({
      ...relation,
      properties: {
        ...(relation.properties || {}),
        projection_stage: stageKind,
        projection_origin: "stage_projection",
      },
    })),
  };
}
