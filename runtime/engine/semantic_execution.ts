import "server-only";

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

const ENGINE_VERSION = "runtime-semantic-rules-2.0.0";
/** Runtime 确定性重算并挡门的正式规则。关系端点兼容见 graph_contract.validateRuntimeGraph。 */
export const REQUIRED_RULES = [
  "evidence_scope_time_alignment",
  "no_direct_evidence_to_judgment",
  "judgment_reference_integrity",
  "judgment_evidence_threshold",
  "judgment_status_consistency",
] as const;
const LEVEL = { J0: 0, J1: 1, J2: 2, J3: 3, J4: 4 } as const;

export function applyDeterministicRuleEvaluations(
  data: any,
  evidenceDrafts: EvidenceDraft[],
  sources: SourceRecord[],
  structure: any = {},
) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const evidenceMap = new Map(evidenceDrafts.map((evidence) => [evidence.id, evidence]));
  const retained = ((data.rule_evaluations || []) as RuleEvaluation[])
    .filter((item) => !REQUIRED_RULES.includes(item.rule_ref as typeof REQUIRED_RULES[number]));
  const generated: RuleEvaluation[] = [];

  for (const judgment of data.judgments || []) {
    const judgmentId = String(judgment.id || judgment.judgment_id || "");
    if (!judgmentId) throw new Error("Judgment 缺少稳定 ID，无法执行确定性规则");
    const ruleIds: string[] = [];
    for (const ruleRef of REQUIRED_RULES) {
      const computed = computeRule(ruleRef, judgment, data, evidenceMap, sourceMap, structure);
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
    judgment.rule_evaluation_ids = [
      ...new Set([...(judgment.rule_evaluation_ids || []).filter((id: string) => !String(id).startsWith("RE-SYS-")), ...ruleIds]),
    ];
  }

  data.rule_evaluations = [...retained, ...generated];
  const generatedIds = new Set(generated.map((item) => item.id));
  for (const trace of data.reasoning_traces || []) {
    const judgmentId = String(trace.judgment_id || trace.judgment_ref || "");
    const ids = generated.filter((item) => item.judgment_id === judgmentId).map((item) => item.id);
    trace.node_ids = [...new Set([...(trace.node_ids || trace.node_refs || []), ...ids])];
    if (trace.node_refs) trace.node_refs = trace.node_ids;
  }
  // Remove stale system IDs that no longer belong to any current judgment.
  for (const judgment of data.judgments || []) {
    judgment.rule_evaluation_ids = (judgment.rule_evaluation_ids || []).filter((id: string) => !String(id).startsWith("RE-SYS-") || generatedIds.has(id));
  }
  assertDeterministicRuleResults(data);
  return data;
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

function computeRule(
  rule: typeof REQUIRED_RULES[number],
  judgment: any,
  data: any,
  evidence: Map<string, EvidenceDraft>,
  sources: Map<string, SourceRecord>,
  structure: any,
) {
  const judgmentId = String(judgment.id || judgment.judgment_id);
  const evidenceIds = uniqueStrings([...(judgment.supporting_evidence_draft_ids || []), ...(judgment.counter_evidence_draft_ids || [])]);
  const facts = evidenceIds.map((id) => evidence.get(id)).filter(Boolean) as EvidenceDraft[];
  const boundSources = uniqueById(facts.flatMap((fact) => (fact.source_ids || []).map((id) => sources.get(id)).filter(Boolean) as SourceRecord[]));
  const inputRefs = evidenceIds.length ? evidenceIds : [judgmentId];

  if (rule === "evidence_scope_time_alignment") {
    const cutoff = parseTime(judgment.cutoff_at);
    const expectedScope = String(judgment.scope_ref || "");
    const badScope = facts.filter((fact) => !expectedScope || fact.scope_ref !== expectedScope);
    const badFactTime = facts.filter((fact) => !cutoff
      || [fact.observed_at, fact.valid_from, fact.published_at, fact.cutoff_at]
        .some((value) => !parseTime(value) || parseTime(value)! > cutoff));
    const badSource = boundSources.filter((source) => source.usability_status !== "usable"
      || source.retrieval_status !== "captured"
      || !source.quote_verified
      || !source.content_hash
      || !parseTime(source.published_at)
      || !cutoff
      || parseTime(source.published_at)! > cutoff);
    const noInputs = !facts.length || !boundSources.length;
    const failed = badScope.length > 0 || badFactTime.length > 0 || badSource.length > 0;
    const outcome: RuleResult = failed ? "fail" : noInputs ? "contested" : "pass";
    const rationale = noInputs
      ? "未绑定可校验事实与来源，只能表达 J0/暂不可判断"
      : failed
      ? `范围不符 ${badScope.length}，事实时间不符 ${badFactTime.length}，来源不可用或晚于截止 ${badSource.length}`
      : `全部 ${facts.length} 条事实与 ${boundSources.length} 个来源均匹配 ${expectedScope} 且不晚于 ${judgment.cutoff_at}`;
    return resultOf(outcome, inputRefs, rationale, [
      condition("scope_alignment", "evidence.scope_ref == judgment.scope_ref", inputRefs, badScope.length ? "fail" : noInputs ? "contested" : "pass", badScope.length ? "存在跨范围证据" : noInputs ? "无证据可校验" : "范围一致"),
      condition("time_alignment", "fact/source times <= judgment.cutoff_at", inputRefs, badFactTime.length || badSource.length ? "fail" : noInputs ? "contested" : "pass", rationale),
    ]);
  }

  if (rule === "no_direct_evidence_to_judgment") {
    const hypotheses = new Set<string>((judgment.hypothesis_ids || []).map(String));
    const linkedSignals = (data.signals || []).filter((signal: any) =>
      (signal.target_hypothesis_ids || []).some((id: string) => hypotheses.has(String(id))));
    const viaSignals = new Set<string>(linkedSignals.flatMap((signal: any) => signal.evidence_draft_ids || []).map(String));
    const bypass = evidenceIds.filter((id) => !viaSignals.has(id));
    return resultOf(bypass.length ? "fail" : "pass", inputRefs,
      bypass.length ? `证据绕过 Signal/Hypothesis: ${bypass.join(", ")}` : "全部证据经 Signal/Hypothesis 到达 Judgment",
      [condition("mediated_reasoning", "evidence -> signal -> hypothesis -> judgment", inputRefs, bypass.length ? "fail" : "pass", bypass.length ? bypass.join(", ") : "链路完整")]);
  }

  if (rule === "judgment_reference_integrity") {
    const signalMap = new Map((data.signals || []).map((item: any) => [String(item.id), item]));
    const hypothesisMap = new Map((data.hypotheses || []).map((item: any) => [String(item.id), item]));
    const evaluationIds = new Set((data.rule_evaluations || []).map((item: any) => String(item.id)));
    const errors: string[] = [];
    for (const hypothesisId of judgment.hypothesis_ids || []) {
      const hypothesis: any = hypothesisMap.get(String(hypothesisId));
      if (!hypothesis) { errors.push(`缺少 Hypothesis ${hypothesisId}`); continue; }
      for (const signalId of hypothesis.signal_ids || []) {
        const signal: any = signalMap.get(String(signalId));
        if (!signal) errors.push(`缺少 Signal ${signalId}`);
        else if (!(signal.target_hypothesis_ids || []).map(String).includes(String(hypothesisId))) errors.push(`${signalId}/${hypothesisId} 非双向绑定`);
      }
    }
    for (const id of judgment.rule_evaluation_ids || []) {
      if (!String(id).startsWith("RE-SYS-") && !evaluationIds.has(String(id))) errors.push(`缺少 RuleEvaluation ${id}`);
    }
    const unitIds = new Set((structure.judgment_units || []).map((item: any) => String(item.id || item.judgment_unit_id)));
    if (!unitIds.has(String(judgment.judgment_unit_id))) errors.push(`缺少 JudgmentUnit ${judgment.judgment_unit_id}`);
    return resultOf(errors.length ? "fail" : "pass", [judgmentId, ...inputRefs], errors.length ? errors.join("；") : "判断引用的单元、假设、信号与规则评估均可解析且信号双向绑定",
      [condition("judgment_references", "judgment unit/hypothesis/signal/rule evaluations resolve with bidirectional signal links", [judgmentId, ...inputRefs], errors.length ? "fail" : "pass", errors.length ? errors.join("；") : "引用完整")]);
  }

  if (rule === "judgment_evidence_threshold") {
    const sourceGroups = new Set(boundSources.map(sourceGroup));
    const qualifiedSources = boundSources.filter((source) => sourceTierNumber(source.source_tier) <= 6);
    const qualifiedGroups = new Set(qualifiedSources.map(sourceGroup));
    const highTierGroups = new Set(boundSources.filter((source) => sourceTierNumber(source.source_tier) <= 3).map(sourceGroup));
    const directFacts = facts.filter((fact) => fact.directness === "direct").length;
    const counterCount = (judgment.counter_evidence_draft_ids || []).length;
    const relevantSignals = new Set<string>((judgment.hypothesis_ids || []).flatMap((hypothesisId: string) =>
      ((data.hypotheses || []).find((item: any) => String(item.id) === String(hypothesisId))?.signal_ids || [])));
    const relevantCompetition = (data.competing_explanations || []).filter((item: any) =>
      (item.signal_ids || []).some((id: string) => relevantSignals.has(String(id))));
    const unresolved = relevantCompetition.some((item: any) => item.status === "active" || item.status === "unknown");
    const decisive = judgment.conflict_status === "decisive";
    let ceiling = 0;
    if (facts.length && sourceGroups.size === 1) ceiling = 1;
    if (facts.length >= 2 && qualifiedGroups.size >= 2 && directFacts >= 1) ceiling = 2;
    if (facts.length >= 3 && qualifiedGroups.size >= 3 && highTierGroups.size >= 1 && directFacts >= 2 && !unresolved && !decisive) ceiling = 3;
    if (facts.length >= 4 && qualifiedGroups.size >= 4 && highTierGroups.size >= 2 && directFacts >= 3 && !unresolved && !decisive && counterCount > 0 && judgment.conflict_status === "resolved") ceiling = 4;
    if (unresolved) ceiling = Math.min(ceiling, 2);
    if (decisive) ceiling = 0;
    const requested = LEVEL[judgment.strength as keyof typeof LEVEL] ?? -1;
    const failed = requested < 0 || requested > ceiling;
    const rationale = `请求 ${judgment.strength}；上限 J${ceiling}；事实 ${facts.length}、独立来源组 ${sourceGroups.size}、S1-S6 来源组 ${qualifiedGroups.size}、S1-S3 来源组 ${highTierGroups.size}、直接事实 ${directFacts}、反证 ${counterCount}、未决解释 ${unresolved ? "是" : "否"}`;
    return resultOf(failed ? "fail" : "pass", inputRefs, rationale, [
      condition("independent_sources", "independent_source_groups determine ceiling", inputRefs, sourceGroups.size ? "pass" : "fail", `独立来源组 ${sourceGroups.size}`),
      condition("level_ceiling", "judgment.level <= evidence_ceiling", inputRefs, failed ? "fail" : "pass", rationale),
    ]);
  }

  const statusErrors: string[] = [];
  const relevantSignalIds = new Set<string>((judgment.hypothesis_ids || []).flatMap((hypothesisId: string) =>
    ((data.hypotheses || []).find((item: any) => String(item.id) === String(hypothesisId))?.signal_ids || []).map(String)));
  const activeCompetition = (data.competing_explanations || []).some((item: any) =>
    (item.status === "active" || item.status === "unknown")
    && (item.signal_ids || []).some((id: string) => relevantSignalIds.has(String(id))));
  if (judgment.conflict_status === "unresolved" && judgment.decision_status === "supported") statusErrors.push("未决冲突不能标记 supported");
  if (judgment.conflict_status === "decisive" && !["blocked", "indeterminate", "invalidated"].includes(judgment.decision_status)) statusErrors.push("决定性反证必须阻断或判为不可判断");
  if (["blocked", "indeterminate"].includes(judgment.decision_status) && !String(judgment.not_judgeable_reason || "").trim()) statusErrors.push("阻断/不可判断缺少原因");
  if (judgment.strength === "J0" && !["blocked", "indeterminate", "contested"].includes(judgment.decision_status)) statusErrors.push("J0 状态不一致");
  if (activeCompetition && ["J3", "J4"].includes(judgment.strength)) statusErrors.push("竞争解释未排除但判断过强");
  return resultOf(statusErrors.length ? "fail" : "pass", [judgmentId, ...inputRefs], statusErrors.length ? statusErrors.join("；") : "判断等级、冲突和不可判断状态一致",
    [condition("status_consistency", "conflict and decision status are coherent", [judgmentId, ...inputRefs], statusErrors.length ? "fail" : "pass", statusErrors.length ? statusErrors.join("；") : "状态一致")]);
}

function resultOf(result: RuleResult, inputRefs: string[], rationale: string, conditions: RuleEvaluation["condition_results"]) {
  return { result, inputRefs: uniqueStrings(inputRefs), rationale, conditions };
}

function condition(conditionId: string, expression: string, inputRefs: string[], outcome: RuleResult, rationale: string) {
  return { condition_id: conditionId, expression, input_refs: uniqueStrings(inputRefs), outcome, rationale };
}

function sourceGroup(source: SourceRecord) {
  const explicit = String(source.source_group || "").trim().toLowerCase();
  if (explicit) return `group:${explicit}`;
  const publisher = String(source.publisher || "").trim().toLowerCase();
  if (publisher) return `publisher:${publisher}`;
  try { return `host:${new URL(source.final_url || source.url).hostname.toLowerCase()}`; } catch { return `source:${source.id}`; }
}

function sourceTierNumber(tier: SourceRecord["source_tier"]) {
  const matched = /^S([1-8])$/.exec(String(tier || "S8"));
  return matched ? Number(matched[1]) : 8;
}

function parseTime(value: unknown): number | null {
  if (!value || typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function uniqueById<T extends { id: string }>(values: T[]) {
  return [...new Map(values.map((item) => [item.id, item])).values()];
}

function slug(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
}
