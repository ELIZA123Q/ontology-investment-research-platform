import { ONTOLOGY_ENUMS, ONTOLOGY_SOURCE_TIERS } from "./ontology_vocabulary.generated";
import { isReadableEvidenceText } from "./text_quality";

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
  "evidence_requirement_ids",
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

const SOURCE_TIERS = new Set<string>(ONTOLOGY_SOURCE_TIERS);
const METHOD_STATUSES = new Set(["candidate", "selected", "executed", "rejected", "blocked", "degraded"]);
const EVIDENCE_DIRECTIONS = new Set(["support", "weaken", "neutral", "unknown"]);
const EVIDENCE_DIRECTNESS = new Set<string>(ONTOLOGY_ENUMS["EvidenceAssessment.directness"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isCompleteSourceDraft(item: unknown): boolean {
  if (!isPlainObject(item)) return false;
  if (!SOURCE_TIERS.has(String(item.source_tier || ""))) return false;
  return SOURCE_REQUIRED_NONEMPTY.every((key) => nonEmpty(item[key]))
    && isReadableEvidenceText(item.source_quote);
}

export function normalizeMethodApplicationNulls(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next: Record<string, unknown> = { ...item };
  for (const key of METHOD_ARRAY_KEYS) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  if (Array.isArray(next.precondition_checks)) {
    next.precondition_checks = next.precondition_checks.map((check) => {
      if (!isPlainObject(check)) return check;
      const evidence_refs = Array.isArray(check.evidence_refs) ? check.evidence_refs : [];
      const reason = nonEmpty(check.reason) ? String(check.reason) : "未提供前置条件说明";
      return {
        ...check,
        result: coercePreconditionResult(check.result),
        evidence_refs,
        reason,
        precondition_id: nonEmpty(check.precondition_id) ? String(check.precondition_id) : "unspecified_precondition",
      };
    });
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
  if (!METHOD_STATUSES.has(String(next.status || ""))) {
    const hasEvidence = Array.isArray(next.input_evidence_refs) && next.input_evidence_refs.length > 0;
    next.status = next.capability_type === "evidence"
      ? hasEvidence ? "degraded" : "blocked"
      : "candidate";
    const limitations = Array.isArray(next.limitations) ? next.limitations.map(String).filter(Boolean) : [];
    limitations.push("模型返回了未登记的方法执行状态；Runtime 已按证据可用性保守降级");
    next.limitations = [...new Set(limitations)];
  }
  return next;
}

const PRECONDITION_RESULTS = new Set(["pass", "fail", "partial", "not_checked"]);
const PRECONDITION_RESULT_ALIASES: Record<string, string> = {
  passed: "pass",
  success: "pass",
  ok: "pass",
  true: "pass",
  yes: "pass",
  通过: "pass",
  通过检查: "pass",
  满足: "pass",
  failed: "fail",
  failure: "fail",
  false: "fail",
  no: "fail",
  失败: "fail",
  不通过: "fail",
  未通过: "fail",
  partially: "partial",
  partialpass: "partial",
  部分: "partial",
  部分通过: "partial",
  unchecked: "not_checked",
  unknown: "not_checked",
  pending: "not_checked",
  skip: "not_checked",
  skipped: "not_checked",
  na: "not_checked",
  n_a: "not_checked",
  未检查: "not_checked",
  待检查: "not_checked",
  未知: "not_checked",
};

function coercePreconditionResult(raw: unknown): string {
  if (raw == null || raw === "") return "not_checked";
  const text = String(raw).trim();
  if (PRECONDITION_RESULTS.has(text)) return text;
  if (PRECONDITION_RESULT_ALIASES[text]) return PRECONDITION_RESULT_ALIASES[text];
  const lower = text.toLowerCase().replace(/[\s-]+/g, "_");
  return PRECONDITION_RESULT_ALIASES[lower] || "not_checked";
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

const EVIDENCE_KINDS = new Set(["source_claim", "fact_draft", "counter", "conflict", "gap"]);
const EVIDENCE_KIND_ALIASES: Record<string, string> = {
  claim: "source_claim",
  sourceclaim: "source_claim",
  fact: "fact_draft",
  factdraft: "fact_draft",
  evidence_gap: "gap",
  evidencegap: "gap",
  missing: "gap",
  unknown: "gap",
};

function coerceEvidenceKind(raw: unknown, draft: Record<string, unknown>): string {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase().replace(/[\s-]+/g, "");
  if (EVIDENCE_KINDS.has(text)) return text;
  if (EVIDENCE_KIND_ALIASES[lower]) return EVIDENCE_KIND_ALIASES[lower];
  const looksLikeGap = nonEmpty(draft.requirement)
    || nonEmpty(draft.evidence_role)
    || draft.minimum_independent_sources != null;
  if (looksLikeGap) return "gap";
  const keys = Array.isArray(draft.source_keys) ? draft.source_keys : [];
  if (keys.length > 0) return "fact_draft";
  return "gap";
}

export function normalizeEvidenceDraftNulls(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next: Record<string, unknown> = { ...item };
  for (const key of EVIDENCE_ARRAY_KEYS) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  next.kind = coerceEvidenceKind(next.kind, next);

  if (next.kind === "gap") {
    // gap 不得挂来源：补证常把 fact 改成 gap 却 omit/null source_keys，字段级合并会留下旧绑定。
    const priorKeys = Array.isArray(next.source_keys) ? next.source_keys.map(String).filter(Boolean) : [];
    next.source_keys = [];
    next.source_ids = [];
    next.direction = "unknown";
    if (!nonEmpty(next.requirement)) {
      next.requirement = nonEmpty(next.statement)
        ? `取得可核验正文以支撑：${String(next.statement).slice(0, 120)}`
        : "取得可定位、可核验的公开正文";
    }
    if (!["support", "counter", "context", "boundary"].includes(String(next.evidence_role || ""))) {
      next.evidence_role = "support";
    }
    if (typeof next.minimum_independent_sources !== "number" || !Number.isFinite(next.minimum_independent_sources)) {
      next.minimum_independent_sources = 1;
    }
    const limitations = Array.isArray(next.limitations) ? next.limitations.map(String).filter(Boolean) : [];
    if (priorKeys.length) {
      limitations.push(`原绑定来源 ${priorKeys.join(", ")} 在降为 gap 时已清空，不得当作已核验事实`);
    }
    if (!limitations.length) {
      limitations.push("尚未取得可定位、可核验的公开正文");
    }
    next.limitations = [...new Set(limitations)];
    next.semiconductor_measurement = null;
  } else {
    next.direction = coerceEvidenceDirection(next.direction);
    if (!EVIDENCE_DIRECTNESS.has(String(next.directness || ""))) {
      next.directness = "proxy";
      const limitations = Array.isArray(next.limitations) ? next.limitations.map(String).filter(Boolean) : [];
      limitations.push("模型未提供有效 directness；Runtime 保守标记为 proxy");
      next.limitations = [...new Set(limitations)];
    }
    if (next.valid_to === undefined) next.valid_to = null;
    next.semiconductor_measurement = normalizeSemiconductorMeasurement(
      next.semiconductor_measurement,
      String(next.statement || ""),
    );
  }
  return next;
}

function coerceEvidenceDirection(raw: unknown): string {
  const text = String(raw || "").trim().toLowerCase();
  if (EVIDENCE_DIRECTIONS.has(text)) return text;
  if (/support|confirm|positive|up|支持|证实|正向/.test(text)) return "support";
  if (/weaken|contradict|negative|down|反证|削弱|负向/.test(text)) return "weaken";
  if (/neutral|context|中性|背景/.test(text)) return "neutral";
  return "unknown";
}

function coerceMetricKind(raw: unknown, hintText: string): "capacity" | "yield" | null {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  if (lower === "capacity" || lower === "yield") return lower;
  if (/良率|yield|die[_\s-]?yield|wafer[_\s-]?yield/i.test(text) || /良率|yield/i.test(hintText)) return "yield";
  if (/产能|capacity|nameplate|effective[_\s-]?output|有效产出/i.test(text) || /产能|capacity|有效产出/i.test(hintText)) {
    return "capacity";
  }
  return null;
}

/** 非法 metric_kind 先尝试语义归并；仍无法归并则整段置 null（该字段可选）。 */
function normalizeSemiconductorMeasurement(value: unknown, hintText: string): unknown {
  if (value == null) return null;
  if (!isPlainObject(value)) return null;
  const kind = coerceMetricKind(value.metric_kind, hintText);
  if (!kind) return null;
  return {
    ...value,
    metric_kind: kind,
    facility_ref: value.facility_ref == null ? null : String(value.facility_ref),
    wafer_size: value.wafer_size == null ? null : String(value.wafer_size),
    process_or_product_ref: value.process_or_product_ref == null ? null : String(value.process_or_product_ref),
    batch_stage: value.batch_stage == null ? null : String(value.batch_stage),
    unit: value.unit == null ? null : String(value.unit),
    business_time_basis: value.business_time_basis == null ? null : String(value.business_time_basis),
  };
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
 * 补齐 evidencePreparationSchema 的顶层必填字段（重构后扩张的契约）。
 * 仅填缺失项，不覆盖已存在的合法值；与 preparation_markdown/document_markdown
 * 镜像约束保持一致（缺少 preparation_markdown 时以 document_markdown 镜像）。
 * 取值为保守默认（blocked/return 草稿 → 低确定度、gap_report、return_required），
 * 真实值由 Stage04 重写。
 */
export function fillEvidencePreparationDefaults(data: unknown): unknown {
  if (!isPlainObject(data)) return data;
  const next: Record<string, unknown> = { ...data };
  const doc = typeof next.document_markdown === "string" ? next.document_markdown : "";
  if (typeof next.preparation_markdown !== "string") next.preparation_markdown = doc;
  if (!Array.isArray(next.unresolved_gaps)) next.unresolved_gaps = [];
  if (typeof next.instance_manifest_yaml !== "string" || String(next.instance_manifest_yaml).length < 20) {
    next.instance_manifest_yaml = [
      "instance_manifest:",
      "  repaired_by: repairEvidencePreparationDraft",
      "  note: 结构性 null 已兜底，待 Stage04 补齐确定性元数据",
    ].join("\n");
  }
  if (typeof next.stage_status !== "string") next.stage_status = "in_progress";
  if (typeof next.quality_status !== "string") next.quality_status = "return_required";
  if (typeof next.quality_gate_ref !== "string" || !String(next.quality_gate_ref).trim()) {
    next.quality_gate_ref = "stage03_quality_gate_repaired";
  }
  if (!["not_checked", "checked", "failed"].includes(String(next.deterministic_check_status))) {
    next.deterministic_check_status = "not_checked";
  }
  if (!["not_reviewed", "reviewed", "rejected"].includes(String(next.semantic_review_status))) {
    next.semantic_review_status = "not_reviewed";
  }
  if (!["low", "medium", "high"].includes(String(next.confidence_ceiling))) next.confidence_ceiling = "low";
  if (typeof next.coverage_unit_total !== "number") next.coverage_unit_total = 0;
  if (typeof next.evidence_backed_unit_count !== "number") next.evidence_backed_unit_count = 0;
  if (typeof next.evidence_coverage_rate !== "number") next.evidence_coverage_rate = 0;
  if (typeof next.required_coverage_rate !== "number") next.required_coverage_rate = 0.7;
  if (!["met", "partial", "not_met"].includes(String(next.critical_node_gate_status))) {
    next.critical_node_gate_status = "not_met";
  }
  if (!["met", "partial", "insufficient"].includes(String(next.judgment_unit_gate_status))) {
    next.judgment_unit_gate_status = "insufficient";
  }
  if (!["not_started", "in_progress", "threshold_met", "source_scarce"].includes(String(next.search_status))) {
    next.search_status = "not_started";
  }
  if (!["full_report", "bounded_report", "gap_report_only"].includes(String(next.allowed_05_output))) {
    next.allowed_05_output = "gap_report_only";
  }
  if (!["ready", "partial", "not_ready"].includes(String(next.evidence_readiness))) {
    next.evidence_readiness = "not_ready";
  }
  if (!["ready", "partial", "not_ready"].includes(String(next.delivery_readiness))) {
    next.delivery_readiness = "not_ready";
  }
  if (typeof next.snapshot_ref !== "string" || !String(next.snapshot_ref).trim()) {
    next.snapshot_ref = "snapshot:repaired:none";
  }
  if (typeof next.return_required !== "boolean") next.return_required = true;
  if (next.return_stage === undefined) next.return_stage = "stage_03";
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
 * 抓取前真实性闸门：
 * - 非 gap 必须至少绑定一个仍存在的完整候选来源；
 * - 对有完整来源但缺少纯契约型时态/范围元数据的草稿，使用来源发布日期作为透明 proxy，
 *   并写入 limitation；不把 proxy 当成事件发生时间；
 * - 没有完整来源时直接降为 gap，绝不让模型内生知识进入事实层。
 */
export function prepareEvidenceForSourceCapture(data: any): any {
  if (!data || typeof data !== "object" || !Array.isArray(data.evidence_drafts) || !Array.isArray(data.sources)) {
    return data;
  }
  const sourceByKey = new Map<string, any>(
    data.sources
      .filter(isCompleteSourceDraft)
      .map((source: any) => [String(source.source_key), source]),
  );
  const demotedIds: string[] = [];
  const evidence_drafts = data.evidence_drafts.map((draft: any) => {
    if (!draft || typeof draft !== "object" || draft.kind === "gap") return draft;
    const priorKeys = Array.isArray(draft.source_keys) ? draft.source_keys.map(String).filter(Boolean) : [];
    const sourceKeys = priorKeys.filter((key: string) => sourceByKey.has(key));
    if (!sourceKeys.length) {
      demotedIds.push(String(draft.id || ""));
      return normalizeEvidenceDraftNulls({
        ...draft,
        kind: "gap",
        direction: "unknown",
        source_keys: [],
        source_ids: [],
        requirement: nonEmpty(draft.requirement)
          ? draft.requirement
          : nonEmpty(draft.statement)
            ? `取得可定位、可逐字核验的公开正文以支撑：${String(draft.statement).slice(0, 120)}`
            : `为 ${String(draft.id || "该证据候选")} 补充明确主张与可核验公开正文`,
        evidence_role: ["support", "counter", "context", "boundary"].includes(String(draft.evidence_role || ""))
          ? draft.evidence_role
          : coerceEvidenceDirection(draft.direction) === "weaken" ? "counter" : "support",
        limitations: [
          ...(Array.isArray(draft.limitations) ? draft.limitations.map(String).filter(Boolean) : []),
          priorKeys.length
            ? `绑定来源 ${priorKeys.join(", ")} 不存在或不满足候选来源完整性合同，抓取前已降为 gap`
            : "未绑定完整候选来源，抓取前已降为 gap；模型内生知识不得作为事实",
        ],
      });
    }

    const firstSource = sourceByKey.get(sourceKeys[0]);
    const publishedAt = nonEmpty(draft.published_at)
      ? String(draft.published_at)
      : String(firstSource?.published_at || "");
    const observedAt = nonEmpty(draft.observed_at) ? String(draft.observed_at) : publishedAt;
    const limitations = Array.isArray(draft.limitations) ? draft.limitations.map(String).filter(Boolean) : [];
    const proxyFields: string[] = [];
    if (!nonEmpty(draft.published_at)) proxyFields.push("published_at");
    if (!nonEmpty(draft.observed_at)) proxyFields.push("observed_at");
    if (!nonEmpty(draft.valid_from)) proxyFields.push("valid_from");
    if (!nonEmpty(draft.cutoff_at)) proxyFields.push("cutoff_at");
    if (!nonEmpty(draft.time_basis)) proxyFields.push("time_basis");
    if (proxyFields.length) {
      limitations.push(
        `缺少 ${proxyFields.join("/")}；Runtime 暂以来源发布日期作 publication-date proxy，不能替代事件发生时间`,
      );
    }
    return normalizeEvidenceDraftNulls({
      ...draft,
      source_keys: sourceKeys,
      ontology_node_ids: Array.isArray(draft.ontology_node_ids) ? draft.ontology_node_ids : [],
      subject_ref: nonEmpty(draft.subject_ref)
        ? draft.subject_ref
        : String((draft.ontology_node_ids || [])[0] || (draft.judgment_unit_ids || [])[0] || ""),
      scope_ref: nonEmpty(draft.scope_ref)
        ? draft.scope_ref
        : String((draft.judgment_unit_ids || [])[0] || ""),
      published_at: publishedAt,
      observed_at: observedAt,
      valid_from: nonEmpty(draft.valid_from) ? draft.valid_from : observedAt,
      valid_to: draft.valid_to == null ? null : String(draft.valid_to),
      cutoff_at: nonEmpty(draft.cutoff_at) ? draft.cutoff_at : publishedAt,
      time_basis: nonEmpty(draft.time_basis) ? draft.time_basis : `publication_date_proxy:${publishedAt}`,
      limitations: [...new Set(limitations)],
    });
  });
  if (!demotedIds.length) return { ...data, evidence_drafts };
  const unresolved_gaps = [
    ...new Set([
      ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
      ...demotedIds.filter(Boolean).map((id) => `${id}: 抓取前无完整候选来源，已降为显式缺口`),
    ]),
  ];
  return { ...data, evidence_drafts, unresolved_gaps };
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

/**
 * 抓取后：非 gap 事实若绑定来源全部未 quote_verified / 不可用，则降为 gap。
 * 避免未核验“事实”泄漏进 Stage04；失败源仍可通过 failed_sources 补修。
 */
export function demoteUnverifiedEvidenceDrafts(
  data: any,
  options: { cutoffMs?: number; registrySources?: Array<Record<string, any>> } = {},
): any {
  if (!data || typeof data !== "object" || !Array.isArray(data.evidence_drafts) || !Array.isArray(data.sources)) {
    return data;
  }
  const registryById = new Map(
    (options.registrySources || []).map((source: any) => [String(source.id || ""), source]),
  );
  const sourceByKey = new Map<string, any>(
    data.sources
      .filter((source: any) => source?.source_key)
      .map((source: any) => [String(source.source_key), source]),
  );
  const usableKeys = new Set<string>();
  for (const [key, draftSource] of sourceByKey) {
    const registry = registryById.get(String(draftSource.source_id || ""));
    const source = registry || draftSource;
    const statusOk = registry
      ? source.usability_status === "usable"
        && source.retrieval_status === "captured"
        && Boolean(source.quote_verified)
      : Boolean(source.quote_verified) && source.retrieval_status === "captured";
    // Legacy/test registry projections may omit source_quote entirely; when the
    // field is present, however, unreadable bytes are never eligible evidence.
    const quoteReadable = source.source_quote === undefined
      || isReadableEvidenceText(source.source_quote);
    const publishedMs = Date.parse(String(source.published_at || ""));
    const timeOk = !Number.isFinite(options.cutoffMs)
      || (Number.isFinite(publishedMs) && publishedMs <= options.cutoffMs!);
    if (statusOk && timeOk && quoteReadable) usableKeys.add(key);
  }
  let changed = false;
  const demotedIds: string[] = [];
  const evidence_drafts = data.evidence_drafts.map((draft: any) => {
    if (!draft || typeof draft !== "object" || draft.kind === "gap") return draft;
    const keys = Array.isArray(draft.source_keys) ? draft.source_keys.map(String).filter(Boolean) : [];
    const eligibleKeys = keys.filter((key: string) => usableKeys.has(key));
    if (eligibleKeys.length) {
      if (eligibleKeys.length === keys.length) return draft;
      changed = true;
      const removed = keys.filter((key: string) => !usableKeys.has(key));
      const source_ids = eligibleKeys
        .map((key: string) => sourceByKey.get(key)?.source_id)
        .filter(Boolean)
        .map(String);
      return {
        ...draft,
        source_keys: eligibleKeys,
        source_ids,
        limitations: [
          ...new Set([
            ...(Array.isArray(draft.limitations) ? draft.limitations.map(String) : []),
            `已移除不可核验、含乱码或晚于研究截止日的来源绑定：${removed.join(", ")}`,
          ]),
        ],
      };
    }
    changed = true;
    demotedIds.push(String(draft.id || ""));
    const priorKeys = keys;
    const limitations = Array.isArray(draft.limitations) ? draft.limitations.map(String).filter(Boolean) : [];
    if (priorKeys.length) {
      limitations.push(`绑定来源 ${priorKeys.join(", ")} 不可核验、含乱码或晚于研究截止日，已降为 gap`);
    } else {
      limitations.push("未绑定任何可核验来源，已降为 gap");
    }
    return {
      ...draft,
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
      requirement: nonEmpty(draft.requirement)
        ? draft.requirement
        : nonEmpty(draft.statement)
          ? `取得可核验正文以支撑：${String(draft.statement).slice(0, 120)}`
          : "取得可定位、可核验的公开正文",
      evidence_role: ["support", "counter", "context", "boundary"].includes(String(draft.evidence_role || ""))
        ? draft.evidence_role
        : "support",
      minimum_independent_sources: typeof draft.minimum_independent_sources === "number"
        && Number.isFinite(draft.minimum_independent_sources)
        ? draft.minimum_independent_sources
        : 1,
      limitations: [...new Set(limitations.length ? limitations : ["尚未取得可定位、可核验的公开正文"])],
      semiconductor_measurement: null,
    };
  });
  if (!changed) return data;
  const unresolved = [
    ...new Set([
      ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
      ...demotedIds.filter(Boolean).map((id) => `${id}: 抓取后无可用 quote_verified 来源，已降为显式缺口`),
    ]),
  ];
  return { ...data, evidence_drafts, unresolved_gaps: unresolved };
}
