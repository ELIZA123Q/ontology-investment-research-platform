import { describe, expect, it } from "vitest";
import {
  attachResearchValueReview,
  buildStage05RetryContext,
  heuristicResearchValueReview,
} from "@/engine/research_value_review";

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
});
