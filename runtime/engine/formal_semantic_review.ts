/** 工作台 independent_review → 正式包独立语义审查 YAML。 */

import YAML from "yaml";
import {
  SEMANTIC_REVIEW_CHECKS,
  validateSemanticReview,
  type SemanticReviewCheck,
} from "./semantic_review";

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

  const usable = validated.valid && normalizedChecks.length === SEMANTIC_REVIEW_CHECKS.length;
  const checks = usable
    ? normalizedChecks.map((check) => ({
      check_id: check.check_id,
      result: check.result,
      reason: check.reason,
      ...(check.result === "pass" ? {} : { return_to_stage: check.return_to_stage || "04" }),
    }))
    : SEMANTIC_REVIEW_CHECKS.map((checkId) => ({
      check_id: checkId,
      result: "needs_human" as const,
      reason: validated.errors.length
        ? `工作台未提交合格五项语义审查：${validated.errors.join("；")}`
        : "工作台仅有批量 verdict，禁止映射补齐五项检查；须补逐项 semantic_checks",
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
