import { describe, expect, it } from "vitest";
import { matchesEvidenceQuickFilter, sortByEvidencePriority } from "@/app/lib/evidence-view";

describe("researcher evidence view", () => {
  it("filters pending, gaps and supplement changes without mixing states", () => {
    expect(matchesEvidenceQuickFilter({ filter: "pending", kind: "fact_draft", workStatus: "approved" })).toBe(false);
    expect(matchesEvidenceQuickFilter({ filter: "pending", kind: "fact_draft", workStatus: "rework" })).toBe(true);
    expect(matchesEvidenceQuickFilter({ filter: "gaps", kind: "gap" })).toBe(true);
    expect(matchesEvidenceQuickFilter({ filter: "gaps", kind: "fact_draft" })).toBe(false);
    expect(matchesEvidenceQuickFilter({ filter: "changes", kind: "fact_draft", changed: true })).toBe(true);
    expect(matchesEvidenceQuickFilter({ filter: "changes", kind: "fact_draft", changed: false })).toBe(false);
  });

  it("moves the highest-value evidence gaps to the front and keeps the remaining order stable", () => {
    const items = [{ id: "EV-1" }, { id: "GAP-2" }, { id: "EV-2" }, { id: "GAP-1" }];
    expect(sortByEvidencePriority(items, ["GAP-1", "GAP-2"]).map((item) => item.id))
      .toEqual(["GAP-1", "GAP-2", "EV-1", "EV-2"]);
  });
});
