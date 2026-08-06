import { describe, expect, it } from "vitest";
import { mergeChangeSet, mergeStage03Patch, mergeUpsertObject } from "@/skills/replan/change_set";

const contract = {
  base_artifact_id: "artifact-1",
  base_artifact_hash: "a".repeat(64),
  target_attempt: 1,
  expected_graph_version: 0,
  affected_stage_refs: ["stage_03"] as Array<"stage_03" | "stage_04" | "stage_05">,
};

describe("incremental ChangeSet", () => {
  it("只修改声明受影响的对象并保留其他对象", () => {
    const base = { evidence_drafts: [{ id: "EV-1", statement: "old" }, { id: "EV-2", statement: "keep" }], sources: [] };
    const next = mergeChangeSet(base, {
      ...contract,
      target_stage: "stage_03",
      trigger_event_id: "event-1",
      affected_object_refs: ["EV-1"],
      rationale: "new evidence",
      upserts: { evidence_drafts: [{ id: "EV-1", statement: "new" }] },
      removals: {},
    }) as any;
    expect(next.evidence_drafts).toEqual([{ id: "EV-1", statement: "new" }, { id: "EV-2", statement: "keep" }]);
    expect(base.evidence_drafts[0].statement).toBe("old");
  });

  it("字段级合并时 null 不覆盖基座已有值", () => {
    const base = {
      method_applications: [{
        application_id: "MA-EV-01",
        method_id: "kb03:A02",
        status: "selected",
        target_question_refs: ["Q-1"],
        target_judgment_unit_refs: ["JU-1"],
        provenance: { stage: "stage_03", actor: "base", source_application_id: null, recorded_at: null },
        alternatives: [{ method_id: "kb03:A01", decision: "keep", reason: "基座" }],
      }],
      sources: [{
        source_key: "SRC-01",
        url: "https://example.com/a",
        title: "公告",
        publisher: "Example",
        published_at: "2026-01-01T00:00:00Z",
        source_tier: "S2",
        source_type: "disclosure",
        search_excerpt: "摘要",
        locator: "p1",
        source_quote: "原文",
      }],
      evidence_drafts: [],
    };
    const next = mergeChangeSet(base, {
      ...contract,
      target_stage: "stage_03",
      trigger_event_id: "event-1",
      affected_object_refs: ["MA-EV-01", "SRC-01"],
      rationale: "null-safe merge",
      upserts: {
        method_applications: [{
          application_id: "MA-EV-01",
          status: "degraded",
          target_question_refs: null,
          target_judgment_unit_refs: null,
          provenance: null,
          alternatives: null,
          limitations: ["新增限制"],
        }],
        sources: [{
          source_key: "SRC-01",
          url: null,
          title: null,
          publisher: null,
          published_at: null,
          source_tier: null,
          source_type: null,
          search_excerpt: null,
          locator: "p2",
          source_quote: null,
        }],
      },
      removals: {},
    }) as any;
    expect(next.method_applications[0]).toMatchObject({
      application_id: "MA-EV-01",
      status: "degraded",
      target_question_refs: ["Q-1"],
      target_judgment_unit_refs: ["JU-1"],
      provenance: { stage: "stage_03", actor: "base" },
      alternatives: [{ method_id: "kb03:A01", decision: "keep", reason: "基座" }],
      limitations: ["新增限制"],
    });
    expect(next.sources[0]).toMatchObject({
      source_key: "SRC-01",
      url: "https://example.com/a",
      title: "公告",
      source_tier: "S2",
      locator: "p2",
      source_quote: "原文",
    });
  });

  it("拒绝越界 section 和未声明对象", () => {
    expect(() => mergeChangeSet({}, {
      ...contract,
      target_stage: "stage_03",
      trigger_event_id: "event-1",
      affected_object_refs: ["EV-1"],
      rationale: "bad",
      upserts: { judgments: [{ id: "EV-1" }] },
      removals: {},
    })).toThrow(/不允许修改/);
    const expanded = mergeChangeSet({ evidence_drafts: [{ id: "EV-1", statement: "old" }] }, {
      ...contract,
      target_stage: "stage_03",
      trigger_event_id: "event-1",
      affected_object_refs: ["EV-1"],
      rationale: "auto expand EV-2 from upsert",
      upserts: { evidence_drafts: [{ id: "EV-2", statement: "new" }] },
      removals: {},
    }) as any;
    expect(expanded.evidence_drafts.map((item: any) => item.id).sort()).toEqual(["EV-1", "EV-2"]);
  });

  it("拒绝漏报目标阶段或把上游标记为受影响", () => {
    expect(() => mergeChangeSet({}, {
      ...contract,
      target_stage: "stage_04",
      affected_stage_refs: ["stage_03"],
      trigger_event_id: "event-1",
      affected_object_refs: ["J-1"],
      rationale: "bad stage closure",
      upserts: {},
      removals: {},
    })).toThrow(/必须包含目标阶段|上游/);
  });
});

describe("mergeUpsertObject", () => {
  it("递归合并嵌套对象且 null 保基座", () => {
    expect(mergeUpsertObject(
      { a: 1, nested: { x: 1, y: 2 } },
      { b: 2, nested: { y: null, z: 3 } },
    )).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2, z: 3 } });
  });

  it("空字符串不覆盖基座非空 locator/source_quote", () => {
    expect(mergeUpsertObject(
      { locator: "p1", source_quote: "原文" },
      { locator: "", source_quote: "   ", title: "新标题" },
    )).toEqual({ locator: "p1", source_quote: "原文", title: "新标题" });
  });
});

describe("mergeStage03Patch null-safe", () => {
  it("补证 patch 的 null 字段不会冲掉基座 MA/source", () => {
    const base = {
      sources: [{ source_key: "SRC-01", url: "https://a.com", title: "A", source_tier: "S1", source_quote: "quote" }],
      evidence_drafts: [{ id: "EV-1", statement: "old", kind: "fact_draft" }],
      method_applications: [{
        application_id: "MA-EV-01",
        capability_type: "evidence",
        status: "selected",
        target_question_refs: ["Q-1"],
        applicability_boundary: "边界",
        provenance: { stage: "stage_03", actor: "base", source_application_id: null, recorded_at: null },
        alternatives: [],
      }],
      unresolved_gaps: [],
    };
    const merged = mergeStage03Patch(base, {
      affected_object_refs: ["MA-EV-01", "SRC-01", "EV-1"],
      upserts: {
        method_applications: [{
          application_id: "MA-EV-01",
          status: "degraded",
          target_question_refs: null,
          applicability_boundary: null,
          provenance: null,
        }],
        sources: [{ source_key: "SRC-01", title: null, url: null, locator: "new-loc" }],
        evidence_drafts: [{ id: "EV-1", statement: "new", kind: "fact_draft" }],
      },
    }) as any;
    expect(merged.method_applications[0]).toMatchObject({
      status: "degraded",
      target_question_refs: ["Q-1"],
      applicability_boundary: "边界",
      provenance: { actor: "base" },
    });
    expect(merged.sources[0]).toMatchObject({
      url: "https://a.com",
      title: "A",
      locator: "new-loc",
      source_quote: "quote",
    });
    expect(merged.evidence_drafts[0].statement).toBe("new");
  });

  it("upsert 漏写 affected_object_refs 时自动补齐，不因 SRC-09 未声明而失败", () => {
    const base = {
      sources: [{ source_key: "SRC-01", url: "https://a.com", title: "A" }],
      evidence_drafts: [],
      method_applications: [],
      unresolved_gaps: [],
    };
    const merged = mergeStage03Patch(base, {
      affected_object_refs: ["SRC-01"],
      upserts: {
        sources: [
          { source_key: "SRC-01", title: "A-updated" },
          { source_key: "SRC-09", url: "https://b.com", title: "B" },
        ],
      },
    }) as any;
    expect(merged.sources).toEqual([
      { source_key: "SRC-01", url: "https://a.com", title: "A-updated" },
      { source_key: "SRC-09", url: "https://b.com", title: "B" },
    ]);
  });

  it("删除已不存在的对象幂等忽略，且写错 section 也能按 ID 删掉", () => {
    const base = {
      sources: [{ source_key: "SRC-01", url: "https://a.com", title: "A" }],
      evidence_drafts: [
        { id: "EV-GAP-02", kind: "gap", statement: "keep" },
        { id: "EV-GAP-03", kind: "gap", statement: "remove-me" },
      ],
      method_applications: [],
      unresolved_gaps: ["EV-GAP-03: 旧缺口"],
    };
    const first = mergeStage03Patch(base, {
      affected_object_refs: [],
      // 故意写到 sources section：旧逻辑会报“不能删除不存在的对象”
      removals: { sources: ["EV-GAP-03"] },
      upserts: {},
    }) as any;
    expect(first.evidence_drafts.map((item: any) => item.id)).toEqual(["EV-GAP-02"]);
    expect(first.unresolved_gaps).toEqual([]);
    expect(first.sources).toEqual(base.sources);

    const second = mergeStage03Patch(first, {
      affected_object_refs: ["EV-GAP-03"],
      removals: { evidence_drafts: ["EV-GAP-03"] },
      upserts: {},
    }) as any;
    expect(second.evidence_drafts.map((item: any) => item.id)).toEqual(["EV-GAP-02"]);
  });

  it("把事实改成 gap 时即使 omit source_keys 也会清空旧绑定", () => {
    const base = {
      sources: [],
      evidence_drafts: [{
        id: "EV-1",
        kind: "fact_draft",
        statement: "旧主张",
        direction: "support",
        source_keys: ["SRC-06"],
        source_ids: ["uuid-1"],
        judgment_unit_ids: ["JU-1"],
      }],
      method_applications: [],
      unresolved_gaps: [],
    };
    const merged = mergeStage03Patch(base, {
      affected_object_refs: ["EV-1"],
      upserts: {
        evidence_drafts: [{
          id: "EV-1",
          kind: "gap",
          requirement: "取得可核验正文",
          evidence_role: "support",
          minimum_independent_sources: 1,
        }],
      },
    }) as any;
    expect(merged.evidence_drafts[0]).toMatchObject({
      id: "EV-1",
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
    });
    expect(merged.evidence_drafts[0].limitations.some((item: string) => item.includes("SRC-06"))).toBe(true);
  });
});
