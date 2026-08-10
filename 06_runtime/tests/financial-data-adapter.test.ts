import { describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { adaptFinancialDataResult, type FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import { AgentKernel } from "@/src/runtime/kernel";
import { buildHomeView } from "@/src/ui/view-models";

function result(overrides: Partial<FinancialDataToolResult> = {}): FinancialDataToolResult {
  return {
    connectorId: "financial.mcp.wind", operation: "financial_indicator",
    requestParameters: { ticker: "600519.SH", fields: ["revenue", "gross_margin"] },
    requestedAt: "2026-08-09T04:00:00Z", retrievedAt: "2026-08-09T04:00:02Z", asOf: "2026-08-09T04:00:00Z",
    entity: { id: "company:600519.SH", name: "贵州茅台", instrumentId: "600519.SH" },
    upstream: { sourceId: "wind:600519:2026q2", uri: "wind://financial/600519.SH/2026Q2", title: "Wind 财务指标快照", publisherId: "贵州茅台", publishedAt: "2026-07-31T10:00:00Z", sourceType: "primary" },
    permissionScope: "public_research_use",
    observations: [
      { metricId: "revenue", metricName: "营业收入", value: 91000000000, unit: "元", currency: "CNY", businessTime: "2026-06-30T00:00:00Z", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-06-30T00:00:00Z", basis: "reported", locator: "600519.SH:2026Q2:revenue" },
      { metricId: "gross_margin", metricName: "毛利率", value: 91.2, unit: "%", businessTime: "2026-06-30T00:00:00Z", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-06-30T00:00:00Z", basis: "reported", locator: "600519.SH:2026Q2:gross_margin" },
    ],
    ...overrides,
  };
}

describe("financial data result adapter", () => {
  it("freezes metric, value, unit, time basis and provider provenance before fact promotion", () => {
    const adapted = adaptFinancialDataResult(result());
    expect(adapted.observations).toHaveLength(2);
    expect(adapted.observations[0]).toMatchObject({ metricId: "revenue", basis: "reported", factType: "reported_fact", businessTime: "2026-06-30T00:00:00.000Z" });
    expect(adapted.observations[0].statement).toContain("91000000000 CNY 元");
    expect(adapted.observations[0].source.snapshot.acquisition).toMatchObject({ connectorId: "financial.mcp.wind" });

    const store = new RuntimeStore(":memory:");
    try {
      const provenance = new ResearchProvenanceStore(store.db);
      for (const observation of adapted.observations) {
        const snapshot = provenance.saveSnapshot(observation.source.snapshot);
        const fact = provenance.promoteFact({ snapshotId: snapshot.id, statement: observation.statement, factType: observation.factType, businessTime: observation.businessTime, confidence: "medium" });
        expect(fact.status).toBe("verified");
      }
      expect(provenance.listFacts()).toHaveLength(2);
    } finally { store.close(); }
  });

  it("is deterministic and rejects time-travel, duplicates and missing units", () => {
    const first = adaptFinancialDataResult(result());
    const reordered = adaptFinancialDataResult(result({ requestParameters: { fields: ["revenue", "gross_margin"], ticker: "600519.SH" } }));
    expect(reordered.observations[0].source.snapshot.acquisition.requestFingerprint).toBe(first.observations[0].source.snapshot.acquisition.requestFingerprint);
    expect(() => adaptFinancialDataResult(result({ asOf: "2026-08-10T00:00:00Z" }))).toThrow(/asOf cannot be later/);
    expect(() => adaptFinancialDataResult(result({ observations: [{ ...result().observations[0], unit: "" }] }))).toThrow(/unit is required/);
    expect(() => adaptFinancialDataResult(result({ observations: [result().observations[0], result().observations[0]] }))).toThrow(/duplicate financial observation/);
  });

  it("ingests financial observations through SourceSnapshot, EvidenceFact and ontology Actions idempotently", () => {
    const store = new RuntimeStore(":memory:");
    try {
      const kernel = new AgentKernel(store);
      const conversation = store.createConversation("公司财务");
      const submitted = kernel.submitGoal(conversation.id, "研究贵州茅台收入与盈利能力");
      const artifact = kernel.ingestFinancialData(submitted.task.id, result());
      const repeated = kernel.ingestFinancialData(submitted.task.id, result());
      const facts = (artifact.data as { facts: Array<{ id: string; ontologyFactRef?: string; metric: { basis: string; unit: string } }> }).facts;
      expect(repeated.id).toBe(artifact.id);
      expect(facts).toHaveLength(2);
      expect(facts.every((fact) => kernel.actions.ontology.getObject(fact.ontologyFactRef!)?.type === "EvidenceFact")).toBe(true);
      expect(facts[0].metric).toMatchObject({ basis: "reported", unit: "元" });
      expect(artifact.sourceRefs).toHaveLength(2);
      expect(store.listEvents(conversation.id).filter((event) => event.type === "financial.data_ingested")).toHaveLength(1);
      expect(buildHomeView(store).signals).toMatchObject({ available: true, items: expect.arrayContaining([expect.objectContaining({ conversationId: conversation.id })]) });
      kernel.decideApproval(submitted.approval!.id, "approved");
      expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
      const evaluated = [...store.listArtifacts(submitted.task.id)].reverse().find((item) => item.title === "证据评估")!;
      expect((evaluated.data as { facts: Array<{ id: string }>; independentPublisherCount: number }).facts.map((fact) => fact.id)).toEqual(facts.map((fact) => fact.id));
      expect((evaluated.data as { independentPublisherCount: number }).independentPublisherCount).toBe(1);
      expect(evaluated.sourceRefs).toHaveLength(2);
    } finally { store.close(); }
  });
});
