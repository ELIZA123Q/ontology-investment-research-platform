import { describe, expect, it } from "vitest";
import {
  buildJudgmentStageSummary,
  buildScopeStageSummary,
  buildStructureStageSummary,
  buildScopeResearcherView,
  buildJudgmentResearcherView,
  buildEvidenceReadinessView,
  buildFormalDeliveryGate,
  formatResearchDate,
  prepareReaderReportMarkdown,
  researcherLanguage,
  researcherMarkdown,
} from "../app/lib/researcher-stage-output";

describe("researcher stage output", () => {
  it("summarizes the scope as a compact researcher handoff", () => {
    const result = buildScopeStageSummary({
      normalized_question: "未来六个月库存是否改善？",
      core_object: "DRAM 与 NAND",
      judgment_action: "判断价格与库存周期方向",
      time_scope: {
        lookback: "过去 12 个月",
        as_of: "2026 年 7 月",
        forward: "未来 6 个月",
      },
      boundaries: ["分产品判断", "全球市场"],
      exclusions: ["不做个股推荐"],
      report_type: "分产品方向判断报告",
      document_markdown: "# 内部完整稿\n\n`direct_extract`\n\n05落点",
    });

    expect(result).toEqual({
      question: "未来六个月库存是否改善？",
      coreObject: "DRAM 与 NAND",
      judgmentAction: "判断价格与库存周期方向",
      timeScope: [
        { label: "回看范围", value: "过去 12 个月" },
        { label: "判断时点", value: "2026 年 7 月" },
        { label: "前瞻范围", value: "未来 6 个月" },
      ],
      boundaries: ["分产品判断", "全球市场"],
      exclusions: ["不做个股推荐"],
      reportType: "分产品方向判断报告",
    });
    expect(JSON.stringify(result)).not.toMatch(/direct_extract|05落点|内部完整稿/);
  });

  it("keeps non-calendar research periods readable instead of crashing the scope page", () => {
    expect(formatResearchDate("2026H2")).toBe("2026H2");
    expect(formatResearchDate("2026-07-26")).toContain("2026");
    expect(formatResearchDate("")).toBe("未设定");
  });

  it("turns provider and graph terms in judgment rationale into research language", () => {
    expect(researcherLanguage("DeepSeek 未完成；没有可核验 EvidenceFact 或 Signal"))
      .toBe("自动判断生成未完成；没有可核验的已确认事实或研究信号");
  });

  it("groups structure inputs by researcher-facing judgment without leaking prefixes", () => {
    const result = buildStructureStageSummary({
      judgment_units: [{ id: "JU-1", title: "JU-1：库存是否改善", question: "未来两季库存是否下降？", evidence_requirements: ["ER-1：库存序列"] }],
      evidence_requirements: [{ id: "ER-2", requirement: "价格序列", judgment_unit_ids: ["JU-1"] }],
      competing_explanations: [{ statement: "季节性去库", judgment_unit_ids: ["JU-1"] }],
      counter_evidence_directions: [{ statement: "CD-1：库存重新累积", judgment_unit_ids: ["JU-1"] }],
    });
    expect(result).toEqual([expect.objectContaining({
      title: "库存是否改善",
      evidenceRequirements: ["库存序列", "价格序列"],
      competingExplanations: ["季节性去库"],
      counterEvidence: ["库存重新累积"],
    })]);
  });

  it("removes duplicate structure requirements and counter-cases from the review view", () => {
    const result = buildStructureStageSummary({
      judgment_units: [{
        id: "JU-1",
        title: "估值影响",
        evidence_requirements: ["各细分估值倍数对比"],
      }],
      evidence_requirements: [{
        requirement: "各细分估值倍数对比（AI芯片 vs 服务器 vs 数据中心）",
        judgment_unit_ids: ["JU-1"],
      }],
      counter_evidence_directions: [{
        statement: "供给释放导致价格下降",
        judgment_unit_ids: ["JU-1"],
      }],
      competing_explanations: [{
        statement: "供给释放导致价格下降（反证关键判断 1）",
        judgment_unit_ids: ["JU-1"],
      }],
    });

    expect(result[0]?.evidenceRequirements).toEqual(["各细分估值倍数对比"]);
    expect([...result[0]!.counterEvidence, ...result[0]!.competingExplanations])
      .toEqual(["供给释放导致价格下降"]);
  });

  it("keeps legacy string-form counter evidence in the stage handoff", () => {
    const result = buildStructureStageSummary({
      judgment_units: [{ id: "JU-1", title: "库存判断" }],
      counter_evidence_directions: ["渠道库存重新累积"],
      competing_explanations: ["季节性去库造成短期改善"],
    });

    expect(result[0]?.counterEvidence).toEqual(["渠道库存重新累积"]);
    expect(result[0]?.competingExplanations).toEqual(["季节性去库造成短期改善"]);
  });

  it("summarizes judgment strength, evidence and invalidation conditions in research language", () => {
    const result = buildJudgmentStageSummary({
      judgments: [{
        id: "J-1",
        title: "库存判断",
        conclusion: "库存处于去化阶段",
        strength: "J2",
        decision_status: "supported",
        supporting_evidence_draft_ids: ["EV-1"],
        invalidation_conditions: ["库存连续两月回升"],
      }],
    }, [{ id: "EV-1", statement: "EV-1：库存环比下降" }]);
    expect(result[0]).toMatchObject({
      strengthLabel: "有条件判断",
      statusLabel: "证据支持",
      evidence: ["库存环比下降"],
      invalidationConditions: ["库存连续两月回升"],
    });
  });

  it("translates audit vocabulary before it reaches researcher-facing screens", () => {
    expect(researcherLanguage("ER-05：来自 TSMC source_group，因此保持 J1"))
      .toBe("来自 TSMC 来源组，因此保持方向观察");
    expect(researcherLanguage("继续到 Stage05 确认")).toBe("继续到交付阶段确认");
    expect(researcherLanguage("RS-CONTROLLED-01 → SRC-CONTROLLED-01")).toBe("研究范围 → 来源");
    expect(researcherLanguage("仅形成两个历史营收同比方向的 J1 观察"))
      .toBe("仅形成两个历史营收同比方向观察");
    expect(researcherLanguage("增速比较（C-3，由 C-1 与 C-2 推导）"))
      .toBe("增速比较（由上述两项数据计算）");
    expect(researcherLanguage("evidence_scope_time_alignment：通过"))
      .toBe("证据范围与时间一致性：通过");
    expect(researcherLanguage("judgment_evidence_threshold 与 judgment_status_consistency"))
      .toBe("判断证据门槛 与 判断强度与状态一致性");
    expect(researcherLanguage("已批准事实支持 J-CONTROLLED-01"))
      .toBe("已确认事实支持 判断");
  });

  it("preserves markdown structure while translating each readable line", () => {
    const rendered = researcherMarkdown(`# Stage02 研究逻辑

## JU-01：库存判断

- EV-01：库存环比下降
- 保持 J1 观察
`);
    expect(rendered).toBe(`# 结构阶段 研究逻辑

## 库存判断

- 库存环比下降
- 保持方向观察`);
    expect(rendered.split("\n")).toHaveLength(6);
  });

  it("keeps audit identifiers out of the reader report preview", () => {
    const rendered = prepareReaderReportMarkdown(`# 本体约束的投研判断报告

## 已确认判断投影

### EX-01

库存改善。（J1/supported）

- Judgment：J-01
- MethodApplication：MA-01
- EvidenceFact：EV-01
- Source：SRC-01

## 边界与改判条件

- 库存回升则改判

- 参照 SRC-CONTROLLED-01 和 C-01，维持 J1 观察
`);
    expect(rendered).toContain("# 研究判断报告");
    expect(rendered).toContain("### 核心结论 1");
    expect(rendered).toContain("库存改善。（方向观察）");
    expect(rendered).toContain("库存回升则改判");
    expect(rendered).toContain("参照 来源 和 计算结果，维持方向观察");
    expect(rendered).not.toMatch(/EX-01|J-01|MA-01|EV-01|SRC-|C-01/);
  });

  it("builds a researcher view with proceed state for scope and judgments", () => {
    const scope = buildScopeResearcherView({
      normalized_question: "库存是否改善？",
      core_object: "DRAM",
      judgment_action: "判断方向",
      time_scope: { lookback: "12m", as_of: "2026-07", forward: "6m" },
      boundaries: ["全球"],
      exclusions: ["个股"],
      known_facts: ["价格已回升"],
    }, { artifactStatus: "needs_review" });
    expect(scope.outputCount).toBe(1);
    expect(scope.proceed.canProceed).toBe(true);
    expect(scope.sections.find((item) => item.id === "boundaries")?.items).toEqual(["全球"]);

    const readiness = buildEvidenceReadinessView({
      evidence_drafts: [
        { id: "EV-1", kind: "fact_draft" },
        { id: "GAP-1", kind: "gap" },
      ],
    });
    expect(readiness.factCount).toBe(1);
    expect(readiness.gapCount).toBe(1);
    expect(readiness.note).toContain("不等于判断强度");

    const constrainedReadiness = buildEvidenceReadinessView({
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft" }],
      evidence_readiness: { status: "ready" },
      delivery_readiness: { status: "ready" },
    }, { coverageConstraintCount: 2, ontologyWarningCount: 1 });
    expect(constrainedReadiness.judgmentReadyLabel).toBe("材料受限，3 项待判断前核对");
    expect(constrainedReadiness.deliveryReadyLabel).toBe("尚不能确认交付上限");
    expect(constrainedReadiness.note).toContain("最低证据组合或口径仍有限制");

    const judgments = buildJudgmentResearcherView({
      judgments: [{
        id: "J-1",
        title: "库存",
        conclusion: "改善中",
        strength: "J1",
        decision_status: "supported",
        supporting_evidence_draft_ids: ["EV-1"],
        invalidation_conditions: ["库存回升"],
      }],
    }, [{ id: "EV-1", statement: "库存环比下降" }], { artifactStatus: "needs_review", pendingCount: 1 });
    expect(judgments.proceed.canProceed).toBe(false);
    expect(judgments.proceed.blockingReasons[0]).toContain("待人工确认");
  });

  it("keeps formal export locked until review, todos, report and all stages pass", () => {
    const blocked = buildFormalDeliveryGate({
      artifactApproved: true,
      reviewPassed: false,
      pendingCount: 0,
      allStagesApproved: true,
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.label).toBe("尚未达到正式发布条件");
    expect(blocked.blockingReasons).toEqual(["独立审阅尚未通过"]);

    const ready = buildFormalDeliveryGate({
      artifactApproved: true,
      reviewPassed: true,
      pendingCount: 0,
      allStagesApproved: true,
    });
    expect(ready.ready).toBe(true);
    expect(ready.label).toBe("可导出正式发布包");
  });
});
