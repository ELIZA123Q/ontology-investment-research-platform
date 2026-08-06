import { decideFromRuleDef, formalRuleDef } from "./rule_defs";
import type { SourceRecord } from "../../schemas/types";

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
  proxy_disclosure?: { lag: string | null; scope: string | null; non_substitution: string | null } | null;
  commercialization_stage?: CommercializationStage | null;
  qualification_scope?: QualificationScope | null;
  semiconductor_measurement?: SemiconductorMeasurement | null;
};
type CommercializationStage = "concept" | "sample" | "customer_evaluation" | "qualification" | "design_win" | "pilot" | "mass_production" | "repeat_purchase" | "scale_adoption";
type QualificationScope = { product_spec_ref: string | null; customer_ref: string | null; facility_ref: string | null };
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
type EvidenceGrade = "Q0" | "Q1" | "Q2" | "Q3" | "Q4";
type CounterevidenceResult = "cleared" | "weakened" | "contested" | "decisive" | "not_checked" | "not_applicable";
type PathReadinessStatus = "ready" | "restricted" | "blocked" | "not_applicable";
type JudgmentLevel = "J0" | "J1" | "J2" | "J3" | "J4";
type RuleResult = "pass" | "fail" | "contested" | "blocked";
type RuleEvaluation = {
  condition_results: Array<{ condition_id: string; expression: string; input_refs: string[]; outcome: RuleResult; rationale: string }>;
};

type SemanticRuleDependencies = {
  level: Record<string, number>;
  computeEvidenceGrade: (facts: EvidenceDraft[], sourceGroups: Set<string>, qualifiedGroups: Set<string>, directFacts: number) => EvidenceGrade;
  deriveCounterevidenceResult: (conflictStatus: string, counterEvidenceCount: number, hasUnresolvedCompetition: boolean, hasDeceptiveConflict: boolean) => CounterevidenceResult;
  deriveMaxJudgmentLevel: (evidenceGrade: EvidenceGrade, counterevidenceResult: CounterevidenceResult, pathReadiness: PathReadinessStatus) => { maxLevel: JudgmentLevel; reasons: string[] };
  judgmentStrength: (judgment: any) => string;
  pathStatusToReadiness: (status: string) => PathReadinessStatus;
};

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

export function computeRule(
  rule: string,
  judgment: any,
  data: any,
  evidence: Map<string, EvidenceDraft>,
  sources: Map<string, SourceRecord>,
  structure: any,
  dependencies: SemanticRuleDependencies,
) {
  const {
    level: LEVEL,
    computeEvidenceGrade,
    deriveCounterevidenceResult,
    deriveMaxJudgmentLevel,
    judgmentStrength,
    pathStatusToReadiness,
  } = dependencies;
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

    // 使用完整状态派生矩阵 (120 种组合)
    const evidenceGrade = computeEvidenceGrade(facts, sourceGroups, qualifiedGroups, directFacts);
    const counterevidenceResult = deriveCounterevidenceResult(
      String(judgment.conflict_status || "not_checked"), counterCount,
      unresolved && !decisive, decisive);
    const pathStatus = String(judgment.path_result_status || judgment.path_readiness_status || "");
    const pathReadiness = pathStatusToReadiness(pathStatus);
    const { maxLevel, reasons: capReasons } = deriveMaxJudgmentLevel(evidenceGrade, counterevidenceResult, pathReadiness);

    const ceiling = LEVEL[maxLevel];
    const requestedStrength = judgmentStrength(judgment);
    const requested = LEVEL[requestedStrength as keyof typeof LEVEL] ?? -1;
    const failed = requested < 0 || requested > ceiling;

    const rationale = `请求 ${requestedStrength}；上限 ${maxLevel} (证据=${evidenceGrade} 反证=${counterevidenceResult} 路径=${pathReadiness})；事实 ${facts.length}、独立来源组 ${sourceGroups.size}、S1-S6 来源组 ${qualifiedGroups.size}、S1-S3 来源组 ${highTierGroups.size}、直接事实 ${directFacts}、反证 ${counterCount}、未决解释 ${unresolved ? "是" : "否"}；${capReasons.join("；")}`;
    return resultOf(failed ? "fail" : "pass", inputRefs, rationale, [
      condition("status_derivation_matrix", "evidence_grade × counterevidence × path_readiness → max J (120 组合)", inputRefs, failed ? "fail" : "pass", rationale),
      condition("independent_sources", "independent_source_groups determine evidence grade", inputRefs, sourceGroups.size ? "pass" : "fail", `独立来源组 ${sourceGroups.size}`),
      condition("level_ceiling", "judgment.level <= derived_ceiling", inputRefs, failed ? "fail" : "pass", `J${requested} ≤ J${ceiling}`),
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
    if (!claimedKind) {
      return resultOf("pass", [judgmentId], "判断本身没有产能或良率度量主张，本规则不适用", [
        condition("capacity_or_yield_claim_present", "capacity or yield metric claim is present", [judgmentId], "pass", "未发现度量主张"),
      ]);
    }
    const supportingIds = new Set((judgment.supporting_evidence_draft_ids || []).map(String));
    const relevantFacts = facts.filter((fact) => supportingIds.has(fact.id)
      && (fact.semiconductor_measurement || detectSemiconductorMetricKind(String((fact as any).statement || ""))));
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

  if (rule === "expectation_projection_integrity") {
    const unitId = String(judgment.judgment_unit_id || "");
    const unit = (structure.judgment_units || []).find((item: any) =>
      String(item.id || item.judgment_unit_id || "") === unitId) || {};
    const judgmentType = String(unit.judgment_type || judgment.judgment_type || "").trim();
    const gaps = Array.isArray(data.expectation_gaps) ? data.expectation_gaps : [];
    const impacts = Array.isArray(data.asset_impacts) ? data.asset_impacts : [];
    const linkedGaps = gaps.filter((item: any) =>
      String(item.judgment_ref || item.judgment_id || "") === judgmentId
      || (Array.isArray(judgment.expectation_gap_ids) && judgment.expectation_gap_ids.map(String).includes(String(item.id))));
    const linkedImpacts = impacts.filter((item: any) =>
      (Array.isArray(item.source_judgment_refs) ? item.source_judgment_refs : [])
        .map(String).includes(judgmentId)
      || (Array.isArray(judgment.asset_impact_ids) && judgment.asset_impact_ids.map(String).includes(String(item.id))));
    if (!["expectation_gap", "valuation_impact"].includes(judgmentType)) {
      return resultOf("pass", [judgmentId], "当前判断类型不要求预期差或资产影响投影", [
        condition("projection_applicable", "judgment_type requires ExpectationGap or AssetImpact", [judgmentId], "pass", `judgment_type=${judgmentType || "unset"}`),
      ]);
    }
    if (isIndeterminateStop(judgment) && !facts.length) {
      return resultOf("pass", [judgmentId], "暂不可判断且无支持事实，跳过投影完整性校验", [
        condition("projection_required", "projection objects present for judgment type", [judgmentId], "pass", "J0 停止路径"),
      ]);
    }
    if (judgmentType === "expectation_gap") {
      const outcome: RuleResult = linkedGaps.length ? "pass" : "fail";
      const rationale = linkedGaps.length
        ? `expectation_gap 判断已绑定 ${linkedGaps.length} 个 ExpectationGap`
        : "expectation_gap 类判断缺少 ExpectationGap 投影对象";
      return resultOf(outcome, [judgmentId, ...linkedGaps.map((item: any) => String(item.id))], rationale, [
        condition("expectation_gap_relation_present", "expectation_gap_type_requires_gap_relation", [judgmentId], outcome, rationale),
      ]);
    }
    const outcome: RuleResult = linkedImpacts.length ? "pass" : "fail";
    const rationale = linkedImpacts.length
      ? `valuation_impact 判断已绑定 ${linkedImpacts.length} 个 AssetImpact`
      : "valuation_impact 类判断缺少 AssetImpact 投影对象";
    return resultOf(outcome, [judgmentId, ...linkedImpacts.map((item: any) => String(item.id))], rationale, [
      condition("asset_impact_relation_present", "valuation_impact_type_requires_asset_projection", [judgmentId], outcome, rationale),
    ]);
  }

  if (rule === "value_chain_propagation_consistency") {
    const unitId = String(judgment.judgment_unit_id || "");
    const unit = (structure.judgment_units || []).find((item: any) =>
      String(item.id || item.judgment_unit_id || "") === unitId) || {};
    const judgmentType = String(unit.judgment_type || judgment.judgment_type || "").trim();
    const propagationTypes = new Set(["transmission_path", "mechanism_validation", "impact_realization"]);
    const paths = (structure.paths || []).filter((item: any) =>
      (item.variable_ids || []).length >= 2
      && (
        Array.isArray(item.judgment_unit_ids)
          ? item.judgment_unit_ids.map(String).includes(unitId)
          : Array.isArray(item.linked_judgment_units)
            ? item.linked_judgment_units.map(String).includes(unitId)
            : false
      ));
    const boundVariableIds = new Set(paths.flatMap((item: any) => (item.variable_ids || []).map(String)));
    const edges = [
      ...(Array.isArray(structure.influence_edges) ? structure.influence_edges : []),
      ...(Array.isArray(structure.state_variable_influences) ? structure.state_variable_influences : []),
      ...(Array.isArray(data.influence_edges) ? data.influence_edges : []),
    ].filter((edge: any) => {
      if (!boundVariableIds.size) return false;
      const source = String(edge.source || edge.from || "");
      const target = String(edge.target || edge.to || "");
      return boundVariableIds.has(source) && boundVariableIds.has(target);
    });
    const incompleteEdge = edges.some((edge: any) => !String(edge.mechanism || "").trim() || !String(edge.sign || "").trim());
    const pairSigns = new Map<string, Set<string>>();
    for (const edge of edges) {
      const key = `${String(edge.source || edge.from || "")}->${String(edge.target || edge.to || "")}`;
      if (!key.replace("->", "")) continue;
      const signs = pairSigns.get(key) || new Set<string>();
      signs.add(String(edge.sign || ""));
      pairSigns.set(key, signs);
    }
    const signConflict = [...pairSigns.values()].some((signs) => signs.size > 1);
    const propagationTypeWithoutPath = propagationTypes.has(judgmentType) && !paths.length && !isIndeterminateStop(judgment);
    const facts = {
      propagation_type_without_path: propagationTypeWithoutPath,
      path_variables_unlinked: incompleteEdge,
      influence_sign_conflict: signConflict,
      non_propagation_type_or_path_consistent:
        !propagationTypes.has(judgmentType) || (!propagationTypeWithoutPath && !incompleteEdge && !signConflict),
    };
    const def = formalRuleDef(rule);
    const outcome: RuleResult = def ? decideFromRuleDef(def, facts) : (facts.non_propagation_type_or_path_consistent ? "pass" : "fail");
    const rationale = outcome === "pass"
      ? (propagationTypes.has(judgmentType) ? `传导类判断路径一致（paths=${paths.length}, edges=${edges.length}）` : "非传导类判断，跳过路径约束")
      : [
        facts.propagation_type_without_path ? "传导类判断缺少≥2变量路径" : null,
        facts.path_variables_unlinked ? "影响边缺少 mechanism/sign" : null,
        facts.influence_sign_conflict ? "同端点影响方向冲突" : null,
      ].filter(Boolean).join("；");
    return resultOf(outcome, [judgmentId], rationale, [
      condition("non_propagation_type_or_path_consistent", def?.condition || rule, [judgmentId], outcome, rationale),
    ]);
  }

  if (rule === "valuation_hypothesis_level_coupling") {
    const unitId = String(judgment.judgment_unit_id || "");
    const unit = (structure.judgment_units || []).find((item: any) =>
      String(item.id || item.judgment_unit_id || "") === unitId) || {};
    const judgmentType = String(unit.judgment_type || judgment.judgment_type || "").trim();
    const impacts = Array.isArray(data.asset_impacts) ? data.asset_impacts : [];
    const linkedImpacts = impacts.filter((item: any) =>
      (Array.isArray(item.source_judgment_refs) ? item.source_judgment_refs : [])
        .map(String).includes(judgmentId)
      || (Array.isArray(judgment.asset_impact_ids) && judgment.asset_impact_ids.map(String).includes(String(item.id))));
    const valuationRelevant = judgmentType === "valuation_impact"
      || linkedImpacts.some((item: any) => String(item.impact_channel || "") === "valuation_multiple");
    const strength = judgmentStrength(judgment);
    const hasBridge = (Array.isArray(judgment.conditions) ? judgment.conditions : [])
      .map(String).some((item: string) => item.trim().length > 0)
      || linkedImpacts.some((item: any) =>
        (Array.isArray(item.conditions) ? item.conditions : []).map(String).some((text: string) => text.trim().length > 0));
    const activeCompetition = (data.competing_explanations || []).some((item: any) =>
      item.status === "active" || item.status === "unknown");
    const facts = {
      valuation_j3_without_assumption_bridge: valuationRelevant && ["J3", "J4"].includes(strength) && !hasBridge && !isIndeterminateStop(judgment),
      valuation_j4_with_active_competition: valuationRelevant && strength === "J4" && activeCompetition,
      non_valuation_type_or_level_coupled: !valuationRelevant
        || (!((["J3", "J4"].includes(strength) && !hasBridge) || (strength === "J4" && activeCompetition)))
        || isIndeterminateStop(judgment),
    };
    const def = formalRuleDef(rule);
    const outcome: RuleResult = def ? decideFromRuleDef(def, facts) : (facts.non_valuation_type_or_level_coupled ? "pass" : "fail");
    const rationale = outcome === "pass"
      ? (valuationRelevant ? `估值类判断等级与假设桥一致（${strength}）` : "非估值类判断，跳过等级挂钩")
      : [
        facts.valuation_j3_without_assumption_bridge ? "估值 J3+ 缺少显式假设桥/成立条件" : null,
        facts.valuation_j4_with_active_competition ? "估值 J4 仍存在 active 竞争解释" : null,
      ].filter(Boolean).join("；");
    return resultOf(outcome, [judgmentId], rationale, [
      condition("non_valuation_type_or_level_coupled", def?.condition || rule, [judgmentId], outcome, rationale),
    ]);
  }

  if (rule === "risk_exposure_blocking_linkage") {
    const unitId = String(judgment.judgment_unit_id || "");
    const blocks = (Array.isArray(data.blocking_factors) ? data.blocking_factors : []).filter((item: any) => {
      const status = String(item.status || "active");
      if (status !== "active") return false;
      if (String(item.judgment_unit_id || "") === unitId) return true;
      return (Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids : []).map(String).includes(unitId);
    });
    const strength = judgmentStrength(judgment);
    const activeBlockWithSupportedHighJ = blocks.length > 0
      && judgment.decision_status === "supported"
      && ["J2", "J3", "J4"].includes(strength);
    const facts = {
      active_block_with_supported_high_j: activeBlockWithSupportedHighJ,
      no_active_block_or_status_aligned: !activeBlockWithSupportedHighJ,
    };
    const def = formalRuleDef(rule);
    const outcome: RuleResult = def ? decideFromRuleDef(def, facts) : (facts.no_active_block_or_status_aligned ? "pass" : "fail");
    const rationale = outcome === "pass"
      ? (blocks.length ? "存在阻断因素且判断状态/等级已对齐" : "无 active 阻断因素")
      : `存在 ${blocks.length} 个 active 阻断因素，但判断仍为 supported ${strength}`;
    return resultOf(outcome, [judgmentId, ...blocks.map((item: any) => String(item.id || ""))], rationale, [
      condition("no_active_block_or_status_aligned", def?.condition || rule, [judgmentId], outcome, rationale),
    ]);
  }

  if (rule === "judgment_status_consistency") {
    const relevantSignalIds = new Set<string>((judgment.hypothesis_ids || []).flatMap((hypothesisId: string) =>
      ((data.hypotheses || []).find((item: any) => String(item.id) === String(hypothesisId))?.signal_ids || []).map(String)));
    const activeCompetition = (data.competing_explanations || []).some((item: any) =>
      (item.status === "active" || item.status === "unknown")
      && (item.signal_ids || []).some((id: string) => relevantSignalIds.has(String(id))));
    const strength = judgmentStrength(judgment);
    const hasReason = Boolean(String(judgment.not_judgeable_reason || "").trim());
    const facts = {
      supported_with_unresolved_conflict: judgment.conflict_status === "unresolved" && judgment.decision_status === "supported",
      blocked_without_reason: judgment.decision_status === "blocked" && !hasReason,
      indeterminate_without_reason: judgment.decision_status === "indeterminate" && !hasReason,
      unresolved_conflict_implies_contested: !(judgment.conflict_status === "unresolved" && judgment.decision_status === "supported"),
      decisive_conflict_implies_blocked_or_indeterminate: !(judgment.conflict_status === "decisive"
        && !["blocked", "indeterminate", "invalidated"].includes(judgment.decision_status)),
      blocked_or_indeterminate_has_reason: !(["blocked", "indeterminate"].includes(judgment.decision_status) && !hasReason),
      j0_status_inconsistent: strength === "J0" && !["blocked", "indeterminate", "contested"].includes(judgment.decision_status),
      high_j_with_active_competition: activeCompetition && ["J3", "J4"].includes(strength),
    };
    const def = formalRuleDef(rule);
    let outcome: RuleResult = def ? decideFromRuleDef(def, facts) : "fail";
    // Runtime 扩展：YAML 尚未登记的 J0 / 竞争解释过强
    if (facts.j0_status_inconsistent || facts.high_j_with_active_competition) outcome = "fail";
    const statusErrors = [
      facts.supported_with_unresolved_conflict ? "未决冲突不能标记 supported" : null,
      !facts.decisive_conflict_implies_blocked_or_indeterminate ? "决定性反证必须阻断或判为不可判断" : null,
      facts.blocked_without_reason || facts.indeterminate_without_reason ? "阻断/不可判断缺少原因" : null,
      facts.j0_status_inconsistent ? "J0 状态不一致" : null,
      facts.high_j_with_active_competition ? "竞争解释未排除但判断过强" : null,
    ].filter(Boolean) as string[];
    return resultOf(outcome, [judgmentId, ...inputRefs], statusErrors.length ? statusErrors.join("；") : "判断等级、冲突和不可判断状态一致",
      [condition("status_consistency", def?.condition || rule, [judgmentId, ...inputRefs], outcome, statusErrors.length ? statusErrors.join("；") : "状态一致")]);
  }

  throw new Error(`未实现的正式本体规则: ${rule}`);
}

function resultOf(result: RuleResult, inputRefs: string[], rationale: string, conditions: RuleEvaluation["condition_results"]) {
  return { result, inputRefs: uniqueStrings(inputRefs), rationale, conditions };
}

function condition(conditionId: string, expression: string, inputRefs: string[], outcome: RuleResult, rationale: string) {
  return { condition_id: conditionId, expression, input_refs: uniqueStrings(inputRefs), outcome, rationale };
}

export function sourceGroup(source: SourceRecord) {
  const explicit = String(source.source_group || "").trim().toLowerCase();
  if (explicit) return `group:${explicit}`;
  const publisher = String(source.publisher || "").trim().toLowerCase();
  if (publisher) return `publisher:${publisher}`;
  try { return `host:${new URL(source.final_url || source.url).hostname.toLowerCase()}`; } catch { return `source:${source.id}`; }
}

export function sourceTierNumber(tier: SourceRecord["source_tier"]) {
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
    ["customer_evaluation", /客户评估|customer.?evaluation/i],
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

function judgmentStrength(judgment: any): string {
  return String(judgment?.strength || judgment?.level || "");
}

function isIndeterminateStop(judgment: any) {
  return judgmentStrength(judgment) === "J0"
    && ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status || ""))
    && Boolean(String(judgment.not_judgeable_reason || "").trim());
}

function detectSemiconductorMetricKind(text: string): SemiconductorMetricKind | null {
  // 该正式规则约束 CapacityMetric / YieldMetric 的可比口径，不约束“扩产、
  // 产能分配、资源挤占”这类定性机制叙事。只有明确度量主张才触发六维门禁。
  if (/良率(?:为|达到|提升至|下降至|改善了|下降了|\s*[0-9])|\byield(?:\s+rate)?\s*(?:of|was|is|at|=|:|\d)/i.test(text)) {
    return "yield";
  }
  if (/产能利用率|名义产能|有效产能|有效产出|月产能|晶圆\/月|片\/月|nameplate capacity|effective capacity|capacity utilization|wafers per month|\bkwpm\b/i.test(text)) {
    return "capacity";
  }
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

export function uniqueById<T extends { id: string }>(values: T[]) {
  return [...new Map(values.map((item) => [item.id, item])).values()];
}

export function slug(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
}
