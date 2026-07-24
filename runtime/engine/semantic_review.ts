/**
 * 独立语义审查 — 从 Python semantic_review.py 迁移
 *
 * 五项固定检查，确保 04 阶段输出的语义一致性：
 * 1. local_evidence_not_globalized   — 局部证据未被全局化
 * 2. parent_aggregation_complete     — 父级聚合完整
 * 3. incremental_update_is_local_first — 增量更新局部优先
 * 4. title_represents_major_scopes   — 标题代表主要范围
 * 5. conditions_scope_and_prohibitions_preserved — 条件范围与禁止项保留
 *
 * 约束: 生产者不得自审; 生产模式禁止测试 reviewer
 */

export const SEMANTIC_REVIEW_CHECKS = [
  "local_evidence_not_globalized",
  "parent_aggregation_complete",
  "incremental_update_is_local_first",
  "title_represents_major_scopes",
  "conditions_scope_and_prohibitions_preserved",
] as const;

type CheckId = (typeof SEMANTIC_REVIEW_CHECKS)[number];
type CheckResult = "pass" | "fail" | "needs_human";

export type SemanticReviewCheck = {
  check_id: CheckId;
  result: CheckResult;
  reason: string;
  return_to_stage?: "02" | "03" | "04" | "05";
};

export type SemanticReviewInput = {
  reviewer_id: string;
  reviewer_type: "model" | "human" | "test_fixture";
  independent_from_producer: boolean;
  test_reviewer?: boolean;
  checks: SemanticReviewCheck[];
  verdict?: "pass" | "fail" | "needs_human";
};

/**
 * 验证独立语义审查合同
 */
export function validateSemanticReview(
  review: SemanticReviewInput,
  context: {
    producerId: string;
    runMode: "development" | "production";
    stageHashes: Record<string, string>;
    contractVersion: string;
  },
): { valid: boolean; errors: string[]; verdict: "pass" | "fail" | "needs_human" } {
  const errors: string[] = [];

  // 1. 审查者独立性
  if (review.reviewer_id === context.producerId || !review.independent_from_producer) {
    errors.push("生产者不得自审，reviewer 必须独立");
  }
  if (context.runMode === "production" && (review.reviewer_type === "test_fixture" || review.test_reviewer)) {
    errors.push("生产模式禁止测试 reviewer");
  }

  // 2. 五项检查完整性
  const checkMap = new Map<string, SemanticReviewCheck>();
  for (const check of review.checks) {
    if (!SEMANTIC_REVIEW_CHECKS.includes(check.check_id as CheckId)) {
      errors.push(`无效的审查 ID: ${check.check_id}`);
      continue;
    }
    if (checkMap.has(check.check_id)) {
      errors.push(`重复的审查 ID: ${check.check_id}`);
      continue;
    }
    if (!check.reason.trim()) {
      errors.push(`${check.check_id}: reason 不得为空`);
    }
    if (check.result !== "pass" && !check.return_to_stage) {
      errors.push(`${check.check_id}: 未通过时必须指定 return_to_stage`);
    }
    checkMap.set(check.check_id, check);
  }

  if (checkMap.size !== SEMANTIC_REVIEW_CHECKS.length) {
    errors.push(`审查必须完整覆盖全部 ${SEMANTIC_REVIEW_CHECKS.length} 项检查，当前仅 ${checkMap.size} 项`);
  }

  // 3. 派生 verdict
  const verdict = deriveVerdict(checkMap);
  if (review.verdict && review.verdict !== verdict) {
    errors.push(`verdict 应由检查项派生为 ${verdict}，而不是 ${review.verdict}`);
  }

  return { valid: errors.length === 0, errors, verdict };
}

function deriveVerdict(checkMap: Map<string, SemanticReviewCheck>): "pass" | "fail" | "needs_human" {
  const results = [...checkMap.values()];
  if (results.some((c) => c.result === "fail")) return "fail";
  if (results.some((c) => c.result === "needs_human")) return "needs_human";
  return "pass";
}

/**
 * 检查 Stage 04 输出中的常见语义违规模式。
 * 此函数在执行时可作为辅助检查，不能替代正式独立审查。
 */
export function prescreenCommonViolations(stage04Data: any, stage02Data: any): SemanticReviewCheck[] {
  const checks: SemanticReviewCheck[] = [];
  const judgments = stage04Data?.judgments || [];
  const units = stage02Data?.judgment_units || [];

  // 1. 局部证据全局化: 检查评估中 scope 是否被不当扩大
  for (const judgment of judgments) {
    const juId = judgment.judgment_unit_id;
    const matchingUnit = units.find((u: any) => String(u.id) === String(juId));
    if (matchingUnit) {
      const juScope = matchingUnit.scope || "";
      const jScope = judgment.scope_ref || "";
      if (juScope && jScope && !jScope.includes("全球") && juScope.includes("全球")) {
        checks.push({
          check_id: "local_evidence_not_globalized",
          result: "needs_human",
          reason: `JU ${juId} scope 在评估中被标记为全局范围`,
          return_to_stage: "04",
        });
      }
    }
  }

  // 5. 条件范围与禁止项保留
  for (const judgment of judgments) {
    if (judgment.strength === "J4") {
      checks.push({
        check_id: "conditions_scope_and_prohibitions_preserved",
        result: "needs_human",
        reason: `J4 判断需要人工确认所有禁止项未触发`,
        return_to_stage: "04",
      });
    }
  }

  return checks;
}
