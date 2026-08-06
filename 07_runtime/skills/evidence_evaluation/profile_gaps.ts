/**
 * ONTO-SUPPORT-001：用半导体业务参数图 EvidenceProfile 驱动证据缺口提示。
 * 参数图 ≠ 正式类型注册（ONTO-DOMAIN-001）；本模块只投影 minimum_requirements 等到证据台。
 */
import { loadDomainBusinessGraph, queryObjectSet } from "../ontology/instance_graph";
import { stripInternalReferencePrefix } from "../../runner/research_overview";

export type EvidenceProfileGapHint = {
  profile_id: string;
  profile_name: string;
  state_variable_ids: string[];
  minimum_requirements: string[];
  supporting_evidence: string[];
  counter_evidence: string[];
  downgrade_conditions: string[];
  scope_checks: string[];
  /** 与当前结构变量的交集 */
  matched_variable_ids: string[];
  matched_ontology_node_ids: string[];
  priority_score: number;
  researcher_statement: string;
  source: "evidence_profile";
};

type StructureVariable = {
  id?: string;
  name?: string;
  ontology_node_id?: string;
};

type JudgmentUnit = {
  id?: string;
  judgment_unit_id?: string;
  ontology_node_ids?: string[];
  variables?: string[];
};

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

/**
 * 按 Stage02 绑定的正式 StateVariable，展开关联 EvidenceProfile 的最低证据组合。
 * task_local 变量不挂正式 Profile（避免牵强）。
 */
export function buildEvidenceProfileGapHints(input: {
  variables?: StructureVariable[];
  judgment_units?: JudgmentUnit[];
  limit?: number;
}): EvidenceProfileGapHint[] {
  const graph = loadDomainBusinessGraph();
  if (!graph) return [];

  const profiles = queryObjectSet(graph, { type: "EvidenceProfile", limit: 200 }).objects;
  const profileById = new Map(profiles.map((object) => [object.id, object]));
  const profileEdges = graph.relations.filter((relation) => relation.type === "stateVariableUsesEvidenceProfile");

  const formalBindings = new Map<string, { variableIds: string[]; names: string[] }>();
  for (const variable of input.variables || []) {
    const ontologyRef = String(variable.ontology_node_id || "").trim();
    if (!ontologyRef || ontologyRef.startsWith("task_local:")) continue;
    const entry = formalBindings.get(ontologyRef) || { variableIds: [], names: [] };
    const vid = String(variable.id || "").trim();
    if (vid) entry.variableIds.push(vid);
    const name = String(variable.name || "").trim();
    if (name) entry.names.push(name);
    formalBindings.set(ontologyRef, entry);
  }
  for (const unit of input.judgment_units || []) {
    for (const ref of asStringList(unit.ontology_node_ids)) {
      if (ref.startsWith("task_local:")) continue;
      if (!formalBindings.has(ref)) formalBindings.set(ref, { variableIds: [], names: [] });
    }
  }

  if (!formalBindings.size) return [];

  const byProfile = new Map<string, {
    profile_id: string;
    state_variable_ids: string[];
    matched_variable_ids: string[];
    matched_ontology_node_ids: string[];
  }>();

  for (const edge of profileEdges) {
    const variableId = String(edge.sourceId || "").trim();
    const profileId = String(edge.targetId || "").trim();
    if (!variableId || !profileId || !profileById.has(profileId)) continue;
    const binding = formalBindings.get(variableId);
    if (!binding) continue;
    const current = byProfile.get(profileId) || {
      profile_id: profileId,
      state_variable_ids: [],
      matched_variable_ids: [],
      matched_ontology_node_ids: [],
    };
    if (!current.state_variable_ids.includes(variableId)) current.state_variable_ids.push(variableId);
    if (!current.matched_ontology_node_ids.includes(variableId)) current.matched_ontology_node_ids.push(variableId);
    for (const vid of binding.variableIds) {
      if (!current.matched_variable_ids.includes(vid)) current.matched_variable_ids.push(vid);
    }
    byProfile.set(profileId, current);
  }

  const limit = input.limit ?? 3;
  const hints: EvidenceProfileGapHint[] = [];

  for (const entry of byProfile.values()) {
    const profile = profileById.get(entry.profile_id);
    if (!profile) continue;
    const props = profile.properties || {};
    const name = String(props.name || entry.profile_id);
    const minimum = asStringList(props.minimum_requirements);
    const supporting = asStringList(props.supporting_evidence);
    const counter = asStringList(props.counter_evidence);
    const downgrade = asStringList(props.downgrade_conditions);
    const scopeChecks = asStringList(props.scope_checks);
    const topRequirement = minimum[0] || supporting[0] || "补齐该变量对应的最低证据组合";
    const priority_score = entry.matched_ontology_node_ids.length * 10
      + minimum.length * 4
      + counter.length * 2
      + (String(props.quality_floor || "").startsWith("Q3") ? 5 : 0);

    hints.push({
      profile_id: entry.profile_id,
      profile_name: name,
      state_variable_ids: entry.state_variable_ids,
      minimum_requirements: minimum,
      supporting_evidence: supporting,
      counter_evidence: counter,
      downgrade_conditions: downgrade,
      scope_checks: scopeChecks,
      matched_variable_ids: entry.matched_variable_ids,
      matched_ontology_node_ids: entry.matched_ontology_node_ids,
      priority_score,
      researcher_statement: stripInternalReferencePrefix(
        `按证据剖面「${name}」：${topRequirement}`,
      ),
      source: "evidence_profile",
    });
  }

  return hints
    .sort((a, b) => b.priority_score - a.priority_score || a.profile_id.localeCompare(b.profile_id))
    .slice(0, limit);
}

/** 合并进 prioritizeEvidenceGaps 可用的伪缺口条目（只用于排序展示，不写入产物） */
export function profileHintsAsGapPriorities(hints: EvidenceProfileGapHint[]) {
  return hints.map((hint, index) => ({
    evidence_id: `PROFILE:${hint.profile_id}`,
    tier: index === 0 ? "blocking" as const : "limiting" as const,
    label: index === 0 ? "阻断主判断" as const : "限制判断强度" as const,
    statement: hint.researcher_statement,
    reason: `来自业务参数图 EvidenceProfile「${hint.profile_name}」（${hint.profile_id}）；绑定变量 ${hint.matched_ontology_node_ids.join("、") || "—"}。最低要求：${hint.minimum_requirements.slice(0, 2).join("；") || "见剖面"}。`,
    score: hint.priority_score,
    profile_id: hint.profile_id,
    source: "evidence_profile" as const,
  }));
}
