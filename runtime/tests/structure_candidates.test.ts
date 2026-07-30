import { describe, expect, it } from "vitest";
import {
  competingExplanationsForUnit,
  formatCandidateBullet,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
  projectEvidenceRequirementsFromStructure,
  resolveEvidenceRequirementsFromStructure,
} from "../engine/structure_candidates";

describe("structure_candidates", () => {
  it("升格旧 string[] 并保留对象绑定与区分性证据", () => {
    const competing = normalizeCompetingExplanations(
      [
        "季节性波动",
        {
          explanation_id: "CE-02",
          statement: "提前采购",
          judgment_unit_ids: ["JU-1", "JU-X"],
          discriminating_evidence: ["同口径订单与库存对照"],
        },
      ],
      { unitIds: ["JU-1", "JU-2"] },
    );
    expect(competing).toEqual([
      {
        explanation_id: "CE-01",
        statement: "季节性波动",
        judgment_unit_ids: [],
        discriminating_evidence: ["需可区分「季节性波动」与主判断路径的对照证据"],
      },
      {
        explanation_id: "CE-02",
        statement: "提前采购",
        judgment_unit_ids: ["JU-1"],
        discriminating_evidence: ["同口径订单与库存对照"],
      },
    ]);
    expect(competingExplanationsForUnit(competing, "JU-1")).toHaveLength(1);
    expect(formatCandidateBullet(competing[0])).toContain("待归属");
    expect(formatCandidateBullet(competing[1])).toContain("挂接 JU-1");
    expect(formatCandidateBullet(competing[1])).toContain("同口径订单与库存对照");
  });

  it("可从挂接单元必要证据或 ER 引用补齐 discriminating_evidence", () => {
    const fromUnit = normalizeCompetingExplanations(
      [{ explanation_id: "CE-EXP-01", statement: "供给收缩假象", judgment_unit_ids: ["JU-1"] }],
      {
        unitIds: ["JU-1"],
        unitEvidenceById: new Map([["JU-1", ["两项独立库存序列"]]]),
      },
    );
    expect(fromUnit[0].discriminating_evidence).toEqual(["两项独立库存序列"]);

    const fromRequirement = normalizeCompetingExplanations(
      [{
        explanation_id: "CE-01",
        statement: "供给收缩",
        discriminating_evidence_requirements: ["ER-03"],
      }],
      {
        evidenceRequirementById: new Map([["ER-03", "合约价格是否企稳"]]),
      },
    );
    expect(fromRequirement[0].discriminating_evidence).toEqual(["合约价格是否企稳"]);
  });

  it("反向证据方向同样对象化", () => {
    const directions = normalizeCounterEvidenceDirections(["库存回升"], { unitIds: ["JU-1"] });
    expect(directions[0]).toMatchObject({ direction_id: "CD-01", statement: "库存回升", judgment_unit_ids: [] });
  });

  it("投影必要证据与反向证据为 EvidenceRequirement", () => {
    const requirements = projectEvidenceRequirementsFromStructure({
      units: [{ id: "JU-1", evidence_requirements: ["官方披露"] }],
      counter_evidence_directions: [{ direction_id: "CD-01", statement: "库存回升", judgment_unit_ids: ["JU-1"] }],
    });
    expect(requirements).toEqual([
      {
        id: "ER-JU-1-01",
        requirement: "官方披露",
        evidence_role: "support",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      },
      {
        id: "ER-CD-01-JU-1",
        requirement: "库存回升",
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "counter_direction",
        source_ref: "CD-01",
      },
    ]);
  });

  it("把 Stage02 的 EvidenceRequirement 引用占位符展开为可执行取证要求并去重反证", () => {
    const requirements = projectEvidenceRequirementsFromStructure({
      units: [{
        id: "JU-1",
        title: "HBM 库存周期",
        question: "HBM 是否进入可持续改善阶段？",
        evidence_requirements: ["ER-JU1-support", "ER-JU1-counter"],
      }],
      counter_evidence_directions: [{
        direction_id: "CD-JU1-01",
        statement: "需求低于预期且库存重新累积",
        judgment_unit_ids: ["JU-1"],
      }],
    });

    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({
      evidence_role: "support",
      judgment_unit_ids: ["JU-1"],
    });
    expect(requirements[0].requirement).toContain("HBM 是否进入可持续改善阶段");
    expect(requirements[0].requirement).toContain("价格、库存、供给约束与需求变化时序数据");
    expect(requirements[1]).toMatchObject({
      evidence_role: "counter",
      requirement: "需求低于预期且库存重新累积",
      source: "counter_direction",
    });
  });

  it("优先执行 Stage02 顶层 EvidenceRequirement，不用 JudgmentUnit 引用重新投影", () => {
    const resolved = resolveEvidenceRequirementsFromStructure({
      units: [{
        id: "JU-1",
        question: "HBM 是否进入可持续改善阶段？",
        evidence_requirements: ["ER-JU1-support", "ER-JU1-counter"],
      }],
      evidence_requirements: [{
        id: "ER-JU1-support",
        requirement: "HBM 合约价、库存天数、客户订单覆盖和有效产出季度序列",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }, {
        id: "ER-JU1-counter",
        requirement: "AI 系统部署不及预期、客户库存积压和良率爬坡慢于预期",
        evidence_role: "counter",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "counter_direction",
        source_ref: "CD-JU1-01",
      }],
      counter_evidence_directions: [{
        direction_id: "CD-JU1-01",
        statement: "需求低于预期",
        judgment_unit_ids: ["JU-1"],
      }],
    });

    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({
      id: "ER-JU1-support",
      minimum_independent_sources: 2,
    });
    expect(resolved[0].requirement).toContain("客户订单覆盖");
    expect(resolved[1]).toMatchObject({
      source: "counter_direction",
      source_ref: "CD-JU1-01",
    });
  });
});
