/**
 * 客户端安全的补证差异展示辅助（禁止依赖 node:crypto / server-only）。
 * 服务端计算摘要见 evidence_supplement_diff.ts。
 */

export type EvidenceSupplementSummary = {
  visible: boolean;
  has_batch_execution: boolean;
  mode: string | null;
  batch_count: number;
  target_unit_ids: string[];
  added_source_keys: string[];
  added_evidence_ids: string[];
  changed_evidence_ids: string[];
  removed_evidence_ids: string[];
  remaining_gap_ids: string[];
  added_source_count: number;
  added_fact_count: number;
  changed_evidence_count: number;
  remaining_gap_count: number;
  zero_material_change: boolean;
  headline: string;
  detail_lines: string[];
};

/** 证据卡片角标：新增 / 变更 / 无变化 */
export function evidenceChangeBadge(
  evidenceId: string,
  summary: Pick<EvidenceSupplementSummary, "added_evidence_ids" | "changed_evidence_ids"> | null | undefined,
): "added" | "changed" | null {
  if (!summary) return null;
  if (summary.added_evidence_ids.includes(evidenceId)) return "added";
  if (summary.changed_evidence_ids.includes(evidenceId)) return "changed";
  return null;
}

export function evidenceChangeIds(summary: EvidenceSupplementSummary | null | undefined): Set<string> {
  if (!summary) return new Set();
  return new Set([...summary.added_evidence_ids, ...summary.changed_evidence_ids]);
}
