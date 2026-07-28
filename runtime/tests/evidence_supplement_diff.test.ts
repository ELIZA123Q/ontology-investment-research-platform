import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildEvidenceSupplementSummary, evidenceChangeBadge } from "@/engine/evidence_supplement_diff";

describe("evidence_supplement_diff", () => {
  it("returns hidden summary when no batch and no previous diff", () => {
    const summary = buildEvidenceSupplementSummary({
      current: {
        sources: [],
        evidence_drafts: [{ id: "EV-1", statement: "s", kind: "fact_draft", source_ids: ["SRC-1"], judgment_unit_ids: ["JU-1"] }],
      },
      previous: null,
    });
    expect(summary.visible).toBe(false);
    expect(summary.headline).toBe("");
  });

  it("summarizes additions and changes against previous version", () => {
    const summary = buildEvidenceSupplementSummary({
      current: {
        stage03_batch_execution: {
          mode: "evidence_supplement_batches",
          batch_count: 2,
          batches: [{ batch_id: "B1", target_unit_ids: ["JU-1"] }, { batch_id: "B2", target_unit_ids: ["JU-2"] }],
        },
        sources: [{ source_key: "SRC-1" }, { source_key: "SRC-2" }],
        evidence_drafts: [
          { id: "EV-1", statement: "old-updated", kind: "fact_draft", source_ids: ["SRC-1"], judgment_unit_ids: ["JU-1"] },
          { id: "EV-2", statement: "new", kind: "fact_draft", source_ids: ["SRC-2"], judgment_unit_ids: ["JU-2"] },
          { id: "GAP-1", statement: "gap", kind: "gap", source_ids: [], judgment_unit_ids: ["JU-2"] },
        ],
      },
      previous: {
        sources: [{ source_key: "SRC-1" }],
        evidence_drafts: [
          { id: "EV-1", statement: "old", kind: "fact_draft", source_ids: ["SRC-1"], judgment_unit_ids: ["JU-1"] },
        ],
      },
    });

    expect(summary.visible).toBe(true);
    expect(summary.added_source_count).toBe(1);
    expect(summary.added_fact_count).toBe(1);
    expect(summary.changed_evidence_count).toBe(1);
    expect(summary.remaining_gap_count).toBe(1);
    expect(summary.target_unit_ids).toEqual(["JU-1", "JU-2"]);
    expect(summary.zero_material_change).toBe(false);
    expect(evidenceChangeBadge("EV-2", summary)).toBe("added");
    expect(evidenceChangeBadge("EV-1", summary)).toBe("changed");
  });

  it("marks zero material change when supplement batch produced no diff", () => {
    const summary = buildEvidenceSupplementSummary({
      current: {
        stage03_batch_execution: {
          mode: "evidence_supplement_batches",
          batch_count: 1,
          batches: [{ batch_id: "B1", target_unit_ids: ["JU-1"], unchanged_evidence_ids: ["EV-1"] }],
        },
        sources: [{ source_key: "SRC-1" }],
        evidence_drafts: [
          { id: "EV-1", statement: "same", kind: "fact_draft", source_ids: ["SRC-1"], judgment_unit_ids: ["JU-1"] },
          { id: "GAP-1", statement: "gap", kind: "gap", source_ids: [], judgment_unit_ids: ["JU-1"] },
        ],
      },
      previous: {
        sources: [{ source_key: "SRC-1" }],
        evidence_drafts: [
          { id: "EV-1", statement: "same", kind: "fact_draft", source_ids: ["SRC-1"], judgment_unit_ids: ["JU-1"] },
          { id: "GAP-1", statement: "gap", kind: "gap", source_ids: [], judgment_unit_ids: ["JU-1"] },
        ],
      },
    });

    expect(summary.visible).toBe(true);
    expect(summary.zero_material_change).toBe(true);
    expect(summary.headline).toContain("未取到新材料");
  });
});
