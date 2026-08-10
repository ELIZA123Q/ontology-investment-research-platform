import { describe, expect, it } from "vitest";
import type { EvidenceFact, ReportSurfaceData, SourceReference } from "@/src/contracts";
import { evaluateReportQuality } from "@/src/evaluation/report-quality-evaluator";

const source: SourceReference = {
  sourceId: "source-1", uri: "https://issuer.test/report", title: "发行人报告", capturedAt: "2026-08-09T00:00:00.000Z",
  locator: "p.1", quote: "订单同比增长 20%", contentHash: "sha256:source-1", verification: "verified", sourceType: "primary", publisherId: "issuer.test",
};
const fact: EvidenceFact = {
  id: "fact-1", snapshotId: source.sourceId, statement: "订单同比增长 20%", factType: "measurement",
  confidence: "medium", status: "verified", createdAt: "2026-08-09T00:00:00.000Z",
};
const report: ReportSurfaceData = {
  summary: "需求有条件改善",
  boundary: "仅适用于当前证据截止日。",
  claims: [{ text: "需求有条件改善", sourceIds: [source.sourceId] }],
  reportSpec: {
    version: "1.0.0", kind: "thematic_research", audience: "investment_committee", depth: "standard", language: "zh-CN",
    sections: ["research_scope", "core_judgments", "risks_change_conditions"], customInstructions: "突出改判条件",
  },
  methodApplications: [{
    id: "MA-core", sectionKey: "core_judgments", judgmentType: "trend_direction", frameworkIds: ["framework"],
    evidenceMethodId: "evidence", adjudicationMethodId: "adjudication", requiredEvidenceRoles: ["demand"], matchedEvidenceRoles: ["demand"],
    missingEvidenceRoles: [], evidenceFactIds: [fact.id], rationale: "test", gateStatus: "passed", executionStatus: "executed", sourceRefs: [source.sourceId],
  }],
  sections: [
    { key: "research_scope", title: "研究范围", status: "ready", paragraphs: ["定制要求：突出改判条件"], bullets: [], sourceIds: [] },
    { key: "core_judgments", title: "核心判断", status: "ready", paragraphs: ["需求有条件改善"], bullets: [], sourceIds: [source.sourceId], methodApplicationIds: ["MA-core"], evidenceFactIds: [fact.id] },
    { key: "risks_change_conditions", title: "风险与改判条件", status: "ready", paragraphs: ["发生以下条件时重新取证。"], bullets: ["订单连续两个季度转弱"], sourceIds: [] },
  ],
};

describe("report quality evaluator", () => {
  it("reports separate discipline diagnostics without fabricating formal research value", () => {
    const result = evaluateReportQuality({ report, sourceRefs: [source], evidenceFacts: [fact] });
    expect(result.disciplineStatus).toBe("passed");
    expect(result.metrics).toHaveLength(8);
    expect(result.metrics.find((item) => item.id === "citation_provenance")).toMatchObject({ status: "passed", numerator: 1, denominator: 1 });
    expect(result.formalResearchValue).toMatchObject({ framework: "R/U/delta/S/C", status: "not_eligible" });
    expect(result.formalResearchValue.claimBoundary).toContain("不代表 R、U、delta、S、C");
    expect(result.formalResearchValue.missingPrerequisites).toContain("同证据直接生成稿与同证据摘要稿基线");
  });

  it("treats eligibility as permission to run the protocol, not a passing result", () => {
    const result = evaluateReportQuality({
      report, sourceRefs: [source], evidenceFacts: [fact],
      formalPrerequisites: {
        frozenEvidenceBundleHash: "sha256:evidence", frozenArtifactHash: "sha256:artifact", sealedAdjudicationRef: "sealed:R1",
        independenceMode: "dual_route_independent", perturbationSetRef: "perturbations:R1", calibratedEvaluatorModelIds: ["judge-a", "judge-b"],
        evaluatorCalibrationAtLeastC2: true, producerModelId: "producer", downstreamModelIds: ["downstream-a", "downstream-b"],
        sameEvidenceDirectBaselineRef: "baseline:direct", sameEvidenceSummaryBaselineRef: "baseline:summary",
      },
    });
    expect(result.formalResearchValue).toMatchObject({ status: "eligible", missingPrerequisites: [] });
    expect(result.formalResearchValue.claimBoundary).toContain("仍须运行协议");
  });

  it("locates broken EvidenceFact to SourceSnapshot lineage as attention", () => {
    const result = evaluateReportQuality({ report, sourceRefs: [source], evidenceFacts: [{ ...fact, snapshotId: "different-source" }] });
    expect(result.disciplineStatus).toBe("attention");
    expect(result.metrics.find((item) => item.id === "evidence_lineage")?.status).toBe("attention");
  });
});
