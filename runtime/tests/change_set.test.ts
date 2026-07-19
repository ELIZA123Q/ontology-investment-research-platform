import { describe, expect, it } from "vitest";
import { mergeChangeSet } from "@/engine/change_set";

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
    expect(() => mergeChangeSet({ evidence_drafts: [] }, {
      ...contract,
      target_stage: "stage_03",
      trigger_event_id: "event-1",
      affected_object_refs: ["EV-1"],
      rationale: "bad",
      upserts: { evidence_drafts: [{ id: "EV-2" }] },
      removals: {},
    })).toThrow(/未声明/);
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
