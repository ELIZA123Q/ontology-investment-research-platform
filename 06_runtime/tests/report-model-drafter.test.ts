import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceFact, JudgmentSurfaceData, SourceReference, Task } from "@/src/contracts";
import type { ModelProvider } from "@/src/providers/model-provider";
import { composeProfessionalReport } from "@/src/reporting/report-composer";
import { requestReportSectionDrafts } from "@/src/reporting/report-model-drafter";
import { normalizeReportSpec } from "@/src/reporting/report-spec";
import { RuntimeStore } from "@/src/runtime/store";
import { verifyModelDraftSections } from "@/src/governance/verifiers";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const task: Task = {
  id: "task", conversationId: "conversation", researchCaseId: "case", goal: "研究未来六个月存储芯片供需与价格变化",
  intent: "full_research", reportSpec: normalizeReportSpec({ kind: "industry_research", audience: "investment_committee", depth: "deep", customInstructions: "先结论后证据" }),
  status: "running", budget: { maxModelCalls: 3, maxToolCalls: 3, maxCostUsd: 1 }, createdAt: "2026-08-09T00:00:00Z", updatedAt: "2026-08-09T00:00:00Z",
};
const source: SourceReference = { sourceId: "snapshot-1", uri: "https://issuer.test/report", title: "一手来源", capturedAt: "2026-08-09T00:00:00Z", locator: "p1", quote: "需求增长 20%，供给增长 10%，价格上涨 5%", contentHash: "sha256:x", verification: "verified", sourceType: "primary", publisherId: "issuer" };
const fact: EvidenceFact = { id: "fact-1", snapshotId: source.sourceId, statement: source.quote, factType: "reported_fact", confidence: "high", status: "verified", evidenceRoles: ["demand", "supply", "price"], createdAt: source.capturedAt };
const judgment: JudgmentSurfaceData = { statement: "供需保持偏紧", confidence: "medium", epistemicStatus: "supported", lifecycleStatus: "approved", disposition: "review_required", changeConditions: ["需求增速低于供给"], ontologyJudgmentRef: "judgment-1", methodApplicationRefs: ["MA-core_judgments"], methodGateStatus: "passed" };

function baseline() {
  return composeProfessionalReport({ task, judgment, evidence: { facts: [fact], sufficient: true }, sourceRefs: [source] });
}

describe("bounded model report drafter", () => {
  it("uses a model for eligible prose while preserving deterministic section status and references", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    let calls = 0;
    const provider: ModelProvider = { id: "fake", async generate(request) {
      calls += 1;
      const input = JSON.parse(request.prompt) as { sections: Array<{ sectionKey: string; authorizedEvidenceFactIds: string[] }> };
      const section = input.sections.find((item) => item.sectionKey === "cycle_supply_demand")!;
      return { provider: "fake", model: "research-writer-test", text: JSON.stringify({ sections: [{
        sectionKey: section.sectionKey,
        paragraphs: ["需求增长 20% 高于供给增长 10%，与价格上涨 5% 共同指向供需偏紧；但仍应按改判条件跟踪。"],
        bullets: ["需求、供给与价格使用同一来源口径。"], usedEvidenceFactIds: section.authorizedEvidenceFactIds, usedSourceIds: ["snapshot-1"],
      }] }), usage: { inputTokens: 100, outputTokens: 80 } };
    } };
    const first = await requestReportSectionDrafts(store, provider, { task, baseline: baseline(), judgment, evidenceFacts: [fact], sourceRefs: [source] });
    const second = await requestReportSectionDrafts(store, provider, { task, baseline: baseline(), judgment, evidenceFacts: [fact], sourceRefs: [source] });
    expect(first).toMatchObject({ attempted: true, cached: false, drafts: [{ sectionKey: "cycle_supply_demand" }] });
    expect(second).toMatchObject({ cached: true });
    expect(calls).toBe(1);
    const report = composeProfessionalReport({ task, judgment, evidence: { facts: [fact], sufficient: true }, sourceRefs: [source], modelDrafting: first });
    const section = report.data.sections!.find((item) => item.key === "cycle_supply_demand")!;
    expect(section.status).toBe("limited");
    expect(section.paragraphs[0]).toContain("需求增长 20%");
    expect(section.modelDraft).toMatchObject({ provider: "fake", model: "research-writer-test" });
    expect(report.data.claims).toEqual([{ text: "供需保持偏紧", sourceIds: ["snapshot-1"] }]);
    expect(verifyModelDraftSections(report.data, report.sourceRefs, [fact]).passed).toBe(true);
    expect(verifyModelDraftSections({ ...report.data, sections: report.data.sections!.map((item) => item.key === "cycle_supply_demand" ? { ...item, sourceIds: ["fake-source"] } : item) }, report.sourceRefs, [fact]).passed).toBe(false);
  });

  it("rejects fabricated numbers, unauthorized references and recommendations", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const provider: ModelProvider = { id: "fake", async generate() { return { provider: "fake", model: "unsafe", text: JSON.stringify({ sections: [{
      sectionKey: "cycle_supply_demand", paragraphs: ["建议买入，目标价上涨 999%。"], bullets: [], usedEvidenceFactIds: ["fake-fact"], usedSourceIds: ["fake-source"],
    }] }) }; } };
    const attempt = await requestReportSectionDrafts(store, provider, { task, baseline: baseline(), judgment, evidenceFacts: [fact], sourceRefs: [source] });
    expect(attempt.drafts).toBeUndefined();
    expect(attempt.errors?.join(" ")).toMatch(/unauthorized EvidenceFact|unauthorized source|prohibited investment recommendation|unsupported numeric token/);
    const report = composeProfessionalReport({ task, judgment, evidence: { facts: [fact], sufficient: true }, sourceRefs: [source], modelDrafting: attempt });
    expect(report.data.sections!.find((item) => item.key === "cycle_supply_demand")?.modelDraft).toBeUndefined();
  });
});
