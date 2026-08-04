import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeEvidencePreparationNulls } from "@/engine/evidence_draft_normalize";
import { evidencePreparationSchema } from "@/engine/schemas";

let workflow: typeof import("@/engine/workflow");

beforeAll(async () => {
  workflow = await import("@/engine/workflow");
});

describe("evidence_draft_normalize", () => {
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
});
