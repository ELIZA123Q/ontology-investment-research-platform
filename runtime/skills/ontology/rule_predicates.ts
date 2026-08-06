/**
 * ONTO-SSOT-003：正式规则命名谓词表。
 * facts 键应与 ontology models/*.yaml 的 condition / counter_conditions 原子对齐；
 * Runtime 分支只负责填事实，通过/失败由 decideFromRuleDef 解释 YAML。
 */
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";
import { formalRuleDef, loadFormalOntologyRules } from "./rule_defs";

function blockingSemanticRuleIds(): string[] {
  const registry = YAML.parse(
    readFileSync(repositoryPath("governance/02_合同/rule_authority_registry.yaml"), "utf8"),
  ) as {
    formal_ontology_rules?: Record<string, { execution_surface?: string; blocking?: boolean }>;
  };
  return Object.entries(registry.formal_ontology_rules || {})
    .filter(([, rule]) =>
      rule?.execution_surface === "runtime_semantic_execution" && rule?.blocking === true)
    .map(([id]) => id)
    .sort();
}

export type RulePredicateEntry = {
  rule_id: string;
  yaml_condition: string;
  yaml_counters: string[];
  /** Runtime 应填入 decideFromRuleDef 的事实键（含 condition 与 counter 原子） */
  runtime_fact_keys: string[];
  /** 仍由 Runtime 额外执行、尚未写入 YAML 的扩展检查 */
  runtime_extensions?: string[];
  notes?: string;
};

function atomsFromExpression(expression: string): string[] {
  return String(expression || "")
    .split(/\s+or\s+/)
    .flatMap((clause) => clause.split(/\s+and\s+/))
    .map((atom) => atom.trim())
    .filter(Boolean)
    .map((atom) => {
      const inMatch = /^([A-Za-z_][\w.]*)\s+in\s+\[/.exec(atom);
      return inMatch ? inMatch[1] : atom;
    });
}

/** 从 YAML 派生的权威谓词键（每条 REQUIRED_RULE） */
export function predicateKeysForRule(ruleId: string): string[] {
  const def = formalRuleDef(ruleId);
  if (!def) return [];
  return [...new Set([
    ...atomsFromExpression(def.condition),
    ...def.counter_conditions.map((item) => item.trim()).filter(Boolean),
  ])];
}

/**
 * 手工注释层：说明 Runtime 事实填充约定与尚存扩展。
 * 新增 REQUIRED_RULES 时须同步补全本表或依赖 YAML 自动派生。
 */
export const RULE_PREDICATE_NOTES: Record<string, Pick<RulePredicateEntry, "runtime_extensions" | "notes">> = {
  evidence_scope_time_alignment: {
    notes: "Runtime 以 scope_alignment/time_alignment 条件结果表达；谓词 subject_time_scope_unit_aligned 对应无跨范围且时间不晚于截止。",
  },
  no_direct_evidence_to_judgment: {
    notes: "Runtime 将「证据经 Signal/Hypothesis」映射为非 target_type_is_Judgment；YAML condition 的 target_type in [...] 由派生谓词解释。",
  },
  judgment_reference_integrity: {
    notes: "事实键对应 unit/hypothesis/signal/rule 可解析与双向绑定。",
  },
  judgment_evidence_threshold: {
    notes: "level_within_evidence_ceiling 由 120 组合矩阵派生；scope_aligned/counterevidence_resolved 参与上限。",
  },
  judgment_status_consistency: {
    runtime_extensions: ["j0_status_inconsistent", "high_j_with_active_competition"],
    notes: "YAML 三条件 + 三 counter；J0 与竞争解释过强为 Runtime 扩展挡门。",
  },
  expectation_projection_integrity: {
    notes: "非 expectation_gap/valuation_impact 类型时两条件视为满足。",
  },
  valuation_hypothesis_level_coupling: {
    notes: "已走 decideFromRuleDef；事实键与 YAML 一致。",
  },
  risk_exposure_blocking_linkage: {
    notes: "已走 decideFromRuleDef；事实键与 YAML 一致。",
  },
  value_chain_propagation_consistency: {
    notes: "已走 decideFromRuleDef；事实键与 YAML 一致。",
  },
  state_time_consistency: {
    notes: "observation_time_aligned + snapshots_are_immutable。",
  },
  semiconductor_proxy_disclosure: {
    notes: "无代理证据时 proxy_lag_scope_and_non_substitution_disclosed 视为真。",
  },
  semiconductor_qualification_stage_alignment: {
    notes: "无商业化主张或 J0 无事实时跳过；缺元数据 → blocked。",
  },
  semiconductor_capacity_yield_scope_alignment: {
    notes: "六维口径：设施、晶圆、制程/产品、批次、单位、业务时间。",
  },
};

export function buildRulePredicateCatalog(): RulePredicateEntry[] {
  return blockingSemanticRuleIds().map((rule_id) => {
    const def = formalRuleDef(rule_id);
    const notes = RULE_PREDICATE_NOTES[rule_id] || {};
    return {
      rule_id,
      yaml_condition: def?.condition || "",
      yaml_counters: def?.counter_conditions || [],
      runtime_fact_keys: predicateKeysForRule(rule_id),
      ...notes,
    };
  });
}

export function assertPredicateCatalogCoversRequiredRules(): {
  ok: boolean;
  missing_yaml: string[];
  empty_keys: string[];
} {
  const required = blockingSemanticRuleIds();
  const rules = loadFormalOntologyRules();
  const missing_yaml = required.filter((id) => !rules.has(id));
  const empty_keys = required.filter((id) => predicateKeysForRule(id).length === 0);
  return { ok: missing_yaml.length === 0 && empty_keys.length === 0, missing_yaml, empty_keys };
}

/** Stage03 可预检（事实侧即可判定）的规则子集 */
export const STAGE03_PRECHECK_RULES = [
  "semiconductor_proxy_disclosure",
  "semiconductor_qualification_stage_alignment",
  "semiconductor_capacity_yield_scope_alignment",
  "evidence_scope_time_alignment",
] as const;

export type Stage03PrecheckRuleId = (typeof STAGE03_PRECHECK_RULES)[number];
