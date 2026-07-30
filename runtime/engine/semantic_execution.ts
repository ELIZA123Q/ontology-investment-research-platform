import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import {
ONTOLOGY_JUDGMENT_LEVELS,
type OntologyConfidenceLevel,
type OntologyJudgmentLevel,
} from "./ontology_vocabulary.generated";
import {
  computeRule,
  slug,
  sourceGroup,
  sourceTierNumber,
  uniqueById,
} from "./semantic_rule_compute";
import type { SourceRecord } from "./types";

type EvidenceDraft = {
  id: string;
  kind?: string;
  direction?: string;
  directness?: "direct" | "indirect" | "proxy";
  source_ids?: string[];
  source_keys?: string[];
  scope_ref?: string;
  observed_at?: string;
  valid_from?: string;
  valid_to?: string | null;
  published_at?: string;
  cutoff_at?: string;
  limitations?: string[];
  proxy_disclosure?: {
    lag: string | null;
    scope: string | null;
    non_substitution: string | null;
  } | null;
  commercialization_stage?: CommercializationStage | null;
  qualification_scope?: QualificationScope | null;
  semiconductor_measurement?: SemiconductorMeasurement | null;
};
type CommercializationStage = "concept" | "sample" | "customer_evaluation" | "qualification" | "design_win" | "pilot" | "mass_production" | "repeat_purchase" | "scale_adoption";
type QualificationScope = {
  product_spec_ref: string | null;
  customer_ref: string | null;
  facility_ref: string | null;
};
type SemiconductorMetricKind = "capacity" | "yield";
type SemiconductorMeasurement = {
  metric_kind: SemiconductorMetricKind;
  facility_ref: string | null;
  wafer_size: string | null;
  process_or_product_ref: string | null;
  batch_stage: string | null;
  unit: string | null;
  business_time_basis: string | null;
};
type RuleResult = "pass" | "fail" | "contested" | "blocked";
type RuleEvaluation = {
  id: string;
  rule_ref: string;
  judgment_id?: string;
  input_refs: string[];
  condition_results: Array<{ condition_id: string; expression: string; input_refs: string[]; outcome: RuleResult; rationale: string }>;
  result: RuleResult;
  deterministic_result?: { engine_version: string; result: RuleResult; rationale: string; evaluated_at: string };
};

export const ENGINE_VERSION = "runtime-semantic-rules-3.1.0";

/** 从规则权威表派生：blocking + runtime_semantic_execution。本体 YAML 为定义源，本表为执行面权威。 */
export function loadBlockingSemanticRuleIds(): string[] {
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

/** Runtime 确定性重算并挡门的正式规则。关系端点兼容见 graph_contract.validateRuntimeGraph。 */
export const REQUIRED_RULES: readonly string[] = loadBlockingSemanticRuleIds();

const LEVEL = Object.fromEntries(
  ONTOLOGY_JUDGMENT_LEVELS.map((level, index) => [level, index]),
) as Record<OntologyJudgmentLevel, number>;
type JudgmentLevel = OntologyJudgmentLevel;

/** Runtime 产物常用 strength；正式本体属性为 level。读取时兼容两者。 */
export function judgmentStrength(judgment: any): string {
  return String(judgment?.strength || judgment?.level || "");
}
type EvidenceGrade = "Q0" | "Q1" | "Q2" | "Q3" | "Q4";
type CounterevidenceResult = "cleared" | "weakened" | "contested" | "decisive" | "not_checked" | "not_applicable";
type PathReadinessStatus = "ready" | "restricted" | "blocked" | "not_applicable";

/**
 * 状态派生矩阵 — 唯一权威来源: governance/02_合同/judgment_threshold_policy.yaml
 * 120 种组合 (5 evidence × 6 counterevidence × 4 path_readiness)
 * invariant: max_level = min(evidence_cap, counterevidence_cap, path_readiness_cap)
 */
const EVIDENCE_GRADE_CAPS: Record<EvidenceGrade, JudgmentLevel> = { Q0: "J0", Q1: "J1", Q2: "J2", Q3: "J3", Q4: "J4" };
const COUNTEREVIDENCE_CAPS: Record<CounterevidenceResult, JudgmentLevel> = { cleared: "J4", weakened: "J2", contested: "J1", decisive: "J0", not_checked: "J1", not_applicable: "J4" };
const PATH_READINESS_CAPS: Record<PathReadinessStatus, JudgmentLevel> = { ready: "J4", restricted: "J2", blocked: "J0", not_applicable: "J4" };

/** 根据证据等级映射标准质量描述词汇到 Q 等级 */
export function evidenceGradeFromQuality(quality: string): EvidenceGrade {
  const q = quality.toLowerCase();
  if (q === "充分" || q === "sufficient") return "Q3"; // Q3-Q4, 取保守
  if (q === "受限" || q === "limited") return "Q2";
  if (q === "观察" || q === "observation") return "Q1";
  return "Q0"; // 不可用 / unusable
}

/** 根据证据草稿和来源计算 evidence grade (Q0-Q4) */
export function computeEvidenceGrade(facts: EvidenceDraft[], sourceGroups: Set<string>, qualifiedGroups: Set<string>, directFacts: number): EvidenceGrade {
  if (!facts.length || sourceGroups.size === 0) return "Q0";
  if (facts.length >= 4 && qualifiedGroups.size >= 4 && directFacts >= 3) return "Q4";
  if (facts.length >= 3 && qualifiedGroups.size >= 3 && directFacts >= 2) return "Q3";
  if (facts.length >= 2 && qualifiedGroups.size >= 2 && directFacts >= 1) return "Q2";
  return "Q1";
}

/** 根据冲突状态推导 counterevidence result */
export function deriveCounterevidenceResult(conflictStatus: string, counterEvidenceCount: number, hasUnresolvedCompetition: boolean, hasDeceptiveConflict: boolean): CounterevidenceResult {
  if (hasDeceptiveConflict) return "decisive";
  if (hasUnresolvedCompetition) return "contested";
  if (conflictStatus === "resolved" && counterEvidenceCount > 0) return "weakened";
  if (conflictStatus === "resolved" || conflictStatus === "none") return "cleared";
  return "not_checked";
}

/**
 * 状态派生矩阵核心函数 — 120 种组合完整覆盖
 * @returns 最大允许判断等级 (J0-J4) 与限制原因
 */
export function deriveMaxJudgmentLevel(
  evidenceGrade: EvidenceGrade,
  counterevidenceResult: CounterevidenceResult,
  pathReadiness: PathReadinessStatus,
): { maxLevel: JudgmentLevel; reasons: string[] } {
  const evidenceCap = LEVEL[EVIDENCE_GRADE_CAPS[evidenceGrade]];
  const counterevidenceCap = LEVEL[COUNTEREVIDENCE_CAPS[counterevidenceResult]];
  const pathCap = LEVEL[PATH_READINESS_CAPS[pathReadiness]];
  const max = Math.min(evidenceCap, counterevidenceCap, pathCap);
  const levelKeys = ONTOLOGY_JUDGMENT_LEVELS;
  const maxLevel = levelKeys.find((k) => LEVEL[k] === max) || "J0";

  const reasons: string[] = [];
  const caps = [
    { name: "证据等级", value: evidenceGrade, cap: EVIDENCE_GRADE_CAPS[evidenceGrade], clamped: evidenceCap < 4 },
    { name: "反证结果", value: counterevidenceResult, cap: COUNTEREVIDENCE_CAPS[counterevidenceResult], clamped: counterevidenceCap < 4 },
    { name: "路径就绪", value: pathReadiness, cap: PATH_READINESS_CAPS[pathReadiness], clamped: pathCap < 4 },
  ];
  for (const cap of caps) {
    if (cap.clamped && LEVEL[cap.cap] === max) {
      reasons.push(`${cap.name}(${cap.value}) 限制上限为 ${cap.cap}`);
    }
  }
  if (!reasons.length) reasons.push("所有维度无限制，可达 J4");

  return { maxLevel, reasons };
}

/** 完整推导链：从原始数据到最大判断等级 */
export function deriveMaxJudgmentLevelFromData(
  judgment: any,
  facts: EvidenceDraft[],
  sources: SourceRecord[],
): { maxLevel: JudgmentLevel; evidenceGrade: EvidenceGrade; counterevidenceResult: CounterevidenceResult; pathReadiness: PathReadinessStatus; reasons: string[] } {
  const sourceGroups = new Set(sources.map(sourceGroup));
  const qualifiedSources = sources.filter((s) => sourceTierNumber(s.source_tier) <= 6);
  const qualifiedGroups = new Set(qualifiedSources.map(sourceGroup));
  const directFacts = facts.filter((f) => f.directness === "direct").length;
  const evidenceGrade = computeEvidenceGrade(facts, sourceGroups, qualifiedGroups, directFacts);

  const counterCount = (judgment.counter_evidence_draft_ids || []).length;
  const decisive = judgment.conflict_status === "decisive";
  const unresolved = judgment.conflict_status === "unresolved";
  const counterevidenceResult = deriveCounterevidenceResult(
    String(judgment.conflict_status || "not_checked"),
    counterCount,
    unresolved && !decisive,
    decisive,
  );

  // Path readiness: 从 judgment 的 path_result_status 推导
  const pathStatus = String(judgment.path_result_status || "");
  const pathReadiness = pathStatusToReadiness(pathStatus);

  const { maxLevel, reasons } = deriveMaxJudgmentLevel(evidenceGrade, counterevidenceResult, pathReadiness);
  return { maxLevel, evidenceGrade, counterevidenceResult, pathReadiness, reasons };
}

function pathStatusToReadiness(status: string): PathReadinessStatus {
  const s = status.toLowerCase();
  if (s === "established") return "ready";
  if (s === "partially_established" || s === "weakened") return "restricted";
  if (s === "blocked" || s === "insufficient_evidence") return "blocked";
  if (s === "contested") return "restricted";
  return "not_applicable";
}

/**
 * CalculateConfidence — 确定性 confidence 计算
 * 唯一权威: runtime/engine/runtime_operations.yaml#CalculateConfidence
 *
 * 输入: evidence_grade, source_diversity_score, direct_fact_ratio, has_conflict
 * 输出: "low" | "medium" | "high"
 *
 * 规则:
 *   Q0 → low (无有效证据)
 *   Q1 → low (仅观察级别)
 *   Q2 → low/medium (source_diversity >= 2 且无冲突 → medium)
 *   Q3 → medium/high (direct_fact_ratio >= 0.5 且无冲突 → high)
 *   Q4 → high (充分证据且无决定性冲突)
 *   有冲突 → 降一级 (high→medium, medium→low, low 不变)
 */
export type ConfidenceLevel = OntologyConfidenceLevel;

export function calculateConfidence(params: {
  evidenceGrade: EvidenceGrade;
  sourceGroupCount: number;
  directFactCount: number;
  totalFactCount: number;
  hasConflict: boolean;
  hasUnresolvedCompetition: boolean;
}): ConfidenceLevel {
  const { evidenceGrade, sourceGroupCount, directFactCount, totalFactCount, hasConflict, hasUnresolvedCompetition } = params;
  const directRatio = totalFactCount > 0 ? directFactCount / totalFactCount : 0;

  let base: ConfidenceLevel = "low";
  switch (evidenceGrade) {
    case "Q0":
      base = "low";
      break;
    case "Q1":
      base = "low";
      break;
    case "Q2":
      base = sourceGroupCount >= 2 && directFactCount >= 1 ? "medium" : "low";
      break;
    case "Q3":
      base = directRatio >= 0.5 && sourceGroupCount >= 3 ? "high" : "medium";
      break;
    case "Q4":
      base = directRatio >= 0.6 && sourceGroupCount >= 4 ? "high" : "medium";
      break;
  }

  // 冲突降级
  if (hasConflict || hasUnresolvedCompetition) {
    if (base === "high") return "medium";
    if (base === "medium") return "low";
    return "low";
  }

  return base;
}

/**
 * 为所有 Judgment 执行确定性 confidence 计算
 * 在 applyDeterministicRuleEvaluations 中调用
 */
export function applyDeterministicConfidence(data: any, evidenceDrafts: EvidenceDraft[], sources: SourceRecord[]) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const evidenceMap = new Map(evidenceDrafts.map((e) => [e.id, e]));

  for (const judgment of data.judgments || []) {
    const evidenceIds: string[] = [
      ...(judgment.supporting_evidence_draft_ids || []),
      ...(judgment.counter_evidence_draft_ids || []),
    ].map(String);
    const facts = evidenceIds.map((id) => evidenceMap.get(id)).filter(Boolean) as EvidenceDraft[];
    const boundSources = uniqueById(
      facts.flatMap((f) => (f.source_ids || []).map((sid) => sourceMap.get(sid)).filter(Boolean) as SourceRecord[])
    );
    const sourceGroups = new Set(boundSources.map(sourceGroup));
    const directFacts = facts.filter((f) => f.directness === "direct").length;
    const hasConflict = judgment.conflict_status === "unresolved" || judgment.conflict_status === "decisive"
      || (judgment.counter_evidence_draft_ids || []).length > 0;

    const evidenceGrade = computeEvidenceGrade(facts, sourceGroups,
      new Set(boundSources.filter((s) => sourceTierNumber(s.source_tier) <= 6).map(sourceGroup)), directFacts);

    const computedConfidence = calculateConfidence({
      evidenceGrade,
      sourceGroupCount: sourceGroups.size,
      directFactCount: directFacts,
      totalFactCount: facts.length,
      hasConflict,
      hasUnresolvedCompetition: judgment.conflict_status === "unresolved",
    });

    judgment.confidence = computedConfidence;
    judgment._confidence_calc = {
      engine: ENGINE_VERSION,
      inputs: { evidenceGrade, sourceGroups: sourceGroups.size, directFacts, totalFacts: facts.length, hasConflict },
      result: computedConfidence,
      evaluated_at: new Date().toISOString(),
    };
  }
  return data;
}
const SEMANTIC_RULE_DEPENDENCIES = {
  level: LEVEL,
  computeEvidenceGrade,
  deriveCounterevidenceResult,
  deriveMaxJudgmentLevel,
  judgmentStrength,
  pathStatusToReadiness,
};

export function applyDeterministicRuleEvaluations(
  data: any,
  evidenceDrafts: EvidenceDraft[],
  sources: SourceRecord[],
  structure: any = {},
) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const evidenceMap = new Map(evidenceDrafts.map((evidence) => [evidence.id, evidence]));

  // 先把模型请求强度收敛到证据上限，再执行状态一致性等其它规则。
  // 否则“请求 J3、上限 J1”会先触发 high-J consistency fail，继而被误判为
  // 实质阻断并清空事实链，失去本可交付的 J1 观察。
  for (const judgment of data.judgments || []) {
    const computed = computeRule(
      "judgment_evidence_threshold",
      judgment,
      data,
      evidenceMap,
      sourceMap,
      structure,
      SEMANTIC_RULE_DEPENDENCIES,
    );
    if (computed.result !== "fail") continue;
    const match = /上限\s+(J[0-4])/.exec(computed.rationale);
    const ceiling = match?.[1] as JudgmentLevel | undefined;
    if (!ceiling || !Object.hasOwn(LEVEL, ceiling) || LEVEL[ceiling] <= 0) continue;
    const requested = judgmentStrength(judgment);
    judgment.strength = ceiling;
    judgment.level = ceiling;
    judgment.not_judgeable_reason = null;
    judgment.rationale = [
      `Runtime 按证据、反证与路径状态将原请求 ${requested} 收敛至 ${ceiling}；保留可核验事实链，不把强度降级误写成无判断。`,
      String(judgment.rationale || "").trim(),
    ].filter(Boolean).join(" ");
  }

  const materialize = () => {
    const priorById = new Map<string, RuleEvaluation>(
      ((data.rule_evaluations || []) as RuleEvaluation[]).map((item) => [String(item.id), item]),
    );
    const retained = ((data.rule_evaluations || []) as RuleEvaluation[])
      .filter((item) => !REQUIRED_RULES.includes(String(item.rule_ref)));
    const generated: RuleEvaluation[] = [];
    for (const judgment of data.judgments || []) {
      const judgmentId = String(judgment.id || judgment.judgment_id || "");
      if (!judgmentId) throw new Error("Judgment 缺少稳定 ID，无法执行确定性规则");
      const ruleIds: string[] = [];
      for (const ruleRef of REQUIRED_RULES) {
        const computed = computeRule(
          ruleRef,
          judgment,
          data,
          evidenceMap,
          sourceMap,
          structure,
          SEMANTIC_RULE_DEPENDENCIES,
        );
        const id = `RE-SYS-${slug(judgmentId)}-${slug(ruleRef)}`;
        generated.push({
          id,
          rule_ref: ruleRef,
          judgment_id: judgmentId,
          input_refs: computed.inputRefs,
          condition_results: computed.conditions,
          result: computed.result,
          deterministic_result: {
            engine_version: ENGINE_VERSION,
            result: computed.result,
            rationale: computed.rationale,
            evaluated_at: new Date().toISOString(),
          },
        });
        ruleIds.push(id);
      }
      // 正式规则一律以 RE-SYS 为准；剔除伪造/陈旧的同名规则评估引用。
      const retainedRefs = (judgment.rule_evaluation_ids || []).filter((id: string) => {
        if (String(id).startsWith("RE-SYS-")) return false;
        const prior = priorById.get(String(id));
        return Boolean(prior) && !REQUIRED_RULES.includes(String(prior!.rule_ref));
      });
      judgment.rule_evaluation_ids = [...new Set([...retainedRefs, ...ruleIds])];
    }
    data.rule_evaluations = [...retained, ...generated];
    const generatedIds = new Set(generated.map((item) => item.id));
    for (const trace of data.reasoning_traces || []) {
      const judgmentId = String(trace.judgment_id || trace.judgment_ref || "");
      const ids = generated.filter((item) => item.judgment_id === judgmentId).map((item) => item.id);
      const kept = (trace.node_ids || trace.node_refs || []).filter((id: string) => {
        if (generatedIds.has(String(id))) return true;
        if (String(id).startsWith("RE-SYS-")) return false;
        const prior = priorById.get(String(id));
        return !prior || !REQUIRED_RULES.includes(String(prior.rule_ref));
      });
      trace.node_ids = [...new Set([...kept, ...ids])];
      if (trace.node_refs) trace.node_refs = trace.node_ids;
    }
    for (const judgment of data.judgments || []) {
      judgment.rule_evaluation_ids = (judgment.rule_evaluation_ids || [])
        .filter((id: string) => !String(id).startsWith("RE-SYS-") || generatedIds.has(id));
    }
    return generated;
  };

  let generated = materialize();
  const blocked = collectBlockingRuleEvaluations(data, generated);
  if (blocked.size) {
    demoteJudgmentsForBlockingRules(data, blocked, structure);
    generated = materialize();
  }
  assertDeterministicRuleResults(data);
  // A2: 确定性 confidence 计算 — 权重不依赖 AI 模型自由裁量
  applyDeterministicConfidence(data, evidenceDrafts, sources);
  // 正式本体属性为 level；Runtime 产物常用 strength。重算后双向对齐。
  for (const judgment of data.judgments || []) {
    if (judgment.strength) judgment.level = judgment.strength;
    else if (judgment.level) judgment.strength = judgment.level;
  }
  return data;
}

function collectBlockingRuleEvaluations(data: any, generated: RuleEvaluation[]) {
  const byJudgment = new Map<string, RuleEvaluation[]>();
  for (const evaluation of generated) {
    if (evaluation.result !== "fail" && evaluation.result !== "blocked") continue;
    const judgmentId = String(evaluation.judgment_id || "");
    byJudgment.set(judgmentId, [...(byJudgment.get(judgmentId) || []), evaluation]);
  }
  return byJudgment;
}

function thresholdCeiling(evaluation: RuleEvaluation): JudgmentLevel | null {
  if (evaluation.rule_ref !== "judgment_evidence_threshold") return null;
  const match = /上限\s+(J[0-4])/.exec(String(evaluation.deterministic_result?.rationale || ""));
  const level = match?.[1] as JudgmentLevel | undefined;
  return level && Object.hasOwn(LEVEL, level) ? level : null;
}

/**
 * 正式规则 fail/blocked 的处置：
 * - 证据等级只限制强度时，收敛到可支持的上限并保留事实链；
 * - 口径、时间、引用等实质阻断仍降为 J0，并清空越界事实绑定。
 *
 * “请求 J3、证据只支持 J2”是可用的受限判断，不应被错误处理成“完全不可判断”。
 */
function demoteJudgmentsForBlockingRules(data: any, blocked: Map<string, RuleEvaluation[]>, structure: any = {}) {
  const unitIds = (structure.judgment_units || []).map((item: any) => String(item.id || "")).filter(Boolean);
  const scopeRef = String(structure.research_scope?.id || unitIds[0] || "SCOPE-UNKNOWN");
  const hypotheses = Array.isArray(data.hypotheses) ? [...data.hypotheses] : [];
  for (const judgment of data.judgments || []) {
    const judgmentId = String(judgment.id || judgment.judgment_id || "");
    const blockers = blocked.get(judgmentId);
    if (!blockers?.length) continue;
    const substantiveBlockers = blockers.filter((item) => item.rule_ref !== "judgment_evidence_threshold");
    const ceiling = blockers.map(thresholdCeiling).find((item): item is JudgmentLevel => Boolean(item));
    if (!substantiveBlockers.length && ceiling && LEVEL[ceiling] > 0) {
      const requested = judgmentStrength(judgment);
      judgment.strength = ceiling;
      judgment.level = ceiling;
      judgment.not_judgeable_reason = null;
      judgment.rationale = [
        `Runtime 按证据、反证与路径状态将原请求 ${requested} 收敛至 ${ceiling}；保留可核验事实链，不把强度降级误写成无判断。`,
        String(judgment.rationale || "").trim(),
      ].filter(Boolean).join(" ");
      continue;
    }
    const reasons = blockers.map((item) => `${item.rule_ref}: ${item.deterministic_result?.rationale || item.result}`);
    let unitId = String(judgment.judgment_unit_id || "");
    if (!unitIds.includes(unitId)) {
      const matched = unitIds.find((id: string) => judgmentId.includes(id) || id.includes(unitId));
      unitId = matched || unitIds[0] || unitId || "JU-UNKNOWN";
    }
    let hypothesisIds = Array.isArray(judgment.hypothesis_ids) ? judgment.hypothesis_ids.map(String) : [];
    hypothesisIds = hypothesisIds.filter((id: string) => hypotheses.some((item: any) => String(item.id) === id));
    if (!hypothesisIds.length) {
      const hypothesisId = `H-REPAIR-${judgmentId}`;
      hypotheses.push({
        id: hypothesisId,
        statement: `${unitId} 的方向命题目前未被可核验事实充分检验`,
        signal_ids: [],
        falsification_conditions: ["取得同口径可核验反证或补齐关键证据"],
        time_horizon: "补齐证据后重新裁决",
        judgment_unit_ids: unitId ? [unitId] : [],
      });
      hypothesisIds = [hypothesisId];
    } else {
      for (const hypothesisId of hypothesisIds) {
        const hypothesis = hypotheses.find((item: any) => String(item.id) === hypothesisId);
        if (hypothesis) hypothesis.signal_ids = [];
      }
    }
    judgment.judgment_unit_id = unitId;
    judgment.scope_ref = String(judgment.scope_ref || scopeRef);
    judgment.hypothesis_ids = hypothesisIds;
    judgment.strength = "J0";
    judgment.level = "J0";
    judgment.confidence = "low";
    judgment.decision_status = "indeterminate";
    judgment.conflict_status = judgment.conflict_status === "unresolved" ? "unresolved" : "none";
    judgment.not_judgeable_reason = `确定性规则未通过，已降为暂不可判断。${reasons.join("；")}`;
    judgment.supporting_evidence_draft_ids = [];
    judgment.counter_evidence_draft_ids = [];
    judgment.claimed_commercialization_stage = null;
    judgment.qualification_claim_scope = null;
    judgment.semiconductor_claim_scope = null;
    judgment.conclusion = judgment.conclusion && String(judgment.conclusion).includes("暂不可")
      ? judgment.conclusion
      : "当前暂不可形成方向判断";
    judgment.rationale = `${judgment.not_judgeable_reason}；已清空越界或口径不全的事实绑定，禁止把未通过规则的证据升级为结论。`;
  }
  data.hypotheses = hypotheses;
}

export function assertDeterministicRuleResults(data: any) {
  const byId = new Map<string, RuleEvaluation>((data.rule_evaluations || []).map((item: RuleEvaluation) => [item.id, item]));
  const blocking: RuleEvaluation[] = [];
  for (const judgment of data.judgments || []) {
    const judgmentId = String(judgment.id || judgment.judgment_id || "");
    const refs = (judgment.rule_evaluation_ids || []).map((id: string) => byId.get(id)).filter(Boolean) as RuleEvaluation[];
    for (const rule of REQUIRED_RULES) {
      const evaluation = refs.find((item) => item.rule_ref === rule && item.judgment_id === judgmentId);
      if (!evaluation?.deterministic_result || evaluation.deterministic_result.engine_version !== ENGINE_VERSION) {
        throw new Error(`${judgmentId} 缺少 Runtime 确定性执行结果: ${rule}`);
      }
      if (evaluation.result !== evaluation.deterministic_result.result) {
        throw new Error(`${judgmentId}/${rule} 声明结果与 Runtime 执行结果不一致`);
      }
      if (evaluation.result === "fail" || evaluation.result === "blocked") blocking.push(evaluation);
    }
  }
  if (blocking.length) {
    throw new Error(`确定性本体规则未通过: ${blocking.map((item) => `${item.judgment_id}/${item.rule_ref}`).join(", ")}`);
  }
}
