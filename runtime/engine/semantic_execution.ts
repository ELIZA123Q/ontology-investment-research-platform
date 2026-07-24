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

export const ENGINE_VERSION = "runtime-semantic-rules-3.0.0";
/** Runtime 确定性重算并挡门的正式规则。关系端点兼容见 graph_contract.validateRuntimeGraph。 */
export const REQUIRED_RULES = [
  "evidence_scope_time_alignment",
  "no_direct_evidence_to_judgment",
  "judgment_reference_integrity",
  "judgment_evidence_threshold",
  "judgment_status_consistency",
  "state_time_consistency",
  "semiconductor_proxy_disclosure",
  "semiconductor_qualification_stage_alignment",
  "semiconductor_capacity_yield_scope_alignment",
] as const;
const LEVEL = { J0: 0, J1: 1, J2: 2, J3: 3, J4: 4 } as const;
const COMMERCIALIZATION_STAGE_ORDER: Record<CommercializationStage, number> = {
  concept: 1,
  sample: 2,
  customer_evaluation: 3,
  qualification: 4,
  design_win: 5,
  pilot: 6,
  mass_production: 7,
  repeat_purchase: 8,
  scale_adoption: 9,
};

export function applyDeterministicRuleEvaluations(
  data: any,
  evidenceDrafts: EvidenceDraft[],
  sources: SourceRecord[],
  structure: any = {},
) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const evidenceMap = new Map(evidenceDrafts.map((evidence) => [evidence.id, evidence]));

  const materialize = () => {
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

/** 确定性规则 fail/blocked 时，把对应 Judgment 降为 J0，避免整阶段因上游近失证据直接崩溃。 */
function demoteJudgmentsForBlockingRules(data: any, blocked: Map<string, RuleEvaluation[]>, structure: any = {}) {
  const unitIds = (structure.judgment_units || []).map((item: any) => String(item.id || "")).filter(Boolean);
  const scopeRef = String(structure.research_scope?.id || unitIds[0] || "SCOPE-UNKNOWN");
  const hypotheses = Array.isArray(data.hypotheses) ? [...data.hypotheses] : [];
  for (const judgment of data.judgments || []) {
    const judgmentId = String(judgment.id || judgment.judgment_id || "");
    const blockers = blocked.get(judgmentId);
    if (!blockers?.length) continue;
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
    if (facts.length && sourceGroups.size >= 1) ceiling = 1;
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

  if (rule === "state_time_consistency") {
    const invalidFacts = facts.filter((fact) => {
      const observedAt = parseTime(fact.observed_at);
      const validFrom = parseTime(fact.valid_from);
      const validTo = fact.valid_to ? parseTime(fact.valid_to) : null;
      const publishedAt = parseTime(fact.published_at);
      const cutoffAt = parseTime(fact.cutoff_at);
      return !observedAt || !validFrom || !publishedAt || !cutoffAt
        || observedAt > cutoffAt
        || publishedAt > cutoffAt
        || (fact.valid_to != null && (!validTo || validFrom > validTo));
    });
    const mutatedSnapshots = (data.state_snapshots || []).filter((snapshot: any) => snapshot.snapshot_mutation === true);
    const noInputs = !facts.length && !mutatedSnapshots.length;
    const failed = invalidFacts.length > 0 || mutatedSnapshots.length > 0;
    const outcome: RuleResult = failed ? "fail" : noInputs ? "contested" : "pass";
    const refs = uniqueStrings([
      ...inputRefs,
      ...mutatedSnapshots.map((snapshot: any) => snapshot.id || snapshot.snapshot_id),
    ]);
    const rationale = failed
      ? `时间不一致事实 ${invalidFacts.length}，被覆盖快照 ${mutatedSnapshots.length}`
      : noInputs
      ? "当前判断没有状态观测或快照输入"
      : `全部 ${facts.length} 条状态观测均不晚于各自截止时间，且有效期顺序一致`;
    return resultOf(outcome, refs, rationale, [
      condition("observation_time_order", "observed_at/published_at <= cutoff_at and valid_from <= valid_to", refs, invalidFacts.length ? "fail" : noInputs ? "contested" : "pass", invalidFacts.length ? `不一致事实: ${invalidFacts.map((fact) => fact.id).join(", ")}` : rationale),
      condition("snapshot_immutability", "historical snapshots are immutable", refs, mutatedSnapshots.length ? "fail" : "pass", mutatedSnapshots.length ? `覆盖快照: ${mutatedSnapshots.map((snapshot: any) => snapshot.id || snapshot.snapshot_id).join(", ")}` : "未发现历史快照覆盖"),
    ]);
  }

  if (rule === "semiconductor_proxy_disclosure") {
    const proxyFacts = facts.filter((fact) => fact.directness === "proxy");
    if (!proxyFacts.length) {
      return resultOf("pass", [judgmentId], "没有使用代理证据，本规则不适用", [
        condition("proxy_used", "evidence.directness == proxy", [judgmentId], "pass", "未使用代理证据"),
      ]);
    }
    const missing = proxyFacts.filter((fact) => !hasText(fact.proxy_disclosure?.lag)
      || !hasText(fact.proxy_disclosure?.scope)
      || !hasText(fact.proxy_disclosure?.non_substitution));
    const outcome: RuleResult = missing.length ? "blocked" : "pass";
    const refs = proxyFacts.map((fact) => fact.id);
    const rationale = missing.length
      ? `代理证据缺少滞后、适用范围或不可替代直接证据的披露: ${missing.map((fact) => fact.id).join(", ")}`
      : `全部 ${proxyFacts.length} 条代理证据均披露滞后、范围和不可替代边界`;
    return resultOf(outcome, refs, rationale, [
      condition("proxy_lag_scope_and_non_substitution_disclosed", "proxy lag, scope and direct-evidence limitation are explicit", refs, outcome, rationale),
    ]);
  }

  if (rule === "semiconductor_qualification_stage_alignment") {
    const indeterminateStop = isIndeterminateStop(judgment) && !facts.length;
    if (indeterminateStop) {
      return resultOf("pass", [judgmentId], "暂不可判断且无支持事实，跳过商业化阶段校验", [
        condition("commercialization_claim_present", "commercialization stage claim is present", [judgmentId], "pass", "J0 停止路径"),
      ]);
    }
    const claimedStage = asCommercializationStage(judgment.claimed_commercialization_stage)
      || detectCommercializationClaimStage(`${judgment.title || ""} ${judgment.conclusion || ""}`);
    const supportingIds = new Set((judgment.supporting_evidence_draft_ids || []).map(String));
    const supportingFacts = facts.filter((fact) => supportingIds.has(fact.id));
    const stagedFacts = supportingFacts.map((fact) => ({
      fact,
      stage: asCommercializationStage(fact.commercialization_stage) || detectCommercializationStage(String((fact as any).statement || "")),
    })).filter((item) => item.stage) as Array<{ fact: EvidenceDraft; stage: CommercializationStage }>;
    if (!claimedStage) {
      return resultOf("pass", [judgmentId], "没有商业化阶段主张，本规则不适用", [
        condition("commercialization_claim_present", "commercialization stage claim is present", [judgmentId], "pass", "未发现商业化阶段主张"),
      ]);
    }
    if (!stagedFacts.length) {
      const refs = uniqueStrings([judgmentId, ...stagedFacts.map((item) => item.fact.id)]);
      return resultOf("blocked", refs, "商业化阶段主张或支持证据缺少结构化阶段，无法校验低阶段证据是否越级", [
        condition("stage_metadata_present", "claimed and evidence commercialization stages are explicit", refs, "blocked", "缺少主张阶段或证据阶段"),
      ]);
    }
    const claimScope = qualificationScope(judgment.qualification_claim_scope);
    const lowerStage = stagedFacts.filter((item) => COMMERCIALIZATION_STAGE_ORDER[item.stage] < COMMERCIALIZATION_STAGE_ORDER[claimedStage]);
    const missingScope = stagedFacts.filter((item) => !qualificationScope(item.fact.qualification_scope) || !claimScope);
    const mismatchedScope = claimScope ? stagedFacts.filter((item) => {
      const factScope = qualificationScope(item.fact.qualification_scope);
      return factScope ? !qualificationScopesMatch(factScope, claimScope) : false;
    }) : [];
    const blocked = missingScope.length > 0;
    const failed = lowerStage.length > 0 || mismatchedScope.length > 0;
    const outcome: RuleResult = failed ? "fail" : blocked ? "blocked" : "pass";
    const refs = stagedFacts.map((item) => item.fact.id);
    const rationale = failed
      ? `低于主张阶段的证据 ${lowerStage.length}，产品规格/客户/设施范围不一致 ${mismatchedScope.length}`
      : blocked
      ? `商业化阶段范围元数据不完整: ${missingScope.map((item) => item.fact.id).join(", ")}`
      : `证据阶段不低于 ${claimedStage}，且产品规格、客户与设施范围一致`;
    return resultOf(outcome, refs, rationale, [
      condition("evidence_stage_gte_claimed_stage", "evidence_stage >= claimed_stage", refs, lowerStage.length ? "fail" : "pass", lowerStage.length ? lowerStage.map((item) => `${item.fact.id}:${item.stage}`).join(", ") : "阶段未越级"),
      condition("qualification_scope_alignment", "product spec, customer and facility scope align", refs, mismatchedScope.length ? "fail" : missingScope.length ? "blocked" : "pass", rationale),
    ]);
  }

  if (rule === "semiconductor_capacity_yield_scope_alignment") {
    const indeterminateStop = isIndeterminateStop(judgment) && !facts.length;
    if (indeterminateStop) {
      return resultOf("pass", [judgmentId], "暂不可判断且无支持事实，跳过产能/良率口径校验", [
        condition("capacity_or_yield_claim_present", "capacity or yield claim is present", [judgmentId], "pass", "J0 停止路径"),
      ]);
    }
    const claimScope = semiconductorMeasurement(judgment.semiconductor_claim_scope);
    const claimedKind = claimScope?.metric_kind || detectSemiconductorMetricKind(`${judgment.title || ""} ${judgment.conclusion || ""}`);
    const supportingIds = new Set((judgment.supporting_evidence_draft_ids || []).map(String));
    const relevantFacts = facts.filter((fact) => supportingIds.has(fact.id)
      && (fact.semiconductor_measurement || detectSemiconductorMetricKind(String((fact as any).statement || ""))));
    if (!claimedKind && !relevantFacts.length) {
      return resultOf("pass", [judgmentId], "没有产能或良率主张，本规则不适用", [
        condition("capacity_or_yield_claim_present", "capacity or yield claim is present", [judgmentId], "pass", "未发现产能或良率主张"),
      ]);
    }
    const incomplete = relevantFacts.filter((fact) => !semiconductorMeasurement(fact.semiconductor_measurement));
    if (!claimScope || !relevantFacts.length || incomplete.length) {
      const refs = uniqueStrings([judgmentId, ...relevantFacts.map((fact) => fact.id)]);
      const missing = !claimScope ? "判断口径" : !relevantFacts.length ? "支持证据" : `证据口径 ${incomplete.map((fact) => fact.id).join(", ")}`;
      return resultOf("blocked", refs, `产能/良率 ${missing} 缺少设施、晶圆尺寸、制程/产品、批次、单位或业务时间`, [
        condition("capacity_yield_scope_complete", "six scope dimensions are explicit", refs, "blocked", missing),
      ]);
    }
    const mismatched = relevantFacts.filter((fact) => !semiconductorMeasurementsMatch(semiconductorMeasurement(fact.semiconductor_measurement)!, claimScope));
    const outcome: RuleResult = mismatched.length ? "fail" : "pass";
    const refs = relevantFacts.map((fact) => fact.id);
    const rationale = mismatched.length
      ? `产能/良率证据与判断口径不一致: ${mismatched.map((fact) => fact.id).join(", ")}`
      : `全部 ${relevantFacts.length} 条产能/良率证据均对齐六项口径`;
    return resultOf(outcome, refs, rationale, [
      condition("facility_wafer_process_product_batch_unit_and_time_aligned", "facility, wafer, process/product, batch, unit and business time align", refs, outcome, rationale),
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

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function asCommercializationStage(value: unknown): CommercializationStage | null {
  const candidate = normalized(value) as CommercializationStage;
  return candidate in COMMERCIALIZATION_STAGE_ORDER ? candidate : null;
}

function detectCommercializationStage(text: string): CommercializationStage | null {
  const candidates: Array<[CommercializationStage, RegExp]> = [
    ["scale_adoption", /规模采用|scale adoption/i],
    ["repeat_purchase", /复购|repeat purchase/i],
    ["mass_production", /量产|mass production/i],
    ["pilot", /试产|pilot production|\bpilot\b/i],
    ["design_win", /定点|design[- ]?win/i],
    ["qualification", /认证|qualification/i],
    ["customer_evaluation", /客户评估|customer evaluation/i],
    ["sample", /送样|样品|sampling|\bsample\b/i],
    ["concept", /概念|concept/i],
  ];
  return candidates.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function detectCommercializationClaimStage(text: string): CommercializationStage | null {
  const stage = detectCommercializationStage(text);
  if (!stage) return null;
  const transitionClaim = /(?:进入|实现|达到|处于|完成|通过|获得|转入|迈入|已).{0,12}(?:规模采用|复购|量产|试产|定点|认证|客户评估|送样|样品|概念)/i;
  const explicitState = /(?:规模采用|复购|量产|试产|定点|认证|客户评估|送样|样品|概念).{0,4}(?:阶段|状态|里程碑)/i;
  const englishClaim = /(?:entered|reached|achieved|completed|qualified for|in).{0,16}(?:scale adoption|repeat purchase|mass production|pilot|design[- ]?win|qualification|customer evaluation|sampling|concept)/i;
  return transitionClaim.test(text) || explicitState.test(text) || englishClaim.test(text) ? stage : null;
}

function qualificationScope(value: unknown): QualificationScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as QualificationScope;
  if (!hasText(scope.product_spec_ref) || !hasText(scope.customer_ref)) return null;
  return scope;
}

function qualificationScopesMatch(left: QualificationScope, right: QualificationScope) {
  if (normalized(left.product_spec_ref) !== normalized(right.product_spec_ref)) return false;
  if (normalized(left.customer_ref) !== normalized(right.customer_ref)) return false;
  const leftFacility = normalized(left.facility_ref);
  const rightFacility = normalized(right.facility_ref);
  return !leftFacility && !rightFacility || leftFacility === rightFacility;
}

function isIndeterminateStop(judgment: any) {
  return judgment.strength === "J0"
    && ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status || ""))
    && Boolean(String(judgment.not_judgeable_reason || "").trim());
}

function detectSemiconductorMetricKind(text: string): SemiconductorMetricKind | null {
  if (/良率|\byield\b/i.test(text)) return "yield";
  // 「产能扩张」是因果叙事常见词，不等于产能/良率度量主张；避免误触发六维口径挡门。
  if (/产能扩张|capacity expansion/i.test(text)
    && !/产能利用率|名义产能|有效产出|nameplate capacity|effective capacity/i.test(text)) {
    return null;
  }
  if (/产能利用率|名义产能|有效产出|nameplate capacity|effective capacity|\bcapacity\b/i.test(text)) {
    return "capacity";
  }
  if (/产能/i.test(text)) return "capacity";
  return null;
}

function semiconductorMeasurement(value: unknown): SemiconductorMeasurement | null {
  if (!value || typeof value !== "object") return null;
  const measurement = value as SemiconductorMeasurement;
  if (!(["capacity", "yield"] as string[]).includes(measurement.metric_kind)
    || !hasText(measurement.facility_ref)
    || !hasText(measurement.wafer_size)
    || !hasText(measurement.process_or_product_ref)
    || !hasText(measurement.batch_stage)
    || !hasText(measurement.unit)
    || !hasText(measurement.business_time_basis)) return null;
  return measurement;
}

function semiconductorMeasurementsMatch(left: SemiconductorMeasurement, right: SemiconductorMeasurement) {
  return (["metric_kind", "facility_ref", "wafer_size", "process_or_product_ref", "batch_stage", "unit", "business_time_basis"] as const)
    .every((key) => normalized(left[key]) === normalized(right[key]));
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
