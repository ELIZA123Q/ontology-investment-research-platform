import { describe, expect, it } from "vitest";
import type { Task } from "@/src/contracts";
import { composeProfessionalReport } from "@/src/reporting/report-composer";
import { normalizeReportSpec } from "@/src/reporting/report-spec";

const task = (reportSpec = normalizeReportSpec({ kind: "company_research" })): Task => ({
  id: "task", conversationId: "conversation", researchCaseId: "case", goal: "研究某公司的经营质量与竞争位置",
  intent: "full_research", reportSpec, status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 },
  createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z",
});

describe("professional report composer", () => {
  it("builds required sections but refuses to fill unsupported professional modules", () => {
    const report = composeProfessionalReport({ task: task(), sourceRefs: [], evidence: { facts: [], sufficient: false, stopReason: "证据不足" }, judgment: { statement: "暂不可判断", disposition: "abstain", confidence: "insufficient", changeConditions: ["补充一手来源"] } });
    expect(report.data.sections?.map((section) => section.key)).toEqual(expect.arrayContaining(["executive_summary", "business_model", "financial_operating_analysis", "valuation_scenarios", "source_appendix"]));
    expect(report.data.sections?.find((section) => section.key === "valuation_scenarios")?.status).toBe("limited");
    expect(report.data.claims).toEqual([]);
  });

  it("creates a formal claim only from an approved ontology judgment and verified sources", () => {
    const source = { sourceId: "snapshot-1", uri: "https://issuer.test/report", title: "一手来源", capturedAt: "2026-08-09T00:00:00.000Z", locator: "p1", quote: "收入增长", contentHash: "sha256:x", verification: "verified" as const, sourceType: "primary" as const, publisherId: "issuer" };
    const report = composeProfessionalReport({
      task: task(normalizeReportSpec({ kind: "industry_research" })), sourceRefs: [source],
      evidence: { facts: [{ id: "fact", snapshotId: "snapshot-1", statement: "需求、供给与价格形成同口径交叉验证", evidenceRoles: ["demand", "supply", "price"], factType: "reported_fact", confidence: "high", status: "verified", createdAt: source.capturedAt }], sufficient: true },
      judgment: { statement: "需求有条件改善", confidence: "medium", epistemicStatus: "supported", lifecycleStatus: "approved", disposition: "review_required", changeConditions: ["订单转弱"], ontologyJudgmentRef: "judgment-1", methodApplicationRefs: ["MA-core_judgments"], methodGateStatus: "provisional" },
    });
    expect(report.data.claims).toEqual([{ text: "需求有条件改善", sourceIds: ["snapshot-1"] }]);
    expect(report.sourceRefs).toEqual([source]);
  });
});
