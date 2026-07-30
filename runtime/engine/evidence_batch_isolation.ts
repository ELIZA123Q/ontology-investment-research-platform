import { normalizeUrl } from "../adapters/db";
import {
  expandAffectedObjectRefs,
  normalizeStage03Patch,
  type Stage03Patch,
} from "./change_set";
import { normalizeEvidenceDraftNulls } from "./evidence_draft_normalize";
import { stage03ModelAcquisitionCallCount } from "./evidence_acquisition_planning";

/**
 * 模型没有调用任何取证工具时，patch 只能表达“仍有缺口”，不能创造来源或事实。
 * 已有非 gap 事实的修改会被丢弃以避免误伤已核验证据；新事实/旧 gap 则显式退化为 gap。
 */
export function enforceStage03AcquisitionHonesty(input: {
  patch: Stage03Patch;
  baseData: any;
  toolUsage: unknown;
  targetUnitIds?: string[];
  runtimeAcquiredSourceUrls?: string[];
}): Stage03Patch {
  const normalized = normalizeStage03Patch(structuredClone(input.patch));
  if (stage03ModelAcquisitionCallCount(input.toolUsage) > 0) return normalized;
  const runtimeUrls = new Set((input.runtimeAcquiredSourceUrls || []).flatMap((url) => {
    try { return [normalizeUrl(String(url))]; } catch { return []; }
  }));
  if (runtimeUrls.size) {
    const allowedBaseKeys = new Set(
      (Array.isArray(input.baseData?.sources) ? input.baseData.sources : [])
        .map((source: any) => String(source?.source_key || ""))
        .filter(Boolean),
    );
    const allowedRuntimeSources = (normalized.upserts.sources || []).filter((source: any) => {
      try { return runtimeUrls.has(normalizeUrl(String(source?.url || ""))); } catch { return false; }
    });
    const allowedKeys = new Set([
      ...allowedBaseKeys,
      ...allowedRuntimeSources.map((source: any) => String(source?.source_key || "")).filter(Boolean),
    ]);
    const removedKeys = (normalized.upserts.sources || [])
      .map((source: any) => String(source?.source_key || ""))
      .filter((key: string) => key && !allowedKeys.has(key));
    const runtimeGaps: string[] = removedKeys.map((key: string) =>
      `${key}: 模型未调用额外取证工具，该来源不在 Runtime 确定性预取集合中，已拒绝登记`,
    );
    normalized.upserts.sources = allowedRuntimeSources;
    normalized.upserts.evidence_drafts = (normalized.upserts.evidence_drafts || []).map((item: any) => {
      if (item?.kind === "gap") return item;
      const sourceKeys = (Array.isArray(item?.source_keys) ? item.source_keys : [])
        .map(String)
        .filter((key: string) => allowedKeys.has(key));
      if (sourceKeys.length) return { ...item, source_keys: sourceKeys };
      runtimeGaps.push(`${String(item?.id || "EvidenceDraft")}: 未绑定 Runtime 预取或既有来源，已降级为 gap`);
      return normalizeEvidenceDraftNulls({
        ...item,
        kind: "gap",
        direction: "unknown",
        source_keys: [],
        source_ids: [],
        limitations: [
          ...(Array.isArray(item?.limitations) ? item.limitations.map(String) : []),
          "模型未调用额外取证工具，且未绑定 Runtime 确定性预取来源",
        ],
      });
    });
    normalized.upserts.unresolved_gaps = [
      ...new Set([...(normalized.upserts.unresolved_gaps || []).map(String), ...runtimeGaps]),
    ];
    normalized.revision_summary = [
      String(normalized.revision_summary || "").trim(),
      "Runtime acquisition honesty gate：本批只允许既有来源与确定性预取候选；模型未调用工具时不得扩展来源边界。",
    ].filter(Boolean).join(" ");
    normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
    return normalized;
  }

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

