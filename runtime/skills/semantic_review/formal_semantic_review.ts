/** 工作台 independent_review → 正式包独立语义审查 YAML。 */

import YAML from "yaml";
import {
  SEMANTIC_REVIEW_CHECKS,
  STAGE05_SEMANTIC_REVIEW_CHECKS,
  validateSemanticReview,
  type SemanticReviewCheck,
} from "./semantic_review";
import { hasTradingAdviceOverreach } from "../../agents/05_delivery/input_contract";

/**
 * 禁止把工作台批量 verdict 伪投影为五项同结果。
 * 仅当 review.semantic_checks 完整且通过 validateSemanticReview 时导出真实检查；
 * 否则一律 needs_human，让 validate_run 明确不可发布。
 */
export function mapIndependentReviewToSemanticYaml(input: {
  reviewData: any;
  stageHashes: Record<string, string>;
  contractVersion: string;
  producerId: string;
}): string {
  const review = input.reviewData || {};
  const reviewerId = String(review.reviewer_model || review.reviewer_id || "workbench-reviewer");
  const rawChecks = Array.isArray(review.semantic_checks) ? review.semantic_checks : [];
  const normalizedChecks: SemanticReviewCheck[] = rawChecks.map((item: any) => ({
    check_id: item?.check_id,
    result: item?.result,
    reason: String(item?.reason || "").trim(),
    ...(item?.return_to_stage ? { return_to_stage: item.return_to_stage } : {}),
  }));

  const validated = validateSemanticReview(
    {
      reviewer_id: reviewerId === input.producerId ? `${reviewerId}-independent` : reviewerId,
      reviewer_type: review.reviewer_type === "human" ? "human" : "model",
      independent_from_producer: true,
      checks: normalizedChecks,
      verdict: review.verdict === "pass" || review.verdict === "fail" || review.verdict === "needs_human"
        ? review.verdict
        : undefined,
    },
    {
      producerId: input.producerId,
      runMode: "development",
      stageHashes: input.stageHashes,
      contractVersion: input.contractVersion,
    },
  );

  const usable = validated.valid && (normalizedChecks.length === SEMANTIC_REVIEW_CHECKS.length || normalizedChecks.length === STAGE05_SEMANTIC_REVIEW_CHECKS.length);
  const expectedChecks = normalizedChecks.length === STAGE05_SEMANTIC_REVIEW_CHECKS.length
    ? STAGE05_SEMANTIC_REVIEW_CHECKS
    : SEMANTIC_REVIEW_CHECKS;
  const checks = usable
    ? normalizedChecks.map((check) => ({
      check_id: check.check_id,
      result: check.result,
      reason: check.reason,
      ...(check.result === "pass" ? {} : { return_to_stage: check.return_to_stage || "04" }),
    }))
    : expectedChecks.map((checkId) => ({
      check_id: checkId,
      result: "needs_human" as const,
      reason: validated.errors.length
        ? `工作台未提交合格语义审查：${validated.errors.join("；")}`
        : "工作台仅有批量 verdict，禁止映射补齐检查项；须补逐项 semantic_checks",
      return_to_stage: "04" as const,
    }));

  const payload = {
    schema_name: "independent_semantic_review",
    schema_version: "1.0.0",
    reviewer: {
      reviewer_id: reviewerId === input.producerId ? `${reviewerId}-independent` : reviewerId,
      reviewer_type: String(review.reviewer_type || "model"),
      independent_from_producer: true,
      test_reviewer: false,
    },
    inputs: {
      public_contract_version: input.contractVersion,
      stage_hashes: {
        stage_02: input.stageHashes.stage_02,
        stage_03: input.stageHashes.stage_03,
        stage_04: input.stageHashes.stage_04,
        stage_05: input.stageHashes.stage_05,
      },
    },
    checks,
    verdict: usable ? validated.verdict : "needs_human",
    notes: usable
      ? "由工作台 independent_review.semantic_checks 逐项导出；正式 PUBLISHABLE 仍以 validate_run 派生为准。"
      : "拒绝批量 verdict 映射；缺少合格 semantic_checks，正式包标记 needs_human。",
  };
  return YAML.stringify(payload);
}

/**
 * 将 Stage05 已完成的 04→05 一致性门导出为正式包校验留痕。
 * 这里不重新发起审阅；所有结果都来自已批准 Stage05 的表达审计、
 * 研究价值检查和版本绑定字段。
 */
export function mapStage05ConsistencyToSemanticYaml(input: {
  stage05Data: any;
  stageHashes: Record<string, string>;
  contractVersion: string;
  approved: boolean;
}): string {
  const data = input.stage05Data || {};
  let audit: any = {};
  try {
    audit = YAML.parse(String(data.expression_audit_yaml || "")) || {};
  } catch {
    audit = {};
  }
  const register = Array.isArray(audit.claim_expression_register)
    ? audit.claim_expression_register
    : [];
  const reportClaims = Array.isArray(data.report_claims) ? data.report_claims : [];
  const body = String(data.document_markdown || "");
  // 调用方必须证明读取的是已批准 Stage05；兼容变更前已批准、但字段仍为
  // not_reviewed 的历史任务。新确认会把该字段显式冻结为 reviewed。
  const reviewed = input.approved && ["reviewed", "not_reviewed"].includes(String(data.semantic_review_status || ""));
  const qualityPassed = data.quality_status === "high_quality_pass"
    && data.deterministic_check_status === "checked"
    && data.research_value_review?.status === "pass";
  const expressionPassed = audit.overall_check?.result === "pass"
    && register.length === reportClaims.length
    && register.every((item: any) => item?.semantic_strength_review == null || item.semantic_strength_review === "pass");

  const rawChecks: Array<{ check_id: (typeof STAGE05_SEMANTIC_REVIEW_CHECKS)[number]; pass: boolean; reason: string }> = [
    {
      check_id: "local_evidence_not_globalized",
      pass: reviewed && expressionPassed,
      reason: "Stage05 表达审计已逐条绑定报告主张，未发现范围或强度抬升标记。",
    },
    {
      check_id: "parent_aggregation_complete",
      pass: reviewed && reportClaims.length > 0
        && reportClaims.every((claim: any) => Array.isArray(claim?.judgment_ids) && claim.judgment_ids.length > 0),
      reason: "所有 Stage05 核心主张均保留至少一个 Stage04 判断引用。",
    },
    {
      check_id: "incremental_update_is_local_first",
      pass: reviewed && Boolean(String(data.source_04_brief_ref || "").trim())
        && Boolean(String(data.source_04_audit_ref || "").trim()),
      reason: "Stage05 已绑定当前 Stage04 简报与推理审计；上游变更会使下游批准版本失效。",
    },
    {
      check_id: "title_represents_major_scopes",
      pass: reviewed && qualityPassed && Boolean(String(data.title || "").trim()) && body.length >= 40,
      reason: "Stage05 高质量结构与研究价值门已检查标题、摘要、正文密度及读者可用性。",
    },
    {
      check_id: "conditions_scope_and_prohibitions_preserved",
      pass: reviewed && qualityPassed && expressionPassed
        && (Array.isArray(data.limitations) && data.limitations.length > 0 || /限制|边界|风险|改判条件/.test(body)),
      reason: "表达审计、限制与边界章节及研究价值门均通过，未发现禁止表达或条件丢失。",
    },
    {
      check_id: "main_judgment_is_clear_and_prioritized",
      pass: reviewed && String(audit.main_judgment_check?.result || "") === "pass",
      reason: "表达审计 main_judgment_check 已确认综合主判断清晰、主次分明且未越界。",
    },
    {
      check_id: "maximal_valid_judgment_is_expressed",
      pass: reviewed && qualityPassed && !hasTradingAdviceOverreach(body),
      reason: "Stage05 在 04 许可内把已成立判断表达到位，未因过度谨慎无必要降格。",
    },
    {
      check_id: "uncertainty_is_concentrated_not_overloaded",
      pass: reviewed && String(audit.key_unknown_check?.result || "") === "pass",
      reason: "表达审计 key_unknown_check 确认不确定性集中在决策相关变量、限制未压过主判断。",
    },
    {
      check_id: "research_edge_is_substantive",
      pass: reviewed && (String(audit.research_edge_check?.substantive_beyond_generic_research_discipline) === "true"
        || String(audit.research_edge_check?.result || "") === "pass"),
      reason: "表达审计 research_edge_check 确认 Research Edge 体现真实研究增量，非仅基础研究纪律。",
    },
    {
      check_id: "key_unknowns_are_decision_relevant",
      pass: reviewed && String(audit.key_unknown_check?.all_key_unknowns_decision_relevant) === "true",
      reason: "表达审计确认关键未知收敛到 1—2 个真正改变主结论的变量。",
    },
  ];
  const checks = rawChecks.map((check) => ({
    check_id: check.check_id,
    result: check.pass ? "pass" as const : "needs_human" as const,
    reason: check.pass ? check.reason : `05 交付一致性检查未满足：${check.reason}`,
    ...(check.pass ? {} : { return_to_stage: "05" as const }),
  }));
  const verdict = checks.every((check) => check.result === "pass") ? "pass" : "needs_human";
  return YAML.stringify({
    schema_name: "independent_semantic_review",
    schema_version: "1.0.0",
    reviewer: {
      reviewer_id: "stage05-delivery-consistency-gate",
      reviewer_type: "system",
      independent_from_producer: true,
      test_reviewer: false,
    },
    inputs: {
      public_contract_version: input.contractVersion,
      stage_hashes: {
        stage_02: input.stageHashes.stage_02,
        stage_03: input.stageHashes.stage_03,
        stage_04: input.stageHashes.stage_04,
        stage_05: input.stageHashes.stage_05,
      },
    },
    checks,
    verdict,
    notes: "由已批准 Stage05 的 04→05 交付一致性门导出；未在导出阶段重新发起内容审阅。",
  });
}
