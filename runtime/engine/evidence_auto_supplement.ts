import type { ResearchModelClient } from "../adapters/deepseek";
import { listSources, normalizeUrl, upsertSource } from "../adapters/db";
import {
  expandAffectedObjectRefs,
  mergeStage03Patch,
  normalizeStage03Patch,
  objectId,
  type Stage03Patch,
} from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { computeSourceCoverage } from "./source_coverage";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";
import { controlledEvidencePatchSchema } from "./revise_schemas";
import { repairEvidencePreparationDraft } from "./workflow_projections";
import {
  demoteUnverifiedEvidenceDrafts,
  normalizeEvidenceDraftNulls,
} from "./evidence_draft_normalize";
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

export type Stage03EvidenceBatch = {
  batch_id: string;
  unit_ids: string[];
  requirements: EvidenceRequirementProjection[];
};

/**
 * Stage03 不再把全部判断单元压进一次工具环。批次上限不是丢弃上限：
 * 当单元很多时自动增大每批大小，确保所有单元仍被覆盖。
 */
export function partitionStage03EvidenceBatches(input: {
  judgmentUnitIds: string[];
  requirements?: EvidenceRequirementProjection[];
  preferredUnitsPerBatch?: number;
  maxBatches?: number;
}): Stage03EvidenceBatch[] {
  const unitIds = [...new Set(input.judgmentUnitIds.map(String).filter(Boolean))];
  if (!unitIds.length) return [];
  const preferred = Math.max(1, Math.floor(input.preferredUnitsPerBatch || 2));
  const maxBatches = Math.max(1, Math.floor(input.maxBatches || 4));
  const unitsPerBatch = Math.max(preferred, Math.ceil(unitIds.length / maxBatches));
  const requirements = input.requirements || [];
  const batches: Stage03EvidenceBatch[] = [];
  for (let index = 0; index < unitIds.length; index += unitsPerBatch) {
    const selected = unitIds.slice(index, index + unitsPerBatch);
    const selectedSet = new Set(selected);
    batches.push({
      batch_id: `EB-${String(batches.length + 1).padStart(2, "0")}`,
      unit_ids: selected,
      requirements: requirements.filter((item) =>
        item.judgment_unit_ids.some((id) => selectedSet.has(String(id))),
      ),
    });
  }
  return batches;
}

export function stage03EvidenceBatchConfig() {
  const unitsRaw = Number(process.env.STAGE03_EVIDENCE_UNITS_PER_BATCH || 2);
  const batchesRaw = Number(process.env.STAGE03_EVIDENCE_MAX_BATCHES || 4);
  return {
    preferredUnitsPerBatch: Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.floor(unitsRaw) : 2,
    maxBatches: Number.isFinite(batchesRaw) && batchesRaw > 0 ? Math.floor(batchesRaw) : 4,
  };
}

export function stage03AcquisitionCallCount(toolUsage: unknown): number {
  if (!toolUsage || typeof toolUsage !== "object" || Array.isArray(toolUsage)) return 0;
  const usage = toolUsage as Record<string, unknown>;
  return ["web_search_calls", "public_page_fetch_calls", "mcp_evidence_calls"]
    .reduce((sum, key) => {
      const value = Number(usage[key] || 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
}

/**
 * 模型没有调用任何取证工具时，patch 只能表达“仍有缺口”，不能创造来源或事实。
 * 已有非 gap 事实的修改会被丢弃以避免误伤已核验证据；新事实/旧 gap 则显式退化为 gap。
 */
export function enforceStage03AcquisitionHonesty(input: {
  patch: Stage03Patch;
  baseData: any;
  toolUsage: unknown;
  targetUnitIds?: string[];
}): Stage03Patch {
  const normalized = normalizeStage03Patch(structuredClone(input.patch));
  if (stage03AcquisitionCallCount(input.toolUsage) > 0) return normalized;

  const baseEvidence = new Map<string, any>(
    (Array.isArray(input.baseData?.evidence_drafts) ? input.baseData.evidence_drafts : [])
      .map((item: any) => [String(item?.id || ""), item])
      .filter(([id]: [string, any]) => Boolean(id)),
  );
  const targetUnitIds = [...new Set((input.targetUnitIds || []).map(String).filter(Boolean))];
  const honestyGaps: string[] = [];
  const evidenceUpserts = (normalized.upserts.evidence_drafts || []).flatMap((item: any) => {
    const id = String(item?.id || "");
    if (!id) return [];
    const prior = baseEvidence.get(id);
    if (prior && prior.kind !== "gap") {
      honestyGaps.push(`${id}: 本批未调用取证工具，已忽略对既有事实的修改`);
      return [];
    }
    const unitIds = Array.isArray(item?.judgment_unit_ids) && item.judgment_unit_ids.length
      ? item.judgment_unit_ids.map(String).filter(Boolean)
      : Array.isArray(prior?.judgment_unit_ids) && prior.judgment_unit_ids.length
        ? prior.judgment_unit_ids.map(String).filter(Boolean)
        : targetUnitIds;
    const statement = String(item?.statement || prior?.statement || `证据候选 ${id} 尚未取得可核验正文`);
    const limitations = [
      ...(Array.isArray(prior?.limitations) ? prior.limitations.map(String).filter(Boolean) : []),
      ...(Array.isArray(item?.limitations) ? item.limitations.map(String).filter(Boolean) : []),
      "本批未调用 search/fetch/MCP 取证工具；Runtime 禁止把模型内生知识登记为事实",
    ];
    honestyGaps.push(`${id}: 本批无取证工具调用，只保留为显式缺口`);
    return [normalizeEvidenceDraftNulls({
      ...prior,
      ...item,
      id,
      statement,
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: unitIds,
      ontology_node_ids: Array.isArray(item?.ontology_node_ids)
        ? item.ontology_node_ids.map(String)
        : Array.isArray(prior?.ontology_node_ids) ? prior.ontology_node_ids.map(String) : [],
      requirement: String(
        item?.requirement
        || prior?.requirement
        || `取得可定位、可逐字核验的公开正文以支撑：${statement.slice(0, 120)}`,
      ),
      evidence_role: ["support", "counter", "context", "boundary"].includes(String(item?.evidence_role || prior?.evidence_role || ""))
        ? String(item?.evidence_role || prior?.evidence_role)
        : String(item?.direction || "") === "weaken" ? "counter" : "support",
      minimum_independent_sources: Number.isFinite(Number(item?.minimum_independent_sources ?? prior?.minimum_independent_sources))
        ? Math.max(0, Math.floor(Number(item?.minimum_independent_sources ?? prior?.minimum_independent_sources)))
        : 1,
      limitations: [...new Set(limitations)],
    })];
  });

  normalized.upserts.sources = [];
  normalized.upserts.evidence_drafts = evidenceUpserts;
  normalized.upserts.method_applications = (normalized.upserts.method_applications || []).map((item: any) => {
    const capability = String(item?.capability_type || "");
    if (capability && capability !== "evidence") return item;
    return {
      ...item,
      status: "blocked",
      execution_summary: "本批未发生可审计的外部取证调用；不得宣称方法已执行成功",
      limitations: [
        ...(Array.isArray(item?.limitations) ? item.limitations.map(String).filter(Boolean) : []),
        "无取证工具调用，方法状态由 Runtime 保守降为 blocked",
      ],
      alternatives: Array.isArray(item?.alternatives) && item.alternatives.length
        ? item.alternatives
        : [{
          method_id: String(item?.method_id || "unknown"),
          decision: "retry_with_source_acquisition",
          reason: "仅在可用搜索、正文抓取或证据 MCP 通道恢复后重试",
        }],
    };
  });
  normalized.upserts.unresolved_gaps = [
    ...new Set([
      ...(normalized.upserts.unresolved_gaps || []).map(String),
      ...honestyGaps,
      ...(honestyGaps.length || (normalized.upserts.sources || []).length
        ? []
        : ["本批未调用取证工具，未形成任何新增可核验证据"]),
    ]),
  ];
  normalized.removals = {
    ...(normalized.removals || {}),
    sources: [],
    evidence_drafts: [],
  };
  normalized.revision_summary = [
    String(normalized.revision_summary || "").trim(),
    "Runtime acquisition honesty gate：本批无取证工具调用；未登记新增来源或事实，仅保留/补充 gap。",
  ].filter(Boolean).join(" ");
  normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
  return normalized;
}

/** 只把本批相关对象送给模型，但 patch 始终合并回完整 baseData。 */
export function scopeStage03DataForBatch(baseData: any, targetUnitIds: string[]) {
  const target = new Set(targetUnitIds.map(String));
  const intersects = (ids: unknown) =>
    Array.isArray(ids) && ids.some((id) => target.has(String(id)));
  const evidence = (baseData.evidence_drafts || []).filter((item: any) =>
    intersects(item?.judgment_unit_ids),
  );
  const evidenceIds = new Set<string>(
    evidence.map((item: any) => String(item?.id || "")).filter(Boolean),
  );
  return {
    method_applications: (baseData.method_applications || []).filter((item: any) =>
      intersects(item?.target_judgment_unit_refs),
    ),
    sources: (baseData.sources || []).filter((source: any) =>
      (evidence || []).some((item: any) =>
        (item?.source_keys || []).includes(source?.source_key)
        || (item?.source_ids || []).includes(source?.source_id),
      ),
    ),
    evidence_drafts: evidence,
    unresolved_gaps: (baseData.unresolved_gaps || []).filter((item: unknown) =>
      [...evidenceIds].some((id) => String(item).includes(id)),
    ),
  };
}

function stableObjectId(item: unknown): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const value = item as Record<string, unknown>;
  return String(value.source_key || value.id || value.application_id || "");
}

function uniqueStableIds(items: unknown[]): Set<string> {
  return new Set(items.map(stableObjectId).filter(Boolean));
}

function nextNamespacedId(
  original: string,
  namespace: string,
  occupied: Set<string>,
): string {
  const cleanNamespace = namespace.replace(/[^A-Za-z0-9_-]+/g, "-") || "BATCH";
  const cleanOriginal = original.replace(/[^A-Za-z0-9_-]+/g, "-") || "NEW";
  const stem = `${cleanOriginal}-${cleanNamespace}`;
  let candidate = stem;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}

function replaceRefs(value: unknown, refMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceRefs(item, refMap));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (refMap.has(value)) return refMap.get(value);
    for (const [prior, next] of refMap) {
      if (value.startsWith(`${prior}:`) || value.startsWith(`${prior} `)) {
        return `${next}${value.slice(prior.length)}`;
      }
    }
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    next[key] = replaceRefs(item, refMap);
  }
  return next;
}

/**
 * 将模型 patch 限制在当前批次，避免不同批次复用 SRC/EV ID 覆盖彼此，
 * 并让 unresolved_gaps 只替换当前批次对应的缺口。
 */
export function isolateStage03BatchPatch(input: {
  baseData: any;
  patch: Stage03Patch;
  targetUnitIds: string[];
  namespace: string;
}): Stage03Patch {
  const targetUnits = new Set(input.targetUnitIds.map(String).filter(Boolean));
  if (!targetUnits.size) return normalizeStage03Patch(input.patch);

  const scoped = scopeStage03DataForBatch(input.baseData, [...targetUnits]);
  const globalSources = Array.isArray(input.baseData?.sources) ? input.baseData.sources : [];
  const globalEvidence = Array.isArray(input.baseData?.evidence_drafts) ? input.baseData.evidence_drafts : [];
  const globalMethods = Array.isArray(input.baseData?.method_applications) ? input.baseData.method_applications : [];
  const scopedSourceIds = uniqueStableIds(scoped.sources || []);
  const scopedEvidenceIds = uniqueStableIds(scoped.evidence_drafts || []);
  const scopedMethodIds = uniqueStableIds(scoped.method_applications || []);
  const occupiedSourceIds = uniqueStableIds(globalSources);
  const occupiedEvidenceIds = uniqueStableIds(globalEvidence);
  const sourceRefsOutsideBatch = new Set<string>();
  for (const evidence of globalEvidence) {
    const unitIds = Array.isArray(evidence?.judgment_unit_ids)
      ? evidence.judgment_unit_ids.map(String)
      : [];
    if (unitIds.some((id: string) => !targetUnits.has(id))) {
      for (const sourceKey of evidence?.source_keys || []) sourceRefsOutsideBatch.add(String(sourceKey));
    }
  }

  const normalized = normalizeStage03Patch(structuredClone(input.patch));
  const sourceRefMap = new Map<string, string>();
  const evidenceRefMap = new Map<string, string>();
  const sourceUpserts = Array.isArray(normalized.upserts.sources)
    ? normalized.upserts.sources
    : [];
  for (const source of sourceUpserts as any[]) {
    const sourceKey = String(source?.source_key || "");
    if (!sourceKey) continue;
    const collidesOutsideBatch = occupiedSourceIds.has(sourceKey)
      && (!scopedSourceIds.has(sourceKey) || sourceRefsOutsideBatch.has(sourceKey));
    if (collidesOutsideBatch) {
      const nextId = nextNamespacedId(sourceKey, input.namespace, occupiedSourceIds);
      sourceRefMap.set(sourceKey, nextId);
      source.source_key = nextId;
    } else {
      occupiedSourceIds.add(sourceKey);
    }
  }

  const evidenceUpserts = Array.isArray(normalized.upserts.evidence_drafts)
    ? normalized.upserts.evidence_drafts
    : [];
  for (const evidence of evidenceUpserts as any[]) {
    const evidenceId = String(evidence?.id || "");
    if (!evidenceId) continue;
    const baseEvidence = globalEvidence.find((item: any) => String(item?.id || "") === evidenceId);
    const unitIds = Array.isArray(evidence?.judgment_unit_ids)
      ? evidence.judgment_unit_ids.map(String)
      : Array.isArray(baseEvidence?.judgment_unit_ids)
        ? baseEvidence.judgment_unit_ids.map(String)
        : [];
    if (!unitIds.length || unitIds.some((id: string) => !targetUnits.has(id))) {
      throw new Error(`${evidenceId} 超出当前 Stage03 批次判断单元范围`);
    }
    if (occupiedEvidenceIds.has(evidenceId) && !scopedEvidenceIds.has(evidenceId)) {
      const nextId = nextNamespacedId(evidenceId, input.namespace, occupiedEvidenceIds);
      evidenceRefMap.set(evidenceId, nextId);
      evidence.id = nextId;
    } else {
      occupiedEvidenceIds.add(evidenceId);
    }
  }

  const allRefMap = new Map([...sourceRefMap, ...evidenceRefMap]);
  normalized.upserts = replaceRefs(normalized.upserts, allRefMap) as Record<string, unknown[]>;

  for (const method of normalized.upserts.method_applications || []) {
    const methodId = stableObjectId(method);
    if (!methodId || !scopedMethodIds.has(methodId)) {
      throw new Error(`${methodId || "未命名 MethodApplication"} 不属于当前 Stage03 批次；禁止新建或跨批修改方法身份`);
    }
  }

  const removals = normalized.removals || {};
  const allowedRemovalIds = new Set([
    ...scopedEvidenceIds,
    ...scopedMethodIds,
    ...[...scopedSourceIds].filter((id) => !sourceRefsOutsideBatch.has(id)),
  ]);
  for (const [section, ids] of Object.entries(removals)) {
    if (section === "unresolved_gaps") {
      for (const id of ids || []) {
        if (![...scopedEvidenceIds].some((evidenceId) =>
          String(id) === evidenceId || String(id).startsWith(`${evidenceId}:`))) {
          throw new Error(`缺口删除 ${id} 不属于当前 Stage03 批次`);
        }
      }
      continue;
    }
    for (const id of ids || []) {
      if (!allowedRemovalIds.has(String(id))) {
        throw new Error(`${section} 删除 ${id} 超出当前 Stage03 批次范围`);
      }
    }
  }

  if (Array.isArray(normalized.upserts.unresolved_gaps)) {
    const targetEvidenceIds = scopedEvidenceIds;
    const nonTargetGaps = (Array.isArray(input.baseData?.unresolved_gaps)
      ? input.baseData.unresolved_gaps
      : []
    ).map(String).filter((gap: string) =>
      ![...targetEvidenceIds].some((id) =>
        gap === id || gap.startsWith(`${id}:`) || gap.startsWith(`${id} `)),
    );
    normalized.upserts.unresolved_gaps = [
      ...new Set([...nonTargetGaps, ...normalized.upserts.unresolved_gaps.map(String)]),
    ];
  }

  normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
  return normalized;
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
  targetUnitIds?: string[];
  maxToolRounds?: number;
  idNamespace?: string;
}) {
  const targetUnitIds = [...new Set((input.targetUnitIds || []).map(String).filter(Boolean))];
  const targetSet = new Set(targetUnitIds);
  const scopedRequirements = targetSet.size
    ? (input.requirements || []).filter((item) =>
      item.judgment_unit_ids.some((id) => targetSet.has(String(id))),
    )
    : input.requirements;
  const scopedBase = targetSet.size
    ? scopeStage03DataForBatch(input.baseData, targetUnitIds)
    : input.baseData;
  const brief = buildSupplementBrief({
    coverage: computeSourceCoverage({
      sources: input.existingSources,
      evidence: scopedBase.evidence_drafts || [],
      requirements: scopedRequirements,
      cutoffMs: input.cutoffMs,
    }),
    evidence: scopedBase.evidence_drafts || [],
    sources: input.existingSources,
    draftSources: scopedBase.sources || [],
    requirements: scopedRequirements,
    methodApplications: scopedBase.method_applications || [],
  });

  input.onProgress?.({ round: 0, message: "正在按优先级队列针对缺口与失败来源生成补证 patch…" });
  const judgmentTypes = Array.isArray((input.supplementContext as any)?.judgmentTypes)
    ? [...(input.supplementContext as any).judgmentTypes].map(String)
    : [];
  const kb03Ids = evidenceMethodIdsFromApplications(scopedBase.method_applications || []);
  const result = await input.client.generateStructured(
    "evidence_supplement",
    controlledEvidencePatchSchema,
    promptForEvidenceSupplement(),
    JSON.stringify({
      supplement_brief: brief,
      target_batch: targetSet.size ? {
        judgment_unit_ids: targetUnitIds,
        requirement_ids: (scopedRequirements || []).map((item) => item.id),
        new_id_namespace: input.idNamespace || "BATCH",
        reserved_source_keys: (input.baseData.sources || []).map((item: any) => item?.source_key).filter(Boolean),
        reserved_evidence_ids: (input.baseData.evidence_drafts || []).map((item: any) => item?.id).filter(Boolean),
        instruction: "本轮只处理这些判断单元；其他单元由其他批次负责，不得扩展。",
      } : null,
      current_evidence_draft: {
        method_applications: scopedBase.method_applications || [],
        sources: scopedBase.sources || [],
        evidence_drafts: scopedBase.evidence_drafts || [],
        unresolved_gaps: scopedBase.unresolved_gaps || [],
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
      requireEvidenceAcquisition: true,
      // 本批目标和本体节点已由 Stage02 固定；关闭 ontology 工具避免在取证环空转。
      ontologyTools: false,
      maxToolRounds: input.maxToolRounds || 8,
      runId: input.runId,
      // 提交时即把 upserts/removals ID 并入 affected，避免 schema 过关后 merge 再因漏声明失败。
      repairOutput: (data) => {
        const normalized = normalizeStage03Patch(data as Stage03Patch);
        return targetSet.size
          ? isolateStage03BatchPatch({
            baseData: input.baseData,
            patch: normalized,
            targetUnitIds,
            namespace: input.idNamespace || "BATCH",
          })
          : normalized;
      },
    },
  );
  input.assertRunning();

  const patch = enforceStage03AcquisitionHonesty({
    patch: normalizeStage03Patch(result.data),
    baseData: input.baseData,
    toolUsage: result.toolUsage,
    targetUnitIds,
  });
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
