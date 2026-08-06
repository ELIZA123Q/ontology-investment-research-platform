import type { SourceRecord } from "../../schemas/types";

/**
 * The Stage03 evidence bindings, rather than the search/source registry, are
 * the authority for the frozen evidence package.  Search hits and radar leads
 * may remain in storage for audit, but must never leak into downstream
 * reasoning merely because their URL was seen once.
 */
export function evidenceBoundSourceIds(evidenceStage: unknown): Set<string> {
  const stage = evidenceStage && typeof evidenceStage === "object" ? evidenceStage as any : {};
  return new Set<string>(
    (stage.evidence_drafts || [])
      .filter((item: any) => item?.kind !== "gap")
      .flatMap((item: any) => item?.source_ids || [])
      .map(String)
      .filter(Boolean),
  );
}

export function evidenceBoundSources(sources: SourceRecord[], evidenceStage: unknown): SourceRecord[] {
  const ids = evidenceBoundSourceIds(evidenceStage);
  return sources.filter((source) => ids.has(source.id));
}
