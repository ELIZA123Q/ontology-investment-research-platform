/**
 * 模型常把“未改 / 不确定”写成 null 或 ""。Stage03 契约里大量字段是必填数组/非空字符串，
 * null/空串不能进 Zod。这里只做无害兜底：空数组、空串、最小 provenance、丢掉残缺来源、
 * 剪掉悬空证据引用；不捏造 url/title/source_quote 等实质内容。
 */

const METHOD_ARRAY_KEYS = [
  "target_question_refs",
  "target_judgment_unit_refs",
  "target_ontology_object_refs",
  "precondition_checks",
  "input_evidence_refs",
  "output_signal_refs",
  "output_judgment_refs",
  "limitations",
  "counter_example_refs",
  "alternatives",
] as const;

const EVIDENCE_ARRAY_KEYS = [
  "source_keys",
  "source_ids",
  "judgment_unit_ids",
  "ontology_node_ids",
  "limitations",
] as const;

const SOURCE_REQUIRED_NONEMPTY = [
  "source_key",
  "url",
  "title",
  "published_at",
  "source_tier",
  "source_type",
  "locator",
  "source_quote",
] as const;

const AUTHORITY_TYPES = new Set([
  "official",
  "company_disclosure",
  "industry_provider",
  "public_secondary",
  "unknown",
]);

const SOURCE_TIERS = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isCompleteSourceDraft(item: unknown): boolean {
  if (!isPlainObject(item)) return false;
  if (!SOURCE_TIERS.has(String(item.source_tier || ""))) return false;
  return SOURCE_REQUIRED_NONEMPTY.every((key) => nonEmpty(item[key]));
}

export function normalizeMethodApplicationNulls(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next: Record<string, unknown> = { ...item };
  for (const key of METHOD_ARRAY_KEYS) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  if (typeof next.execution_summary !== "string") next.execution_summary = "";
  if (typeof next.applicability_boundary !== "string" || !next.applicability_boundary.trim()) {
    next.applicability_boundary = "未声明适用边界";
  }
  if (!isPlainObject(next.provenance)) {
    next.provenance = {
      stage: "stage_03",
      source_application_id: typeof next.application_id === "string" ? next.application_id : null,
      actor: "model",
      recorded_at: null,
    };
  } else {
    const provenance = { ...next.provenance };
    if (provenance.source_application_id === undefined) provenance.source_application_id = null;
    if (provenance.recorded_at === undefined) provenance.recorded_at = null;
    if (typeof provenance.actor !== "string" || !provenance.actor.trim()) provenance.actor = "model";
    if (provenance.stage !== "stage_02" && provenance.stage !== "stage_03" && provenance.stage !== "stage_04") {
      provenance.stage = "stage_03";
    }
    next.provenance = provenance;
  }
  return next;
}

export function normalizeSourceDraftNulls(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next: Record<string, unknown> = { ...item };
  // publisher / search_excerpt 允许空串；其余实质字段留给 merge 基座或完整性过滤。
  if (next.publisher == null) next.publisher = "";
  if (next.search_excerpt == null) next.search_excerpt = "";
  // 模型常填中文标签或自造枚举；非法值一律降为 unknown，避免 Zod invalid_value。
  if (!AUTHORITY_TYPES.has(String(next.authority_type || ""))) {
    next.authority_type = "unknown";
  }
  // 非法 tier 先留着，由 isCompleteSourceDraft / dropIncompleteSources 丢弃，避免 silently 编造 S8。
  if (typeof next.source_tier === "string") next.source_tier = next.source_tier.trim().toUpperCase();
  for (const key of ["source_id", "captured_at", "content_hash", "final_url", "retrieval_status", "quote_verified"] as const) {
    if (next[key] === undefined) next[key] = null;
  }
  return next;
}

export function normalizeEvidenceDraftNulls(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next: Record<string, unknown> = { ...item };
  for (const key of EVIDENCE_ARRAY_KEYS) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  if (next.kind === "gap" && Array.isArray(next.limitations) && next.limitations.length === 0) {
    next.limitations = ["尚未取得可定位、可核验的公开正文"];
  }
  return next;
}

export function normalizeEvidencePreparationNulls(data: unknown): unknown {
  if (!isPlainObject(data)) return data;
  const next: Record<string, unknown> = { ...data };
  if (Array.isArray(next.method_applications)) {
    next.method_applications = next.method_applications.map(normalizeMethodApplicationNulls);
  }
  if (Array.isArray(next.sources)) {
    next.sources = next.sources.map(normalizeSourceDraftNulls);
  }
  if (Array.isArray(next.evidence_drafts)) {
    next.evidence_drafts = next.evidence_drafts.map(normalizeEvidenceDraftNulls);
  }
  if (next.unresolved_gaps == null) next.unresolved_gaps = [];
  if (!Array.isArray(next.unresolved_gaps)) next.unresolved_gaps = [];
  return next;
}

/**
 * 丢掉 locator/source_quote 等必填仍为空的来源（不捏造正文），并登记缺口说明。
 * 同时剪掉证据草稿对已丢弃 source_key 的引用。
 */
export function dropIncompleteSources(data: any): any {
  if (!data || typeof data !== "object" || !Array.isArray(data.sources)) return data;
  const kept: any[] = [];
  const droppedKeys: string[] = [];
  for (const source of data.sources) {
    if (isCompleteSourceDraft(source)) {
      kept.push(source);
      continue;
    }
    const key = source?.source_key ? String(source.source_key) : "";
    if (key) droppedKeys.push(key);
  }
  if (!droppedKeys.length && kept.length === data.sources.length) return data;

  const dropped = new Set(droppedKeys);
  const evidence_drafts = Array.isArray(data.evidence_drafts)
    ? data.evidence_drafts.map((draft: any) => {
      if (!draft || typeof draft !== "object") return draft;
      const source_keys = Array.isArray(draft.source_keys)
        ? draft.source_keys.map(String).filter((key: string) => !dropped.has(key))
        : [];
      return { ...draft, source_keys };
    })
    : data.evidence_drafts;

  const unresolved = [
    ...new Set([
      ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
      ...droppedKeys.map((key) => `${key}: 补证来源缺少可核验 locator/source_quote 或其它必填字段，已丢弃，不得进入证据表`),
    ]),
  ];

  return { ...data, sources: kept, evidence_drafts, unresolved_gaps: unresolved };
}

/**
 * 剪掉指向不存在证据/缺口的 MA 引用；对仍需要输入的取证 MA，必要时补一条显式 gap。
 */
export function reconcileMethodEvidenceRefs(data: any): any {
  if (!data || typeof data !== "object") return data;
  if (!Array.isArray(data.method_applications) || !Array.isArray(data.evidence_drafts)) return data;

  const drafts = [...data.evidence_drafts];
  const evidenceIds = new Set(drafts.map((item: any) => String(item?.id || "")).filter(Boolean));
  const synthesizedGaps: any[] = [];

  const applications = data.method_applications.map((application: any) => {
    const refs = Array.isArray(application?.input_evidence_refs)
      ? application.input_evidence_refs.map(String)
      : [];
    const missing = refs.filter((ref: string) => ref && !evidenceIds.has(ref));
    let input_evidence_refs = refs.filter((ref: string) => evidenceIds.has(ref));

    if (missing.length && application?.capability_type === "evidence") {
      for (const ref of missing) {
        if (evidenceIds.has(ref)) continue;
        const targets = Array.isArray(application.target_judgment_unit_refs)
          ? application.target_judgment_unit_refs.map(String).filter(Boolean)
          : [];
        const gap = {
          id: ref,
          statement: `补证过程引用了不存在的证据 ${ref}；已降级为显式缺口`,
          kind: "gap",
          direction: "unknown",
          source_keys: [],
          source_ids: [],
          judgment_unit_ids: targets.length ? targets : ["JU-UNKNOWN"],
          ontology_node_ids: Array.isArray(application.target_ontology_object_refs)
            ? application.target_ontology_object_refs.map(String)
            : [],
          requirement: `取得可核验正文以替换悬空引用 ${ref}`,
          evidence_role: "support",
          minimum_independent_sources: 1,
          limitations: ["模型引用了不存在的证据 ID；Runtime 已登记为 gap，不得当作事实"],
        };
        synthesizedGaps.push(gap);
        evidenceIds.add(ref);
        input_evidence_refs = [...new Set([...input_evidence_refs, ref])];
      }
    }

    let status = application.status;
    let alternatives = Array.isArray(application.alternatives) ? [...application.alternatives] : [];
    if (
      application.capability_type === "evidence"
      && ["selected", "candidate"].includes(String(status || ""))
      && missing.length
    ) {
      status = "degraded";
      if (!alternatives.length) {
        alternatives = [{
          method_id: String(application.method_id || "unknown"),
          decision: "retry_after_source_acquisition",
          reason: "悬空证据引用已降级为 gap，取得正文后重试",
        }];
      }
    }

    return { ...application, input_evidence_refs, status, alternatives };
  });

  const unresolved = [
    ...new Set([
      ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
      ...synthesizedGaps.map((gap) => `${gap.id}: ${gap.requirement}`),
    ]),
  ];

  return {
    ...data,
    method_applications: applications,
    evidence_drafts: [...drafts, ...synthesizedGaps],
    unresolved_gaps: unresolved,
  };
}
