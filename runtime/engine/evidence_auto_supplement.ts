import type { ResearchModelClient } from "../adapters/deepseek";
import { normalizeUrl, upsertSource } from "../adapters/db";
import { mergeStage03Patch, objectId } from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { computeSourceCoverage } from "./source_coverage";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";
import { controlledEvidencePatchSchema } from "./revise_schemas";
import { repairEvidencePreparationDraft } from "./workflow_projections";
import { schemas } from "./schemas";
import { promptForEvidenceSupplement } from "./prompts";
import {
  buildSupplementBrief,
  findUnchangedEvidenceIds,
} from "./evidence_supplement_pure";

export {
  buildSupplementBrief,
  buildSupplementCoverage,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
} from "./evidence_supplement_pure";

export function stage03AutoSupplementMaxRounds(): number {
  const raw = process.env.STAGE03_AUTO_SUPPLEMENT_MAX_ROUNDS;
  const parsed = raw ? Number(raw) : 3;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

export async function applyStage03SourceSnapshots(input: {
  runId: string;
  data: any;
  affectedRefs: Set<string>;
  existingSources: SourceRecord[];
  maxNewSources?: number;
  assertRunning: () => void;
  onCaptureProgress?: (index: number, total: number) => void;
}) {
  const keyMap = new Map<string, string>();
  const sources = input.data.sources || [];
  const allCaptureTargets = sources.filter((source: any) => {
    if (!source?.source_key || !source?.url) return false;
    if (input.affectedRefs.has(source.source_key)) return true;
    if (source.source_id) {
      keyMap.set(source.source_key, source.source_id);
      return false;
    }
    let normalized = "";
    try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
    const existing = input.existingSources.find((item) => item.normalized_url === normalized);
    if (existing) {
      source.source_id = existing.id;
      keyMap.set(source.source_key, existing.id);
      return false;
    }
    return true;
  });
  const captureTargets = input.maxNewSources === undefined
    ? allCaptureTargets
    : allCaptureTargets.slice(0, Math.max(0, input.maxNewSources));
  const deferredTargets = allCaptureTargets.slice(captureTargets.length);

  if (deferredTargets.length) {
    for (const source of deferredTargets) {
      Object.assign(source, {
        source_id: null,
        captured_at: null,
        content_hash: null,
        final_url: null,
        retrieval_status: "not_attempted",
        quote_verified: false,
      });
    }
    input.data.unresolved_gaps = [
      ...new Set([
        ...(Array.isArray(input.data.unresolved_gaps) ? input.data.unresolved_gaps.map(String) : []),
        `来源预算已用尽：${deferredTargets.length} 个候选来源未抓取，需人工提高预算或收窄问题`,
      ]),
    ];
  }

  for (const [index, source] of captureTargets.entries()) {
    input.assertRunning();
    input.onCaptureProgress?.(index + 1, captureTargets.length);
    const snapshot = await captureSourceSnapshot({
      url: source.url,
      locator: source.locator,
      source_quote: source.source_quote,
    });
    input.assertRunning();
    const saved = upsertSource(input.runId, {
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      published_at: source.published_at,
      source_type: source.source_type,
      source_tier: source.source_tier,
      authority_type: source.authority_type || "unknown",
      search_excerpt: source.search_excerpt,
      locator: snapshot.locator,
      captured_at: snapshot.captured_at,
      content_hash: snapshot.content_hash,
      usability_status: snapshot.usability_status,
      failure_category: snapshot.failure_category,
      failure_detail: snapshot.failure_detail,
      final_url: snapshot.final_url,
      content_mime: snapshot.content_mime,
      http_status: snapshot.http_status,
      retrieval_status: snapshot.retrieval_status,
      snapshot_text: snapshot.snapshot_text,
      source_quote: snapshot.source_quote,
      quote_verified: snapshot.quote_verified,
    });
    Object.assign(source, {
      source_id: saved.id,
      captured_at: snapshot.captured_at,
      content_hash: snapshot.content_hash,
      final_url: snapshot.final_url,
      retrieval_status: snapshot.retrieval_status,
      quote_verified: snapshot.quote_verified,
      usability_status: snapshot.usability_status,
    });
    keyMap.set(source.source_key, saved.id);
  }

  for (const source of sources) {
    if (!keyMap.has(source.source_key) && source.source_id) {
      keyMap.set(source.source_key, source.source_id);
    }
  }
  for (const evidence of input.data.evidence_drafts || []) {
    evidence.source_ids = (evidence.source_keys || []).map((key: string) => keyMap.get(key)).filter(Boolean);
  }
  return input.data;
}

export async function runEvidenceSupplementRound(input: {
  client: ResearchModelClient;
  runId: string;
  baseData: any;
  supplementContext: Record<string, unknown>;
  assertRunning: () => void;
  onProgress?: (event: { round: number; message: string }) => void;
  existingSources: SourceRecord[];
  maxSourceCount?: number;
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}) {
  const brief = buildSupplementBrief({
    coverage: computeSourceCoverage({
      sources: input.existingSources,
      evidence: input.baseData.evidence_drafts || [],
      requirements: input.requirements,
      cutoffMs: input.cutoffMs,
    }),
    evidence: input.baseData.evidence_drafts || [],
    sources: input.existingSources,
    requirements: input.requirements,
  });

  input.onProgress?.({ round: 0, message: "正在针对缺口与失败来源生成补证 patch…" });
  const result = await input.client.generateStructured(
    "evidence_supplement",
    controlledEvidencePatchSchema,
    promptForEvidenceSupplement(),
    JSON.stringify({
      supplement_brief: brief,
      current_evidence_draft: {
        method_applications: input.baseData.method_applications || [],
        sources: input.baseData.sources || [],
        evidence_drafts: input.baseData.evidence_drafts || [],
        unresolved_gaps: input.baseData.unresolved_gaps || [],
      },
      ...input.supplementContext,
    }, null, 2),
    {
      webSearch: true,
      ontologyTools: true,
      runId: input.runId,
      repairOutput: (data) => data,
    },
  );
  input.assertRunning();

  const patch = result.data;
  const merged = mergeStage03Patch(input.baseData, {
    affected_object_refs: patch.affected_object_refs,
    upserts: patch.upserts,
    removals: patch.removals,
  });
  const repaired = repairEvidencePreparationDraft(merged);
  const affectedRefs = new Set(patch.affected_object_refs);
  const withSnapshots = await applyStage03SourceSnapshots({
    runId: input.runId,
    data: repaired,
    affectedRefs,
    existingSources: input.existingSources,
    maxNewSources: input.maxSourceCount === undefined
      ? undefined
      : Math.max(0, input.maxSourceCount - input.existingSources.length),
    assertRunning: input.assertRunning,
    onCaptureProgress: (index, total) => {
      input.onProgress?.({ round: index, message: `补证来源抓取 ${index}/${total}` });
    },
  });
  schemas.stage_03.parse(withSnapshots);
  return {
    data: withSnapshots,
    patch,
    usage: result.usage,
    toolUsage: result.toolUsage,
    unchangedEvidenceIds: findUnchangedEvidenceIds(input.baseData.evidence_drafts || [], withSnapshots.evidence_drafts || []),
  };
}

export function collectAffectedSourceKeys(patch: { affected_object_refs: string[]; upserts: Record<string, unknown[]> }) {
  const keys = new Set<string>();
  for (const source of patch.upserts.sources || []) {
    const id = objectId(source);
    if (id) keys.add(id);
  }
  for (const ref of patch.affected_object_refs) {
    if (ref.startsWith("SRC-")) keys.add(ref);
  }
  return keys;
}
