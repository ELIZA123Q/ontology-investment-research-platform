import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeEvidencePreparationNulls } from "@/engine/evidence_draft_normalize";
import { evidencePreparationSchema } from "@/engine/schemas";
import { syncStage03ReadableMarkdown } from "@/engine/readable_markdown";

let workflow: typeof import("@/engine/workflow");

beforeAll(async () => {
  workflow = await import("@/engine/workflow");
});

describe("evidence_draft_normalize", () => {
  it("repairs Stage03 evidence methods that the model prematurely marked executed", () => {
    const repaired = workflow.repairEvidencePreparationDraft({
      method_applications: [{
        application_id: "MA-EV-1",
        capability_type: "evidence",
        status: "executed",
        precondition_checks: [{ precondition_id: "P-1", result: "pass", evidence_refs: ["EV-1"] }],
        input_evidence_refs: ["EV-1"],
        output_signal_refs: ["SIG-ILLEGAL"],
        output_judgment_refs: [],
        execution_summary: "模型错误地提前执行",
        limitations: [],
        target_judgment_unit_refs: ["JU-1"],
        alternatives: [],
      }],
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft", judgment_unit_ids: ["JU-1"] }],
      sources: [],
      unresolved_gaps: [],
    });
    expect(repaired.method_applications[0]).toMatchObject({
      status: "selected",
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
    });
    expect(repaired.method_applications[0].limitations.join(" ")).toMatch(/Stage04/);
  });

  it("clears method IDs mistakenly placed in candidate adjudication evidence_refs", () => {
    const repaired = workflow.repairEvidencePreparationDraft({
      method_applications: [{
        application_id: "MA-AD-1",
        capability_type: "adjudication",
        status: "candidate",
        precondition_checks: [{
          precondition_id: "P-1",
          result: "pass",
          evidence_refs: ["MA-EV-1"],
          reason: "模型误把方法 ID 当证据 ID",
        }],
        input_evidence_refs: [],
        output_signal_refs: [],
        output_judgment_refs: [],
        execution_summary: "",
        limitations: [],
        target_judgment_unit_refs: ["JU-1"],
        alternatives: [],
      }],
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft", judgment_unit_ids: ["JU-1"] }],
      sources: [],
      unresolved_gaps: [],
    });
    expect(repaired.method_applications[0].precondition_checks[0]).toMatchObject({
      result: "not_checked",
      evidence_refs: [],
    });
  });

  it("replaces stale precondition evidence IDs with current method inputs", () => {
    const repaired = workflow.repairEvidencePreparationDraft({
      method_applications: [{
        application_id: "MA-EV-1",
        capability_type: "evidence",
        status: "degraded",
        precondition_checks: [{
          precondition_id: "P-1",
          result: "partial",
          evidence_refs: ["GAP-DELETED"],
          reason: "旧 gap 已被事实替换",
        }],
        input_evidence_refs: ["EV-1"],
        limitations: ["仍有边界"],
        target_judgment_unit_refs: ["JU-1"],
        alternatives: [{ method_id: "kb03:A02", decision: "retained", reason: "保守保留" }],
      }],
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft", judgment_unit_ids: ["JU-1"] }],
      sources: [],
      unresolved_gaps: [],
    });
    expect(repaired.method_applications[0].precondition_checks[0].evidence_refs).toEqual(["EV-1"]);
  });

  it("把 MA/source 结构性 null 兜成合法空值并可通过 stage_03 schema", () => {
    const repaired = workflow.repairEvidencePreparationDraft({
      method_applications: [{
        application_id: "MA-EV-1",
        method_id: "kb03:A02",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_question_refs: null,
        target_judgment_unit_refs: ["JU-1"],
        target_ontology_object_refs: null,
        status: "blocked",
        precondition_checks: null,
        input_evidence_refs: null,
        output_signal_refs: null,
        output_judgment_refs: null,
        execution_summary: null,
        applicability_boundary: null,
        limitations: null,
        counter_example_refs: null,
        provenance: null,
        alternatives: null,
      }],
      sources: [{
        source_id: null,
        source_key: "SRC-01",
        url: "https://example.com/a",
        title: "公告",
        publisher: null,
        published_at: "2026-01-01T00:00:00Z",
        source_tier: "S2",
        source_type: "disclosure",
        search_excerpt: null,
        locator: "p1",
        source_quote: "原文引用",
        captured_at: null,
        content_hash: null,
        final_url: null,
        retrieval_status: null,
        quote_verified: null,
      }],
      evidence_drafts: [{
        id: "GAP-JU-01",
        statement: "缺少可核验正文",
        kind: "gap",
        direction: "unknown",
        source_keys: null,
        source_ids: null,
        judgment_unit_ids: ["JU-1"],
        ontology_node_ids: null,
        requirement: "取得可定位披露",
        evidence_role: "support",
        minimum_independent_sources: 1,
        limitations: null,
      }],
      unresolved_gaps: null,
      document_markdown: "# 证据准备\n\n模型把结构性字段写成了 null；运行时应兜底为空数组/字符串并补齐 blocked 替代路线，而不是直接 Zod 崩溃。",
    });
    expect(repaired.method_applications[0].target_question_refs).toEqual([]);
    expect(repaired.method_applications[0].applicability_boundary).toBe("未声明适用边界");
    expect(repaired.method_applications[0].provenance).toMatchObject({ stage: "stage_03", actor: "model" });
    expect(repaired.sources[0].publisher).toBe("");
    expect(repaired.sources[0].search_excerpt).toBe("");
    expect(repaired.unresolved_gaps).toEqual([]);
    syncStage03ReadableMarkdown(repaired);
    expect(() => evidencePreparationSchema.parse(repaired)).not.toThrow();
  });

  it("normalizeEvidencePreparationNulls 不捏造 url/title 等实质字段", () => {
    const normalized: any = normalizeEvidencePreparationNulls({
      method_applications: [{ application_id: "MA-1", target_question_refs: null, provenance: null }],
      sources: [{ source_key: "SRC-01", url: null, title: null, publisher: null }],
      evidence_drafts: [],
      unresolved_gaps: null,
    });
    expect(normalized.method_applications[0].target_question_refs).toEqual([]);
    expect(normalized.sources[0].url).toBeNull();
    expect(normalized.sources[0].title).toBeNull();
    expect(normalized.sources[0].publisher).toBe("");
  });

  it("非法 authority_type 降为 unknown，残缺来源仍丢弃", async () => {
    const { normalizeSourceDraftNulls, dropIncompleteSources, reconcileMethodEvidenceRefs } = await import("@/engine/evidence_draft_normalize");
    const normalized: any = normalizeSourceDraftNulls({
      source_key: "SRC-01",
      authority_type: "媒体报道",
      source_tier: "s2",
    });
    expect(normalized.authority_type).toBe("unknown");
    expect(normalized.source_tier).toBe("S2");

    const dropped: any = dropIncompleteSources({
      sources: [
        {
          source_key: "SRC-OK", url: "https://a.com", title: "A", published_at: "2026-01-01T00:00:00Z",
          source_tier: "S2", source_type: "disclosure", locator: "p1", source_quote: "正文",
          publisher: "", search_excerpt: "", authority_type: "unknown",
          source_id: null, captured_at: null, content_hash: null, final_url: null, retrieval_status: null, quote_verified: null,
        },
        {
          source_key: "SRC-BAD", url: "https://b.com", title: "B", published_at: "2026-01-01T00:00:00Z",
          source_tier: "S2", source_type: "disclosure", locator: "", source_quote: "",
          publisher: "", search_excerpt: "", authority_type: "unknown",
          source_id: null, captured_at: null, content_hash: null, final_url: null, retrieval_status: null, quote_verified: null,
        },
      ],
      evidence_drafts: [{ id: "EV-1", source_keys: ["SRC-OK", "SRC-BAD"] }],
      unresolved_gaps: [],
    });
    expect(dropped.sources.map((item: any) => item.source_key)).toEqual(["SRC-OK"]);
    expect(dropped.evidence_drafts[0].source_keys).toEqual(["SRC-OK"]);
    expect(dropped.unresolved_gaps[0]).toMatch(/SRC-BAD/);

    const withBadAuthority = dropIncompleteSources({
      sources: [normalizeSourceDraftNulls({
        source_key: "SRC-OK", url: "https://a.com", title: "A", published_at: "2026-01-01T00:00:00Z",
        source_tier: "S2", source_type: "disclosure", locator: "p1", source_quote: "正文",
        publisher: "", search_excerpt: "", authority_type: "乱七八糟",
        source_id: null, captured_at: null, content_hash: null, final_url: null, retrieval_status: null, quote_verified: null,
      })],
      evidence_drafts: [],
      unresolved_gaps: [],
    });
    expect(withBadAuthority.sources[0].authority_type).toBe("unknown");

    const reconciled: any = reconcileMethodEvidenceRefs({
      method_applications: [{
        application_id: "MA-EV-1",
        capability_type: "evidence",
        method_id: "kb03:A02",
        status: "selected",
        target_judgment_unit_refs: ["JU-1"],
        target_ontology_object_refs: [],
        input_evidence_refs: ["EV-GAP-05"],
        alternatives: [],
      }],
      evidence_drafts: [{ id: "EV-GAP-01", kind: "gap" }],
      unresolved_gaps: [],
    });
    expect(reconciled.evidence_drafts.some((item: any) => item.id === "EV-GAP-05" && item.kind === "gap")).toBe(true);
    expect(reconciled.method_applications[0].input_evidence_refs).toContain("EV-GAP-05");
    expect(reconciled.method_applications[0].status).toBe("degraded");
  });

  it("把已绑定来源的事实降为 gap 时强制清空 source_keys，并纠正非法 kind", async () => {
    const { normalizeEvidenceDraftNulls } = await import("@/engine/evidence_draft_normalize");
    const asGap: any = normalizeEvidenceDraftNulls({
      id: "EV-1",
      statement: "无法核验的主张",
      kind: "gap",
      direction: "support",
      source_keys: ["SRC-06", "SRC-07"],
      source_ids: ["uuid-1"],
      judgment_unit_ids: ["JU-1"],
      ontology_node_ids: [],
      requirement: "取得可核验披露",
      evidence_role: "support",
      minimum_independent_sources: 1,
      limitations: [],
    });
    expect(asGap).toMatchObject({
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
    });
    expect(asGap.limitations.some((item: string) => item.includes("SRC-06"))).toBe(true);

    const coerced: any = normalizeEvidenceDraftNulls({
      id: "EV-2",
      statement: "缺证据",
      kind: "evidence_gap",
      source_keys: null,
      judgment_unit_ids: ["JU-1"],
      requirement: "补公开原文",
      evidence_role: "support",
      minimum_independent_sources: 1,
    });
    expect(coerced.kind).toBe("gap");
    expect(coerced.source_keys).toEqual([]);
  });

  it("纠正 precondition result 与 semiconductor metric_kind 非法枚举", async () => {
    const { normalizeMethodApplicationNulls, normalizeEvidenceDraftNulls } = await import("@/engine/evidence_draft_normalize");
    const method: any = normalizeMethodApplicationNulls({
      application_id: "MA-1",
      precondition_checks: [
        { precondition_id: "P1", result: "passed", evidence_refs: [], reason: "ok" },
        { precondition_id: "P2", result: "unchecked", evidence_refs: [], reason: "" },
        { precondition_id: "P3", result: "weird", evidence_refs: [], reason: "" },
      ],
      provenance: null,
    });
    expect(method.precondition_checks.map((item: any) => item.result)).toEqual([
      "pass",
      "not_checked",
      "not_checked",
    ]);
    expect(method.precondition_checks[1].reason).toBe("未提供前置条件说明");
    expect(method.status).toBe("candidate");

    const chinese: any = normalizeMethodApplicationNulls({
      application_id: "MA-2",
      precondition_checks: [
        { precondition_id: "", result: "通过", evidence_refs: null, reason: null },
        { precondition_id: "P2", result: "失败", evidence_refs: [], reason: "缺正文" },
      ],
    });
    expect(chinese.precondition_checks.map((item: any) => item.result)).toEqual(["pass", "fail"]);
    expect(chinese.precondition_checks[0].precondition_id).toBe("unspecified_precondition");
    expect(chinese.precondition_checks[0].reason).toBe("未提供前置条件说明");

    const yieldDraft: any = normalizeEvidenceDraftNulls({
      id: "EV-Y",
      statement: "某厂良率提升",
      kind: "fact_draft",
      source_keys: ["SRC-1"],
      judgment_unit_ids: ["JU-1"],
      semiconductor_measurement: { metric_kind: "wafer_yield", facility_ref: null },
    });
    expect(yieldDraft.semiconductor_measurement.metric_kind).toBe("yield");
    expect(yieldDraft.semiconductor_measurement).toMatchObject({
      facility_ref: null,
      wafer_size: null,
      process_or_product_ref: null,
      batch_stage: null,
      unit: null,
      business_time_basis: null,
    });

    const junk: any = normalizeEvidenceDraftNulls({
      id: "EV-X",
      statement: "无关叙述",
      kind: "fact_draft",
      source_keys: ["SRC-1"],
      judgment_unit_ids: ["JU-1"],
      semiconductor_measurement: { metric_kind: "throughput", facility_ref: null },
    });
    expect(junk.semiconductor_measurement).toBeNull();
  });

  it("抓取前仅允许绑定完整候选来源的事实，其余透明降为 gap", async () => {
    const { prepareEvidenceForSourceCapture } = await import("@/engine/evidence_draft_normalize");
    const prepared: any = prepareEvidenceForSourceCapture({
      sources: [{
        source_key: "SRC-OK",
        url: "https://example.com/a",
        title: "公告",
        published_at: "2026-07-01T00:00:00Z",
        source_tier: "S2",
        source_type: "disclosure",
        locator: "第1段",
        source_quote: "这是可以逐字核验的公开正文。",
      }],
      evidence_drafts: [
        {
          id: "EV-OK",
          statement: "公告披露库存下降",
          kind: "fact_draft",
          direction: "positive",
          source_keys: ["SRC-OK"],
          source_ids: [],
          judgment_unit_ids: ["JU-1"],
          ontology_node_ids: [],
          limitations: [],
          semiconductor_measurement: { metric_kind: "capacity" },
        },
        {
          id: "EV-NO-SOURCE",
          statement: "模型记忆中的价格上涨",
          kind: "source_claim",
          direction: "support",
          source_keys: ["SRC-MISSING"],
          source_ids: [],
          judgment_unit_ids: ["JU-1"],
          ontology_node_ids: [],
          limitations: [],
        },
      ],
      unresolved_gaps: [],
    });
    expect(prepared.evidence_drafts[0]).toMatchObject({
      kind: "fact_draft",
      direction: "support",
      subject_ref: "JU-1",
      scope_ref: "JU-1",
      published_at: "2026-07-01T00:00:00Z",
      observed_at: "2026-07-01T00:00:00Z",
      time_basis: "publication_date_proxy:2026-07-01T00:00:00Z",
      directness: "proxy",
    });
    expect(prepared.evidence_drafts[0].limitations.join(" ")).toMatch(/publication-date proxy/);
    expect(prepared.evidence_drafts[1]).toMatchObject({
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
    });
    expect(prepared.unresolved_gaps[0]).toMatch(/EV-NO-SOURCE/);
  });

  it("抓取后无可用 quote 的事实降为 gap", async () => {
    const { demoteUnverifiedEvidenceDrafts } = await import("@/engine/evidence_draft_normalize");
    const demoted: any = demoteUnverifiedEvidenceDrafts({
      sources: [
        { source_key: "SRC-OK", quote_verified: true, usability_status: "usable", retrieval_status: "captured" },
        { source_key: "SRC-BAD", quote_verified: false, usability_status: "limited", retrieval_status: "limited" },
      ],
      evidence_drafts: [
        { id: "EV-1", kind: "fact_draft", statement: "ok", source_keys: ["SRC-OK"], judgment_unit_ids: ["JU-1"] },
        { id: "EV-2", kind: "fact_draft", statement: "bad", source_keys: ["SRC-BAD"], judgment_unit_ids: ["JU-1"] },
      ],
      unresolved_gaps: [],
    });
    expect(demoted.evidence_drafts[0].kind).toBe("fact_draft");
    expect(demoted.evidence_drafts[1]).toMatchObject({
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
    });
    expect(demoted.unresolved_gaps[0]).toMatch(/EV-2/);
  });

  it("裁掉晚于截止日的来源；仅在无合格来源时才把事实降为 gap", async () => {
    const { demoteUnverifiedEvidenceDrafts } = await import("@/engine/evidence_draft_normalize");
    const repaired: any = demoteUnverifiedEvidenceDrafts({
      sources: [
        { source_key: "SRC-OLD", source_id: "old", retrieval_status: "captured", quote_verified: true, published_at: "2025-01-01" },
        { source_key: "SRC-LATE", source_id: "late", retrieval_status: "captured", quote_verified: true, published_at: "2026-01-01" },
      ],
      evidence_drafts: [
        { id: "EV-KEEP", kind: "fact_draft", source_keys: ["SRC-OLD", "SRC-LATE"], source_ids: ["old", "late"], limitations: [] },
        { id: "EV-DEMOTE", kind: "fact_draft", statement: "晚期资料", source_keys: ["SRC-LATE"], source_ids: ["late"], limitations: [] },
      ],
      unresolved_gaps: [],
    }, {
      cutoffMs: Date.parse("2025-06-30T23:59:59Z"),
      registrySources: [
        { id: "old", usability_status: "usable", retrieval_status: "captured", quote_verified: true, published_at: "2025-01-01" },
        { id: "late", usability_status: "usable", retrieval_status: "captured", quote_verified: true, published_at: "2026-01-01" },
      ],
    });
    expect(repaired.evidence_drafts[0]).toMatchObject({ source_keys: ["SRC-OLD"], source_ids: ["old"] });
    expect(repaired.evidence_drafts[1]).toMatchObject({ kind: "gap", source_keys: [], source_ids: [] });
  });

  it("裁掉 Registry 中虽标 verified 但引文含编码乱码的来源", async () => {
    const { demoteUnverifiedEvidenceDrafts } = await import("@/engine/evidence_draft_normalize");
    const repaired: any = demoteUnverifiedEvidenceDrafts({
      sources: [{ source_key: "SRC-BAD", source_id: "bad", source_quote: "��˾2024��Ӫҵ����" }],
      evidence_drafts: [{
        id: "EV-BAD",
        kind: "fact_draft",
        statement: "收入增长",
        source_keys: ["SRC-BAD"],
        source_ids: ["bad"],
        limitations: [],
      }],
      unresolved_gaps: [],
    }, {
      cutoffMs: Date.parse("2025-06-30T23:59:59Z"),
      registrySources: [{
        id: "bad",
        usability_status: "usable",
        retrieval_status: "captured",
        quote_verified: true,
        source_quote: "��˾2024��Ӫҵ����",
        published_at: "2025-01-01T00:00:00Z",
      }],
    });
    expect(repaired.evidence_drafts[0]).toMatchObject({ kind: "gap", source_keys: [], source_ids: [] });
    expect(repaired.evidence_drafts[0].limitations.join(" ")).toContain("乱码");
  });
});
