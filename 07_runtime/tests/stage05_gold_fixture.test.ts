import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE05_REQUIRED_FIXED_SECTIONS,
  collectStage05HighQualityIssues,
  collectStage05StructureIssues,
  countArgumentChapters,
  hasPublishableStage05Structure,
  looksLikeDeterministicSkeleton,
} from "@/agents/05_delivery/quality_gate";
import {
  assertStage05ReadyForApproval,
  collectStage05ConsistencyIssues,
  ensureStage05DocumentFields,
} from "@/agents/05_delivery/input_contract";
import { buildStage05SkeletonMarkdown } from "@/agents/05_delivery/quality_gate";
import { heuristicResearchValueReview } from "@/runner/value_review";

const goldPath = resolve(
  process.cwd(),
  "../90_compat/instances/03_回归/02_memory-cycle-formal-pack/05-存储芯片周期行业周期判断-20260715-1.md",
);

describe("memory-cycle formal_pack Stage05 gold structure + density fixture", () => {
  it("reference industry cycle report contains required fixed sections and argument chapters", () => {
    const body = readFileSync(goldPath, "utf8");
    for (const section of STAGE05_REQUIRED_FIXED_SECTIONS) {
      expect(body, `missing ${section}`).toContain(`## ${section}`);
    }
    const chapters = countArgumentChapters(body);
    expect(chapters).toBeGreaterThanOrEqual(2);
    expect(chapters).toBeLessThanOrEqual(5);
    expect(hasPublishableStage05Structure(body)).toBe(true);
    const errors = collectStage05StructureIssues(body).filter((item) => item.severity === "error");
    expect(errors.map((item) => item.code)).not.toContain("missing_fixed_section");
    expect(errors.map((item) => item.code)).not.toContain("argument_chapter_count");
    expect(errors.map((item) => item.code)).not.toContain("inline_audit_details");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("审计索引");
    expect(body).not.toMatch(/J[0-4]\/(supported|indeterminate|blocked)/);
  });

  it("gold report passes high_quality density heuristics", () => {
    const body = readFileSync(goldPath, "utf8");
    expect(looksLikeDeterministicSkeleton(body)).toBe(false);
    const hqErrors = collectStage05HighQualityIssues({
      body,
      research_edge: [{
        market_view: "普遍认为价格大涨后周期见顶",
        differentiated_view: "稀缺定价强化期，分产品机制不同",
        underestimated_mechanism: "HBM 结构性扩张与通用 DRAM 供给约束",
        falsifier: "价格库存订单供给四类信号共振转弱",
        evidence_boundary: "公开合约价与样本厂商实现价不可混加",
      }],
      deterministic_check_status: "checked",
    }).filter((item) => item.severity === "error");
    expect(hqErrors.map((item) => item.code)).toEqual([]);
  });

  it("skeleton / placeholder edge cannot be high_quality_pass", () => {
    const skeleton = buildStage05SkeletonMarkdown({
      title: "测试骨架",
      question: "存储周期何时结束",
      executivePoints: ["证据不足"],
      claims: [{ id: "C1", statement: "暂不可判断" }],
      limitations: ["公开材料不足"],
      sourceLines: [],
    });
    expect(looksLikeDeterministicSkeleton(skeleton)).toBe(true);
    const data = ensureStage05DocumentFields({
      title: "测试骨架",
      executive_points: ["证据不足"],
      report_claims: [{
        id: "C1",
        statement: "暂不可判断",
        judgment_ids: ["J1"],
        method_application_ids: ["MA1"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: ["公开材料不足"],
      document_markdown: skeleton,
      expression_audit_yaml: "document_type: delivery_expression_audit\nmetadata: {}\n",
      quality_status: "high_quality_pass",
      stage_status: "complete",
      quality_gate_ref: "test",
      deterministic_check_status: "checked",
      semantic_review_status: "not_reviewed",
      source_04_brief_ref: "04.md",
      source_04_audit_ref: "04.yaml",
      delivery_ref: "05.md",
    });
    expect(data.quality_status).toBe("minimum_pass");
    const issues = collectStage05ConsistencyIssues({
      ...data,
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    });
    expect(issues.some((item) => item.severity === "error" && (
      item.code === "skeleton_not_high_quality"
      || item.code === "research_edge_thin"
      || item.code === "argument_chapter_thin"
    ))).toBe(true);
  });

  it("gold report passes 00A heuristic research_value_review", () => {
    const body = readFileSync(goldPath, "utf8");
    const review = heuristicResearchValueReview({
      body,
      stage01: {
        normalized_question: "存储芯片周期何时结束：分产品状态与条件式结束窗口",
      },
      research_edge: [{
        market_view: "涨多了所以见顶",
        differentiated_view: "稀缺定价强化",
        underestimated_mechanism: "分产品供给约束",
        falsifier: "四类信号共振",
      }],
    });
    expect(review.status).toBe("pass");
  });

  it("gold-shaped package can approve as high_quality", () => {
    const body = readFileSync(goldPath, "utf8");
    const researchEdge = [{
      market_view: "普遍认为价格大涨后周期见顶",
      differentiated_view: "稀缺定价强化期，分产品机制不同",
      underestimated_mechanism: "HBM 结构性扩张与通用 DRAM 供给约束",
      falsifier: "价格库存订单供给四类信号共振转弱",
      evidence_boundary: "公开合约价与样本厂商实现价不可混加",
    }];
    const researchValueReview = heuristicResearchValueReview({
      body,
      stage01: {
        normalized_question: "存储芯片周期何时结束：分产品状态与条件式结束窗口",
      },
      research_edge: researchEdge,
    });
    const data = ensureStage05DocumentFields({
      title: "存储芯片周期行业周期判断",
      executive_points: ["稀缺定价强化期"],
      report_claims: [{
        id: "C-01",
        statement: "稀缺定价强化期，2027H2—2028 是供给验证窗口",
        judgment_ids: ["J-01"],
        method_application_ids: ["MA-01"],
        evidence_draft_ids: ["EV-01"],
        source_ids: ["SRC-01"],
      }],
      limitations: ["样本厂商不可外推全行业"],
      document_markdown: body,
      research_edge: researchEdge,
      research_value_review: researchValueReview,
      quality_status: "high_quality_pass",
      stage_status: "complete",
      quality_gate_ref: "test",
      deterministic_check_status: "checked",
      semantic_review_status: "not_reviewed",
      source_04_brief_ref: "04.md",
      source_04_audit_ref: "04.yaml",
      delivery_ref: "05.md",
      expression_audit_yaml: "",
    });
    expect(data.quality_status).toBe("high_quality_pass");
    expect(() => assertStage05ReadyForApproval(data, { requirePublishableStructure: true })).not.toThrow();
  });
});
