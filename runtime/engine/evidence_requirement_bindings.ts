import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import { loadDomainBusinessGraph } from "./instance_graph";
import {
  resolveEvidenceRequirementsFromStructure,
  type EvidenceRequirementProjection,
} from "./structure_candidates";

export type EvidenceRequirementBindingIssue = {
  code:
    | "evidence_profile_binding_missing"
    | "evidence_profile_binding_mismatch"
    | "evidence_profile_ref_unknown"
    | "evidence_recipe_binding_missing"
    | "evidence_recipe_binding_mismatch"
    | "evidence_recipe_ref_unknown"
    | "evidence_recipe_binding_ambiguous";
  requirement_id: string;
  judgment_unit_ids: string[];
  detail: string;
  blocking: boolean;
};

type EvidenceMethodRegistry = {
  judgment_types?: Record<string, { evidence_recipe_ref?: string | null }>;
};

let cachedRecipeByJudgmentType: Map<string, string> | null = null;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    : [];
}

function recipeByJudgmentType(): Map<string, string> {
  if (cachedRecipeByJudgmentType) return cachedRecipeByJudgmentType;
  const registry = YAML.parse(
    readFileSync(repositoryPath("methods", "03_取证", "03_registry.yaml"), "utf8"),
  ) as EvidenceMethodRegistry;
  cachedRecipeByJudgmentType = new Map(
    Object.entries(registry.judgment_types || {}).flatMap(([judgmentType, config]) => {
      const ref = String(config?.evidence_recipe_ref || "").trim();
      return ref ? [[judgmentType, ref] as const] : [];
    }),
  );
  return cachedRecipeByJudgmentType;
}

export function resetEvidenceRequirementBindingsForTests(): void {
  cachedRecipeByJudgmentType = null;
}

/**
 * 将 Stage02 任务结构编译为显式的 ER→EvidenceProfile / EvidenceRecipe 引用。
 *
 * EvidenceProfile 与 EvidenceRecipe 是受治理的领域参数，不是核心事实对象。
 * 因此 Stage02 保存稳定参数引用和推导血缘；具体厂商、URL、MCP 与查询参数仍由
 * methods/03_取证/source_routes.yaml 负责。
 */
export function bindEvidenceRequirementsToOntology(
  structure: any,
): { requirements: EvidenceRequirementProjection[]; issues: EvidenceRequirementBindingIssue[] } {
  const units = Array.isArray(structure?.judgment_units) ? structure.judgment_units : [];
  const requirements = resolveEvidenceRequirementsFromStructure({
    units,
    evidence_requirements: structure?.evidence_requirements,
    counter_evidence_directions: structure?.counter_evidence_directions,
  });
  const graph = loadDomainBusinessGraph();
  const profileIds = new Set(
    (graph?.objects || []).filter((item) => item.type === "EvidenceProfile").map((item) => item.id),
  );
  const recipeIds = new Set(
    (graph?.objects || []).filter((item) => item.type === "EvidenceRecipe").map((item) => item.id),
  );
  const profileIdsByStateVariable = new Map<string, string[]>();
  for (const relation of graph?.relations || []) {
    if (relation.type !== "stateVariableUsesEvidenceProfile") continue;
    const current = profileIdsByStateVariable.get(String(relation.sourceId)) || [];
    current.push(String(relation.targetId));
    profileIdsByStateVariable.set(String(relation.sourceId), [...new Set(current)]);
  }

  const unitById = new Map<string, any>(
    units
      .map((unit: any): [string, any] => [String(unit?.id || ""), unit])
      .filter(([id]: [string, any]) => Boolean(id)),
  );
  const variableById = new Map<string, any>(
    (Array.isArray(structure?.variables) ? structure.variables : [])
      .map((variable: any): [string, any] => [String(variable?.id || ""), variable])
      .filter(([id]: [string, any]) => Boolean(id)),
  );
  const stateRefsByUnit = new Map<string, Set<string>>();
  const pathRefsByUnit = new Map<string, Set<string>>();
  const addStateRef = (unitId: string, ref: string) => {
    if (!unitId || !ref) return;
    const refs = stateRefsByUnit.get(unitId) || new Set<string>();
    refs.add(ref);
    stateRefsByUnit.set(unitId, refs);
  };

  for (const path of Array.isArray(structure?.paths) ? structure.paths : []) {
    const pathId = String(path?.id || "").trim();
    const unitIds = strings(path?.judgment_unit_ids || path?.linked_judgment_units);
    const variableIds = strings(path?.variable_ids);
    for (const unitId of unitIds) {
      const pathRefs = pathRefsByUnit.get(unitId) || new Set<string>();
      if (pathId) pathRefs.add(pathId);
      pathRefsByUnit.set(unitId, pathRefs);
      for (const variableId of variableIds) {
        const variable = variableById.get(variableId);
        addStateRef(unitId, String(variable?.ontology_node_id || variableId).trim());
      }
    }
  }
  for (const unit of units) {
    const unitId = String(unit?.id || "").trim();
    for (const ref of strings(unit?.ontology_node_ids)) {
      if (profileIdsByStateVariable.has(ref)) addStateRef(unitId, ref);
    }
  }

  const recipeRefs = recipeByJudgmentType();
  const issues: EvidenceRequirementBindingIssue[] = [];
  const bound = requirements.map((requirement): EvidenceRequirementProjection => {
    const stateVariableRefs = [
      ...new Set(requirement.judgment_unit_ids.flatMap((unitId) => [
        ...(stateRefsByUnit.get(String(unitId)) || []),
      ])),
    ];
    const formalStateRefs = stateVariableRefs.filter((ref) => !ref.startsWith("task_local:"));
    const inferredProfiles = [
      ...new Set(formalStateRefs.flatMap((ref) => profileIdsByStateVariable.get(ref) || [])),
    ];
    const explicitProfiles = strings(requirement.evidence_profile_refs);
    const unknownProfiles = explicitProfiles.filter((ref) => !profileIds.has(ref));
    if (unknownProfiles.length) {
      issues.push({
        code: "evidence_profile_ref_unknown",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: `EvidenceProfile 未登记：${unknownProfiles.join(", ")}`,
        blocking: true,
      });
    }
    const boundProfiles = explicitProfiles.length
      ? explicitProfiles.filter((ref) => profileIds.has(ref))
      : inferredProfiles;
    // 反向证据（evidence_role === "counter"）是跨判断类型的通用反驳画像；
    // 其取证画像（如 counter_evidence）本质不与状态变量推导画像相交，
    // 此类"不匹配"是预期内的，不应升级为 Stage02 阻断缺口。
    const isCounterRole = requirement.evidence_role === "counter";
    if (
      explicitProfiles.length
      && inferredProfiles.length
      && !boundProfiles.some((ref) => inferredProfiles.includes(ref))
    ) {
      issues.push({
        code: "evidence_profile_binding_mismatch",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: isCounterRole
          ? `反向证据画像与状态变量推导画像未直接相交（预期内，非阻断）：显式 ${boundProfiles.join(", ")}；推导 ${inferredProfiles.join(", ")}`
          : `EvidenceProfile 与 StateVariable 不相容：显式 ${boundProfiles.join(", ")}；推导 ${inferredProfiles.join(", ")}`,
        blocking: !isCounterRole,
      });
    }
    if (formalStateRefs.length && !boundProfiles.length) {
      issues.push({
        code: "evidence_profile_binding_missing",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: `正式 StateVariable 未配置 EvidenceProfile：${formalStateRefs.join(", ")}`,
        blocking: true,
      });
    }

    const inferredRecipes = [
      ...new Set(requirement.judgment_unit_ids.flatMap((unitId) => {
        const judgmentType = String(unitById.get(String(unitId))?.judgment_type || "");
        const ref = recipeRefs.get(judgmentType);
        return ref ? [ref] : [];
      })),
    ];
    const explicitRecipe = String(requirement.evidence_recipe_ref || "").trim();
    if (explicitRecipe && !recipeIds.has(explicitRecipe)) {
      issues.push({
        code: "evidence_recipe_ref_unknown",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: `EvidenceRecipe 未登记：${explicitRecipe}`,
        blocking: true,
      });
    }
    if (inferredRecipes.length > 1) {
      issues.push({
        code: "evidence_recipe_binding_ambiguous",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: `单条 EvidenceRequirement 跨越多个取证配方：${inferredRecipes.join(", ")}`,
        blocking: true,
      });
    }
    if (
      explicitRecipe
      && recipeIds.has(explicitRecipe)
      && inferredRecipes.length === 1
      && explicitRecipe !== inferredRecipes[0]
    ) {
      issues.push({
        code: "evidence_recipe_binding_mismatch",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: `EvidenceRecipe 与 JudgmentType 不相容：显式 ${explicitRecipe}；推导 ${inferredRecipes[0]}`,
        blocking: true,
      });
    }
    const evidenceRecipeRef = explicitRecipe && recipeIds.has(explicitRecipe)
      ? explicitRecipe
      : inferredRecipes[0] || null;
    if (!evidenceRecipeRef) {
      issues.push({
        code: "evidence_recipe_binding_missing",
        requirement_id: requirement.id,
        judgment_unit_ids: requirement.judgment_unit_ids,
        detail: "JudgmentType 未配置 EvidenceRecipe",
        blocking: true,
      });
    }

    const noProfileReason = boundProfiles.length
      ? null
      : formalStateRefs.length
        ? null
        : "task_local_or_unbound_state_variable";
    return {
      ...requirement,
      evidence_profile_refs: boundProfiles,
      evidence_recipe_ref: evidenceRecipeRef,
      derivation_refs: {
        judgment_unit_ref: requirement.judgment_unit_ids.length === 1
          ? requirement.judgment_unit_ids[0]
          : null,
        state_variable_refs: stateVariableRefs,
        path_refs: [
          ...new Set(requirement.judgment_unit_ids.flatMap((unitId) => [
            ...(pathRefsByUnit.get(String(unitId)) || []),
          ])),
        ],
      },
      no_profile_reason: noProfileReason,
    };
  });
  return { requirements: bound, issues };
}

/** 原地应用绑定，并把正式变量/配方缺口升级为 Stage02 阻断缺口。 */
export function applyEvidenceRequirementBindings(data: any): any {
  if (!data || typeof data !== "object") return data;
  const previouslyBlockedByBinding = Array.isArray(data.evidence_requirement_binding_issues)
    && data.evidence_requirement_binding_issues.some((issue: any) => issue?.blocking === true);
  const result = bindEvidenceRequirementsToOntology(data);
  data.evidence_requirements = result.requirements;
  data.evidence_requirement_binding_issues = result.issues;
  if (result.issues.some((issue) => issue.blocking)) {
    data.ontology_gap_scan_status = "blocking_gap";
    data.can_enter_03 = false;
  } else if (previouslyBlockedByBinding && data.ontology_gap_scan_status === "blocking_gap") {
    // 仅撤销由本绑定器写入的旧阻断；其它本体缺口状态不得被误清除。
    data.ontology_gap_scan_status = "minor_gap";
    data.can_enter_03 = true;
  }
  return data;
}
