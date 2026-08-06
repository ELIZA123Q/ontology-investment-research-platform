import { describe, expect, it } from "vitest";
import { validateWorkItemReviewPatch } from "@/runner/work_item_review";
import type { ResearchWorkItem } from "@/schemas/types";

function workItem(overrides: Partial<ResearchWorkItem> = {}): ResearchWorkItem {
  return {
    id: "WI-1",
    run_id: "run-1",
    kind: "supplement_evidence",
    stage: "stage_03",
    target_type: "EvidenceDraft",
    target_id: "GAP-1",
    title: "缺口",
    status: "pending",
    priority: "high",
    reason: "",
    note: "",
    resolution: "",
    source_event_id: null,
    artifact_id: "art-1",
    attempt: 1,
    payload_json: "{}",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    resolved_at: null,
    superseded_at: null,
    ...overrides,
  };
}

describe("work_item_review", () => {
  it("rejects approving gaps without accepted_evidence_gap", () => {
    const result = validateWorkItemReviewPatch(workItem(), {
      status: "approved",
      note: "接受缺口并维持 J0 边界。",
      resolution: "accepted_evidence",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts gap approval with the right resolution", () => {
    const result = validateWorkItemReviewPatch(workItem(), {
      status: "approved",
      note: "接受缺口并维持 J0 边界。",
      resolution: "accepted_evidence_gap",
    });
    expect(result.ok).toBe(true);
  });
});
