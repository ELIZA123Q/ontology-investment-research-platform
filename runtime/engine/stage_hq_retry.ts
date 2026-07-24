/**
 * 各阶段生成后的高质量门禁与静默重试上下文。
 * 用户无感：失败项注入 prompt 重试一次；仍失败则不可确认，不降为可流转的 minimum_pass。
 */

import { collectStage01HighQualityIssues } from "./stage01_contract";
import { collectStage02HighQualityIssues } from "./stage02_documents";
import { collectStage03HighQualityIssues } from "./stage03_documents";
import { collectStage04HighQualityIssues } from "./stage04_documents";
import { collectStage05HighQualityIssues, looksLikeDeterministicSkeleton } from "./stage05_quality";
import type { StageQualityIssue } from "./stage_high_quality";
import type { ArtifactKind } from "./types";

export const HQ_RETRY_KEY = "quality_retry_notes";

export function collectStageHighQualityErrors(
  kind: ArtifactKind,
  data: any,
): StageQualityIssue[] {
  if (kind === "stage_01") {
    return collectStage01HighQualityIssues(data).filter((item) => item.severity === "error");
  }
  if (kind === "stage_02") {
    return collectStage02HighQualityIssues(data).filter((item) => item.severity === "error");
  }
  if (kind === "stage_03") {
    return collectStage03HighQualityIssues(data).filter((item) => item.severity === "error");
  }
  if (kind === "stage_04") {
    return collectStage04HighQualityIssues(data).filter((item) => item.severity === "error");
  }
  if (kind === "stage_05") {
    return collectStage05HighQualityIssues({
      body: String(data?.document_markdown || ""),
      research_edge: Array.isArray(data?.research_edge) ? data.research_edge : [],
      deterministic_check_status: String(data?.deterministic_check_status || ""),
      from_skeleton: Boolean(data?.__from_skeleton)
        || looksLikeDeterministicSkeleton(String(data?.document_markdown || "")),
    }).filter((item) => item.severity === "error");
  }
  return [];
}

/** 生成稿是否达到可确认的高质量（含自称 HQ 且无 HQ error）。 */
export function meetsHighQualityForReview(kind: ArtifactKind, data: any): boolean {
  const quality = String(data?.quality_status || "");
  if (quality !== "high_quality_pass") return false;
  return collectStageHighQualityErrors(kind, data).length === 0;
}

export function buildQualityRetryNotes(issues: StageQualityIssue[]): string[] {
  return issues.map((item) => `${item.code}: ${item.message}`);
}

/**
 * 生成结束时若仍未 HQ：标记为不可确认的返工态，禁止冒充 minimum_pass。
 */
export function markGenerationBelowHighQuality(data: any, issues: StageQualityIssue[]): any {
  const next = data && typeof data === "object" ? data : {};
  next.quality_status = "return_required";
  next.return_required = true;
  next.deterministic_check_status = "not_checked";
  next.status_reason = `本稿密度或完备度未达可交接标准：${issues.map((item) => item.message).join("；") || "请重新生成"}`;
  next[HQ_RETRY_KEY] = buildQualityRetryNotes(issues);
  return next;
}

/** 强制模型以 HQ 为目标；ensure 路径不得再静默降档后当作可确认稿。 */
export function forceHighQualityTarget(data: any): any {
  const next = data && typeof data === "object" ? data : {};
  if (String(next.task_disposition || "") === "needs_clarification") return next;
  next.quality_status = "high_quality_pass";
  if (!next.deterministic_check_status || next.deterministic_check_status === "not_checked") {
    // 由各阶段 ensure / HQ 检查决定是否真正 checked；此处仅声明目标
  }
  return next;
}
