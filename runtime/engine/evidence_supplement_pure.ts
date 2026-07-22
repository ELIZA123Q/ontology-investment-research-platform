import { createHash } from "node:crypto";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import {
  computeSourceCoverage,
  type SourceCoverageSummary,
} from "./source_coverage";
import type { SourceRecord } from "./types";

type EvidenceDraftLike = {
  id: string;
  statement: string;
  kind: string;
  direction?: string;
  source_ids?: string[];
  source_keys?: string[];
  judgment_unit_ids?: string[];
};

function isUsableSource(source: SourceRecord) {
  return source.usability_status === "usable"
    && source.retrieval_status === "captured"
    && Boolean(source.quote_verified);
}

export function evidenceFingerprint(draft: EvidenceDraftLike): string {
  return createHash("sha256").update(JSON.stringify({
    statement: draft.statement,
    kind: draft.kind,
    direction: draft.direction || "",
    source_ids: [...(draft.source_ids || [])].sort(),
    source_keys: [...(draft.source_keys || [])].sort(),
    judgment_unit_ids: [...(draft.judgment_unit_ids || [])].sort(),
  })).digest("hex");
}

export function findUnchangedEvidenceIds(baseEvidence: EvidenceDraftLike[], mergedEvidence: EvidenceDraftLike[]): Set<string> {
  const baseById = new Map(baseEvidence.map((item) => [item.id, evidenceFingerprint(item)]));
  const unchanged = new Set<string>();
  for (const draft of mergedEvidence) {
    const prior = baseById.get(draft.id);
    if (prior && prior === evidenceFingerprint(draft)) unchanged.add(draft.id);
  }
  return unchanged;
}

export function buildSupplementBrief(input: {
  coverage: SourceCoverageSummary;
  evidence: EvidenceDraftLike[];
  sources: SourceRecord[];
  /** stage_03 稿件中的 sources（含 source_key）；用于把 registry UUID 映射回 SRC-xx */
  draftSources?: Array<{ source_key?: string; source_id?: string | null; url?: string }>;
  requirements?: EvidenceRequirementProjection[];
}) {
  const sourceKeyById = new Map<string, string>();
  const sourceKeyByUrl = new Map<string, string>();
  for (const draft of input.draftSources || []) {
    const key = draft.source_key ? String(draft.source_key) : "";
    if (!key) continue;
    if (draft.source_id) sourceKeyById.set(String(draft.source_id), key);
    if (draft.url) sourceKeyByUrl.set(String(draft.url), key);
  }

  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const failedSources = input.sources
    .filter((source) => Boolean(source.url))
    .filter((source) => !isUsableSource(source))
    .map((source) => ({
      id: source.id,
      source_key: sourceKeyById.get(source.id) || sourceKeyByUrl.get(source.url) || null,
      title: source.title,
      url: source.url,
      retrieval_status: source.retrieval_status,
      quote_verified: source.quote_verified,
      usability_status: source.usability_status,
      failure_detail: source.failure_detail || "",
    }));

  const gapUnits = input.coverage.unit_coverage
    .filter((unit) => !unit.has_support_evidence || !unit.meets_independence)
    .map((unit) => ({
      unit_id: unit.unit_id,
      has_support_evidence: unit.has_support_evidence,
      meets_independence: unit.meets_independence,
      independent_source_groups: unit.independent_source_groups,
      minimum_independent_sources: unit.minimum_independent_sources,
    }));

  const reworkEvidence = input.evidence
    .filter((draft) => draft.kind !== "gap")
    .map((draft) => {
      const bound = (draft.source_ids || [])
        .map((id) => sourceById.get(id))
        .filter((source): source is SourceRecord => Boolean(source));
      if (!bound.length) {
        return { evidence_id: draft.id, issue: "missing_sources", statement: draft.statement };
      }
      if (bound.every((source) => !isUsableSource(source))) {
        return { evidence_id: draft.id, issue: "all_sources_unusable", statement: draft.statement };
      }
      return null;
    })
    .filter(Boolean);

  return {
    missing_core_types: input.coverage.missing_core_types,
    coverage_gap_count: input.coverage.coverage_gap_count,
    coverage_rate: input.coverage.coverage_rate,
    verification_rate: input.coverage.verification_rate,
    gap_units: gapUnits,
    failed_sources: failedSources,
    rework_evidence: reworkEvidence,
    requirements: input.requirements || [],
  };
}

export function buildSupplementCoverage(input: {
  sources: SourceRecord[];
  evidence: EvidenceDraftLike[];
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}) {
  return computeSourceCoverage(input);
}
