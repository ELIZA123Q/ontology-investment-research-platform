import type { ResearchModelClient } from "../adapters/deepseek";
import { listSources, normalizeUrl, upsertSource } from "../adapters/db";
import { mergeStage03Patch, normalizeStage03Patch, objectId, type Stage03Patch } from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { computeSourceCoverage } from "./source_coverage";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";
import { controlledEvidencePatchSchema } from "./revise_schemas";
import { repairEvidencePreparationDraft } from "./workflow_projections";
import { demoteUnverifiedEvidenceDrafts } from "./evidence_draft_normalize";
import { schemas } from "./schemas";
import { promptForEvidenceSupplement } from "./prompts";
import {
  evidenceJudgmentTypeCardsForPrompt,
  evidenceMethodIdsFromApplications,
  loadSelectedMethodGuidance,
  mcpChannelHintsForPrompt,
} from "./method_guidance";
import {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
  applyRegistryFreezeFields,
  syncStage03DraftSourcesFromRegistry,
  dedupeStage03DraftSources,
} from "./evidence_supplement_pure";

export {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  buildSupplementCoverage,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
  applyRegistryFreezeFields,
  syncStage03DraftSourcesFromRegistry,
  dedupeStage03DraftSources,
} from "./evidence_supplement_pure";

/**
 * Source Registry 是抓取冻结字段的唯一权威。
 * 补证/重新取得来源/upsert 拒绝降级后，草稿常残留旧 locator/quote/captured_at，
 * 确认时会被校验打成「与 Source Registry 不一致」。确认前与抓取后都必须投影回草稿。
 */
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
  /** 抓取预算按补证优先级消耗；缺省时保持原顺序 */
  capturePriorityKeys?: string[];
  assertRunning: () => void;
  onCaptureProgress?: (index: number, total: number) => void;
}) {
  const keyMap = new Map<string, string>();
  const sources = input.data.sources || [];
  const allCaptureTargetsRaw = sources.filter((source: any) => {
    if (!source?.source_key || !source?.url) return false;
    if (input.affectedRefs.has(source.source_key)) return true;
    if (source.source_id) {
      const known = input.existingSources.find((item) => item.id === source.source_id);
      if (known) {
        Object.assign(source, applyRegistryFreezeFields(source, known));
      }
      keyMap.set(source.source_key, source.source_id);
      return false;
    }
    let normalized = "";
    try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
    const existing = input.existingSources.find((item) => item.normalized_url === normalized);
    if (existing) {
      source.source_id = existing.id;
      Object.assign(source, applyRegistryFreezeFields(source, existing));
      keyMap.set(source.source_key, existing.id);
      return false;
    }
    return true;
  });
  const allCaptureTargets = input.capturePriorityKeys?.length
    ? orderByCapturePriority(allCaptureTargetsRaw, input.capturePriorityKeys)
    : allCaptureTargetsRaw;
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
    Object.assign(source, applyRegistryFreezeFields(source, saved));
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
  // 再按当前 Registry 全量投影：覆盖 upsert 拒绝降级返回 prior、以及未重抓的已绑定源。
  const projected = syncStage03DraftSourcesFromRegistry(input.data, listSources(input.runId));
  return repairEvidencePreparationDraft(demoteUnverifiedEvidenceDrafts(projected.data));
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
    draftSources: input.baseData.sources || [],
    requirements: input.requirements,
    methodApplications: input.baseData.method_applications || [],
  });

  input.onProgress?.({ round: 0, message: "正在按优先级队列针对缺口与失败来源生成补证 patch…" });
  const judgmentTypes = Array.isArray((input.supplementContext as any)?.judgmentTypes)
    ? [...(input.supplementContext as any).judgmentTypes].map(String)
    : [];
  const kb03Ids = evidenceMethodIdsFromApplications(input.baseData.method_applications || []);
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
      selected_method_guidance: loadSelectedMethodGuidance(kb03Ids),
      evidence_judgment_type_cards: evidenceJudgmentTypeCardsForPrompt(judgmentTypes),
      mcp_channel_hints: mcpChannelHintsForPrompt(),
      patch_contract: {
        id_space: "source_key/application_id/evidence_id",
        note: "affected_object_refs 与 upserts/removals 使用同一套稳定业务 ID（如 SRC-09、MA-EV-01、EV-1），不是 registry UUID。新增对象只需出现在 upserts；Runtime 会自动补齐 affected_object_refs。",
      },
      ...input.supplementContext,
    }, null, 2),
    {
      webSearch: true,
      ontologyTools: true,
      runId: input.runId,
      // 提交时即把 upserts/removals ID 并入 affected，避免 schema 过关后 merge 再因漏声明失败。
      repairOutput: (data) => normalizeStage03Patch(data as Stage03Patch),
    },
  );
  input.assertRunning();

  const patch = normalizeStage03Patch(result.data);
  const merged = mergeStage03Patch(input.baseData, patch);
  const repaired = repairEvidencePreparationDraft(merged);
  // 抓取前先过契约：避免 gap 残留 source_keys / 非法 kind 烧完一轮抓取才失败。
  const precheck = schemas.stage_03.safeParse(repaired);
  if (!precheck.success) {
    throw new Error(JSON.stringify(precheck.error.issues));
  }
  const affectedRefs = new Set(patch.affected_object_refs);
  // 合并后按“失败源/返工绑定/单元缺口/其余新线索”重排抓取顺序，预算先喂高优先项。
  const capturePriorityKeys = buildCapturePriorityKeys({
    draftSources: repaired.sources || [],
    evidence: repaired.evidence_drafts || [],
    failedSourceKeys: brief.failed_sources
      .map((item) => item.source_key)
      .filter((key): key is string => Boolean(key)),
    reworkEvidenceIds: brief.rework_evidence.map((item) => item.evidence_id),
    gapUnitIds: brief.gap_units.map((item) => item.unit_id),
  });
  const withSnapshots = await applyStage03SourceSnapshots({
    runId: input.runId,
    data: repaired,
    affectedRefs,
    existingSources: input.existingSources,
    maxNewSources: input.maxSourceCount === undefined
      ? undefined
      : Math.max(0, input.maxSourceCount - input.existingSources.length),
    capturePriorityKeys,
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
