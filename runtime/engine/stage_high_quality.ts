/**
 * 各阶段 high_quality_pass 共用启发式（对齐 00A）。
 * minimum_pass 只要求可流转；high_quality_pass 额外要求实质密度与 deterministic_check_status=checked。
 */

export type StageQualityIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export function nonEmptyText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function requireDeterministicChecked(
  data: any,
  issues: StageQualityIssue[],
): void {
  if (nonEmptyText(data?.deterministic_check_status) !== "checked") {
    issues.push({
      severity: "error",
      code: "deterministic_not_checked",
      message: "high_quality_pass 要求 deterministic_check_status=checked",
    });
  }
}

const PLACEHOLDER_PATTERNS = [
  /^待/,
  /待识别/,
  /待补充/,
  /待填写/,
  /暂无/,
  /见正文/,
  /placeholder/i,
  /^TBD$/i,
];

export function looksLikePlaceholder(value: unknown): boolean {
  const text = nonEmptyText(value);
  if (!text || text.length < 4) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

/** 正文是否达到阶段「正式密度」下限（启发式，非字数硬性标准）。 */
export function bodyMeetsMinDensity(body: unknown, minChars: number): boolean {
  return nonEmptyText(body).length >= minChars;
}

export function applyHighQualityGate(
  issues: StageQualityIssue[],
  qualityStatus: string,
): StageQualityIssue[] {
  if (qualityStatus !== "high_quality_pass") {
    return issues.map((item) => (
      item.severity === "error"
        ? { ...item, severity: "warning" as const, message: `（high_quality 建议）${item.message}` }
        : item
    ));
  }
  return issues;
}

/** ensure* 路径：HQ 形态不过则降为 minimum_pass。 */
export function downgradeIfHighQualityFails(
  data: any,
  hqErrors: StageQualityIssue[],
): any {
  const next = data && typeof data === "object" ? data : {};
  if (nonEmptyText(next.quality_status) === "high_quality_pass" && hqErrors.length) {
    next.quality_status = "minimum_pass";
    if (nonEmptyText(next.deterministic_check_status) === "checked") {
      // 保留 checked 仅当结构最低通过；形态失败时改回 not_checked 更诚实
      next.deterministic_check_status = "not_checked";
    }
  }
  return next;
}
