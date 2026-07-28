import { describe, expect, it } from "vitest";
import { buildResearchOverview, stripInternalReferencePrefix } from "@/engine/research_overview";

describe("research_overview", () => {
  it("turns an all-J0 result into an explicit stop conclusion", () => {
    const overview = buildResearchOverview({
      runId: "run-1",
      currentStage: 5,
      pending: [],
      deliveryReady: true,
      judgments: [
        { strength: "J0", conclusion: "库存周期无法判断" },
        { level: "J0", conclusion: "需求修复无法判断" },
      ],
      evidence: [{ kind: "gap" }, { kind: "conflict" }],
    });

    expect(overview.headline).toBe("当前证据不足，暂不形成方向判断");
    expect(overview.explanation).toContain("2 个判断单元均停在暂不可判断");
    expect(overview.explanation).toContain("相互矛盾或尚缺的证据");
    expect(overview.primaryAction.href).toBe("/runs/run-1/report");
    expect(overview.primaryAction.title).toBe("检查报告并导出交付");
  });

  it("prioritizes a high-priority pending review as the single next action", () => {
    const overview = buildResearchOverview({
      runId: "run-1",
      currentStage: 3,
      pending: [
        { stage: "stage_03", title: "普通审阅", reason: "稍后处理", priority: "low" },
        { stage: "stage_04", title: "JU-01：确认核心判断", reason: "ER-01: 需要人工确认", priority: "high" },
      ],
      deliveryReady: false,
      judgments: [],
      evidence: [],
    });

    expect(overview.primaryAction.title).toBe("确认核心判断");
    expect(overview.primaryAction.description).toBe("需要人工确认");
    expect(overview.primaryAction.href).toBe("/runs/run-1/judgments");
  });

  it("hides known internal reference prefixes from researcher-facing copy", () => {
    expect(stripInternalReferencePrefix("ER-04：需要两条独立来源")).toBe("需要两条独立来源");
    expect(stripInternalReferencePrefix("未取得可核验来源：ER-04:需要两条独立来源")).toBe("未取得可核验来源：需要两条独立来源");
    expect(stripInternalReferencePrefix("普通研究文本")).toBe("普通研究文本");
  });

  it("turns a generated artifact into an explicit human-review action even without work items", () => {
    const overview = buildResearchOverview({
      runId: "run-recovered",
      currentStage: 0,
      pending: [],
      awaitingReviewStage: "stage_01",
      deliveryReady: false,
      judgments: [],
      evidence: [],
    });

    expect(overview.primaryAction).toEqual({
      eyebrow: "等待人工确认",
      title: "检查范围草稿",
      description: "AI 已完成本阶段；确认或退回后才会继续下一阶段。",
      href: "/runs/run-recovered/scope",
      cta: "去确认 →",
    });
  });

  it("routes the continue-next-stage action to review scenes instead of stage editors", () => {
    const overview = buildResearchOverview({
      runId: "run-next",
      currentStage: 2,
      pending: [],
      deliveryReady: false,
      judgments: [],
      evidence: [],
    });

    expect(overview.primaryAction.href).toBe("/runs/run-next/evidence");
    expect(overview.primaryAction.eyebrow).toContain("证据");
  });
});
