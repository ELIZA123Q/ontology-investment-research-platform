import { describe, expect, it } from "vitest";
import {
  attachResearchValueReview,
  buildStage05RetryContext,
  heuristicResearchValueReview,
} from "@/runner/value_review";

describe("research_value_review", () => {
  it("fails thin shells lacking research edge and tracking", () => {
    const review = heuristicResearchValueReview({
      body: "# 标题\n\n## 投资要点\n\n- 看多\n",
      stage01: { normalized_question: "存储芯片周期何时结束" },
      research_edge: [{
        market_view: "见正文表格",
        differentiated_view: "见正文表格",
      }],
    });
    expect(review.status).toBe("fail");
    expect(review.checks.some((item) => !item.pass)).toBe(true);
    expect(buildStage05RetryContext(review)).toContain("00A");
  });

  it("requires substantive edge; chapter count alone does not pass judgment value", () => {
    const review = heuristicResearchValueReview({
      body: [
        "# 存储芯片周期",
        "## 投资要点",
        "存储芯片周期何时结束",
        "## 核心结论概览",
        "概览",
        "## 市场认知差 / Research Edge",
        "表格占位",
        "## 一、供给",
        "x".repeat(600),
        "## 二、需求",
        "y".repeat(600),
        "## 投资含义与重点观察",
        "观察",
        "## 催化、验证与风险",
        "当前基线 | 触发条件 | 对判断的影响",
        "## 主要资料来源",
        "https://example.com",
      ].join("\n"),
      stage01: { normalized_question: "存储芯片周期何时结束" },
      research_edge: [{
        market_view: "见正文表格",
        differentiated_view: "见正文表格",
      }],
    });
    const judgment = review.checks.find((item) => item.id === "has_judgment_value");
    expect(judgment?.pass).toBe(false);
  });

  it("downgrades high_quality when review fails", () => {
    const data = attachResearchValueReview(
      { quality_status: "high_quality_pass", deterministic_check_status: "checked" },
      {
        status: "fail",
        checks: [{ id: "has_judgment_value", pass: false, score: 0, evidence_span: "", note: "无认知差" }],
        retry_count: 1,
        total_score: 0,
        pass_threshold: 16,
        mode: "heuristic",
      },
    );
    expect(data.quality_status).toBe("return_required");
    expect(data.research_value_review.status).toBe("fail");
  });

  it("does not let a disclaimer cancel investment-action language", () => {
    const review = heuristicResearchValueReview({
      body: [
        "# 存储周期",
        "## 投资要点",
        "库存是否改善：供给收缩，需求证据不足。",
        "## 核心结论概览",
        "库存是否改善仍需验证。",
        "## 市场认知差 / Research Edge",
        "市场认为复苏；本次判断需求仍弱。",
        "## 一、供给",
        "供给收缩→价格改善，但竞争解释仍可能是短期补库。".repeat(40),
        "## 二、需求",
        "需求证据不足，需要库存与订单交叉验证。".repeat(40),
        "## 投资含义与重点观察",
        "配置上应关注高弹性公司，投资者需警惕估值见顶风险。",
        "## 催化、验证与风险",
        "当前基线 | 触发条件 | 对判断的影响",
        "## 主要资料来源",
        "https://example.com",
        "本报告不构成买卖建议。",
      ].join("\n"),
      stage01: { normalized_question: "库存是否改善" },
      research_edge: [{
        market_view: "库存改善",
        differentiated_view: "需求仍弱",
        underestimated_mechanism: "供给收缩",
        falsifier: "库存回升",
      }],
    });
    const check = review.checks.find((item) => item.id === "no_forced_direction");
    expect(check?.pass).toBe(false);
    expect(check?.score).toBe(0);
  });
});
