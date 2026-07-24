import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  shouldPreserveStage02Markdown,
  shouldPreserveStage03Markdown,
  shouldPreserveStage04Markdown,
} from "@/engine/readable_markdown";
import { evaluateEvidenceQuality } from "@/engine/evidence_quality_gate";
import { evaluateEvidenceStopCondition } from "@/engine/source_coverage";
import { shouldPreserveStage05Markdown, stage05SectionPresent } from "@/engine/stage05_quality";
import { heuristicResearchValueReview } from "@/engine/research_value_review";

describe("remaining quality drains", () => {
  it("preserves dense model stage03/04 bodies instead of inventory templates", () => {
    const denseBlock = "围绕供给约束与库存口径交叉验证，写清覆盖、缺口与交给 04 的判断上限。".repeat(20);
    const modelPrep = [
      "# 数据与证据准备",
      "",
      "本次按 kb03:A02 对 JU-1 与 JU-2 分别取证，先查巨潮公告与通联财务，再交叉验证渠道库存口径。",
      "",
      "## 覆盖与缺口",
      "",
      "HBM 出货已有直接事实；通用 DRAM 合约价仅有受限观察，因此登记为 gap 并写明结论上限。",
      "",
      "取数留痕要求 connector、upstream_source、query_params、source_quote 与 replay_capable 一并登记，禁止只写方法名。",
      "",
      "交给 04 的上限：可用证据仅支持观察级判断，不得抬到确认反转。",
      "",
      denseBlock,
      "",
    ].join("\n");
    expect(modelPrep.length).toBeGreaterThan(800);
    expect(shouldPreserveStage03Markdown(modelPrep)).toBe(true);
    expect(shouldPreserveStage03Markdown("# 短\n")).toBe(false);

    const modelBrief = [
      "# 判断简报",
      "",
      "主路径采纳供给约束；对象分化要求 HBM 与通用 DRAM 分开表达。",
      "",
      "## 改判条件",
      "",
      "合约价斜率转负或渠道库存持续回补时改判，并保留竞争解释。",
      "",
      denseBlock,
      "",
    ].join("\n");
    expect(shouldPreserveStage04Markdown(modelBrief)).toBe(true);
    expect(shouldPreserveStage02Markdown([
      "# 研究逻辑",
      "",
      "框架选用与停止条件说明：按 judgment_type 裁剪最小充分组合，避免热点词机械匹配。",
      "",
      denseBlock,
      "",
      "反证方向与竞争解释需落到可执行验证，不得只写材料越多越好。",
      "",
    ].join("\n"))).toBe(true);
  });

  it("evidence gate uses judgment_unit_ids and ignores gap counts", () => {
    const result = evaluateEvidenceQuality({
      evidenceDrafts: [
        {
          id: "EV-1",
          kind: "fact_draft",
          directness: "direct",
          source_ids: ["s1"],
          judgment_unit_ids: ["JU-1"],
        },
        {
          id: "EV-GAP-1",
          kind: "gap",
          direction: "unknown",
          source_ids: [],
          judgment_unit_ids: ["JU-1"],
        },
        {
          id: "EV-GAP-2",
          kind: "gap",
          direction: "unknown",
          source_ids: [],
          judgment_unit_ids: ["JU-2"],
        },
        {
          id: "EV-GAP-3",
          kind: "gap",
          direction: "unknown",
          source_ids: [],
          judgment_unit_ids: ["JU-2"],
        },
        {
          id: "EV-GAP-4",
          kind: "gap",
          direction: "unknown",
          source_ids: [],
          judgment_unit_ids: ["JU-2"],
        },
      ],
      sources: [{
        id: "s1",
        url: "https://example.com/a",
        title: "a",
        publisher: "cninfo",
        source_group: "cninfo",
      } as any],
      judgmentUnits: [
        { id: "JU-1", judgment_type: "cycle_phase" },
        { id: "JU-2", judgment_type: "cycle_phase" },
      ],
    });
    expect(result.totalEvidence).toBe(1);
    expect(result.passed).toBe(false);
    expect(result.qualityStatus).toBe("return_required");
    expect(result.gapDetails.some((item) => item.judgmentUnitId === "JU-2" && item.isBlocking)).toBe(true);
  });

  it("does not early-stop evidence supplement when gaps stagnate and coverage is low", () => {
    const stop = evaluateEvidenceStopCondition(
      { coverage_gap_count: 3, coverage_rate: 0.2, verification_rate: 0.1 },
      3,
    );
    expect(stop.shouldStop).toBe(false);
    expect(stop.reason).toBe("no_gap_improvement_continue");
  });

  it("preserves stage05 bodies with Research Edge title variants", () => {
    const body = [
      "# 报告",
      "",
      "## 投资要点",
      "",
      "- 暂不可判断",
      "",
      "## 核心结论概览",
      "",
      "| 项目 | 结论 |",
      "|---|---|",
      "| 当前判断 | 暂不可判断 |",
      "",
      "## Research Edge",
      "",
      "| a | b |",
      "|---|---|",
      "| x | y |",
      "",
      "## 一、证据缺口",
      "",
      "缺少连续披露。".repeat(20),
      "",
      "## 二、验证窗口",
      "",
      "等待两季数据。".repeat(20),
      "",
      "## 投资含义与重点观察",
      "",
      "观察表",
      "",
      "## 催化、验证与风险",
      "",
      "### 未来重点观察",
      "",
      "| 当前基线 | 触发条件 | 对判断的影响 |",
      "|---|---|---|",
      "| 缺口 | 连续披露 | 可观察 |",
      "",
      "### 主要风险",
      "",
      "- 外推",
      "",
      "## 主要资料来源",
      "",
      "- 无",
      "",
    ].join("\n");
    expect(stage05SectionPresent(body, "市场认知差 / Research Edge")).toBe(true);
    expect(shouldPreserveStage05Markdown(body)).toBe(true);
  });

  it("research value heuristic rejects keyword-only shells", () => {
    const review = heuristicResearchValueReview({
      body: [
        "# 标题",
        "",
        "## 投资要点",
        "",
        "- 看多机制分化",
        "",
        "## 市场认知差 / Research Edge",
        "",
        "| a | b |",
        "|---|---|",
        "| 见正文表格 | 见正文表格 |",
        "",
        "## 一、短章",
        "",
        "很短",
        "",
        "## 二、也很短",
        "",
        "很短",
        "",
        "## 投资含义与重点观察",
        "",
        "x",
        "",
        "## 催化、验证与风险",
        "",
        "当前基线 触发条件",
        "",
        "## 主要资料来源",
        "",
        "- 无",
      ].join("\n"),
      research_edge: [{
        market_view: "见正文表格",
        differentiated_view: "见正文表格",
      }],
    });
    expect(review.status).toBe("fail");
    expect(review.checks.some((item) => item.id === "has_judgment_value" && !item.pass)).toBe(true);
  });
});
