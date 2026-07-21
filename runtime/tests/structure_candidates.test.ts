import { describe, expect, it } from "vitest";
import {
  competingExplanationsForUnit,
  formatCandidateBullet,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "../engine/structure_candidates";

describe("structure_candidates", () => {
  it("升格旧 string[] 并保留对象绑定", () => {
    const competing = normalizeCompetingExplanations(
      [
        "季节性波动",
        { explanation_id: "CE-02", statement: "提前采购", judgment_unit_ids: ["JU-1", "JU-X"] },
      ],
      { unitIds: ["JU-1", "JU-2"] },
    );
    expect(competing).toEqual([
      { explanation_id: "CE-01", statement: "季节性波动", judgment_unit_ids: [] },
      { explanation_id: "CE-02", statement: "提前采购", judgment_unit_ids: ["JU-1"] },
    ]);
    expect(competingExplanationsForUnit(competing, "JU-1")).toHaveLength(1);
    expect(formatCandidateBullet(competing[0])).toContain("待归属");
    expect(formatCandidateBullet(competing[1])).toContain("挂接 JU-1");
  });

  it("反向证据方向同样对象化", () => {
    const directions = normalizeCounterEvidenceDirections(["库存回升"], { unitIds: ["JU-1"] });
    expect(directions[0]).toMatchObject({ direction_id: "CD-01", statement: "库存回升", judgment_unit_ids: [] });
  });
});
