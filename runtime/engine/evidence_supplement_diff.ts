import {
  evidenceFingerprint,
  findUnchangedEvidenceIds,
} from "./evidence_supplement_pure";
import type { EvidenceSupplementSummary } from "./evidence_supplement_view";

export type { EvidenceSupplementSummary } from "./evidence_supplement_view";
export { evidenceChangeBadge, evidenceChangeIds } from "./evidence_supplement_view";

type DraftSource = {
  source_key?: string;
  source_id?: string;
  title?: string;
  url?: string;
};

type DraftEvidence = {
  id?: string;
  statement?: string;
  kind?: string;
  direction?: string;
  source_ids?: string[];
  source_keys?: string[];
  judgment_unit_ids?: string[];
};

type Stage03Like = {
  sources?: DraftSource[];
  evidence_drafts?: DraftEvidence[];
  stage03_batch_execution?: {
    mode?: string;
    batch_count?: number;
    batches?: Array<{
      batch_id?: string;
      target_unit_ids?: string[];
      status?: string;
      unchanged_evidence_ids?: string[];
    }>;
  };
};

function asEvidenceList(data: Stage03Like | null | undefined) {
  return (data?.evidence_drafts || [])
    .map((item) => ({
      id: String(item.id || ""),
      statement: String(item.statement || ""),
      kind: String(item.kind || "fact_draft"),
      direction: item.direction ? String(item.direction) : undefined,
      source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String) : [],
      source_keys: Array.isArray(item.source_keys) ? item.source_keys.map(String) : [],
      judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids.map(String) : [],
    }))
    .filter((item) => item.id);
}

function sourceKey(item: DraftSource): string {
  return String(item.source_key || item.source_id || item.url || item.title || "").trim();
}

function sourceKeys(data: Stage03Like | null | undefined): string[] {
  return [...new Set((data?.sources || []).map(sourceKey).filter(Boolean))];
}

/**
 * 研究员可读的「本轮补证结果」摘要。
 * 相对上一版 Stage03 计算新增/变更；若有 stage03_batch_execution 则视为补证轮次产物。
 */
export function buildEvidenceSupplementSummary(input: {
  current: Stage03Like | null | undefined;
  previous?: Stage03Like | null;
}): EvidenceSupplementSummary {
  const current = input.current || {};
  const previous = input.previous || null;
  const batch = current.stage03_batch_execution;
  const hasBatch = Boolean(batch && typeof batch === "object");
  const mode = hasBatch ? String(batch?.mode || "evidence_supplement") : null;
  const batchCount = hasBatch ? Number(batch?.batch_count || 0) : 0;
  const targetUnitIds = [...new Set(
    (batch?.batches || [])
      .flatMap((item) => item.target_unit_ids || [])
      .map(String)
      .filter(Boolean),
  )];

  const currentEvidence = asEvidenceList(current);
  const previousEvidence = asEvidenceList(previous || undefined);
  const previousIds = new Set(previousEvidence.map((item) => item.id));
  const unchanged = previous
    ? findUnchangedEvidenceIds(previousEvidence, currentEvidence)
    : new Set<string>();

  const addedEvidenceIds = currentEvidence
    .filter((item) => !previousIds.has(item.id))
    .map((item) => item.id);
  const changedEvidenceIds = currentEvidence
    .filter((item) => previousIds.has(item.id) && !unchanged.has(item.id))
    .map((item) => item.id);
  const removedEvidenceIds = previousEvidence
    .filter((item) => !currentEvidence.some((row) => row.id === item.id))
    .map((item) => item.id);

  const previousSourceKeys = new Set(sourceKeys(previous || undefined));
  const addedSourceKeys = sourceKeys(current).filter((key) => !previousSourceKeys.has(key));

  const remainingGapIds = currentEvidence
    .filter((item) => item.kind === "gap")
    .map((item) => item.id);
  const addedFactCount = currentEvidence.filter((item) =>
    addedEvidenceIds.includes(item.id) && item.kind !== "gap" && item.kind !== "conflict",
  ).length;

  const zeroMaterialChange = addedSourceKeys.length === 0
    && addedEvidenceIds.length === 0
    && changedEvidenceIds.length === 0;

  // 有补证批次标记，或相对上一版确有 diff，才对研究员展示。
  const visible = hasBatch || Boolean(previous && !zeroMaterialChange);

  let headline: string;
  if (!visible) {
    headline = "";
  } else if (zeroMaterialChange) {
    headline = "本轮补证未取到新材料";
  } else if (addedSourceKeys.length || addedFactCount) {
    headline = `本轮补证新增 ${addedSourceKeys.length} 个来源、${addedFactCount} 条事实草稿`;
  } else {
    headline = `本轮补证更新了 ${changedEvidenceIds.length} 条证据`;
  }

  const detailLines: string[] = [];
  if (visible) {
    if (targetUnitIds.length) {
      detailLines.push(`定向判断单元 ${targetUnitIds.length} 个`);
    }
    if (batchCount > 0) {
      detailLines.push(`执行批次 ${batchCount}`);
    }
    if (changedEvidenceIds.length) {
      detailLines.push(`变更证据 ${changedEvidenceIds.length} 条`);
    }
    if (remainingGapIds.length) {
      detailLines.push(`仍登记尚缺 ${remainingGapIds.length} 项`);
    } else if (!zeroMaterialChange) {
      detailLines.push("当前稿件中已无尚缺条目");
    }
    if (zeroMaterialChange) {
      detailLines.push("缺口可能仍在：模型未找到可用公开来源，或本轮未改写任何证据条目");
    }
  }

  return {
    visible,
    has_batch_execution: hasBatch,
    mode,
    batch_count: batchCount,
    target_unit_ids: targetUnitIds,
    added_source_keys: addedSourceKeys,
    added_evidence_ids: addedEvidenceIds,
    changed_evidence_ids: changedEvidenceIds,
    removed_evidence_ids: removedEvidenceIds,
    remaining_gap_ids: remainingGapIds,
    added_source_count: addedSourceKeys.length,
    added_fact_count: addedFactCount,
    changed_evidence_count: changedEvidenceIds.length,
    remaining_gap_count: remainingGapIds.length,
    zero_material_change: zeroMaterialChange,
    headline,
    detail_lines: detailLines,
  };
}

// Re-export fingerprint helpers for callers that only need the diff module surface.
export { evidenceFingerprint, findUnchangedEvidenceIds };
