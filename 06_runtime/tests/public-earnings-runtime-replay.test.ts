import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import type { EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";
import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json"), "utf8")) as EarningsUpdateReplayFixture;

function input(): FinancialDataToolResult {
  return {
    connectorId: "frozen.public.earnings.replay", operation: "materialize_frozen_public_earnings_update",
    requestParameters: { sourceUri: fixture.source.uri, sourceHash: fixture.source.rawContentHash, fixtureId: fixture.id },
    requestedAt: fixture.asOf, retrievedAt: fixture.asOf, asOf: fixture.asOf, entity: fixture.entity,
    upstream: { sourceId: `frozen-public-document:${fixture.id}`, uri: fixture.source.uri, title: fixture.source.title, publisherId: fixture.source.publisherId, publishedAt: fixture.source.publishedAt, sourceType: "primary" },
    permissionScope: "public_research_use",
    documentAttestation: { rawContentHash: fixture.source.rawContentHash, byteLength: fixture.source.byteLength, mimeType: "application/pdf" },
    observations: fixture.normalizedFinancials.observations.map((item) => ({ metricId: item.metricId, metricName: item.metricName || item.metricId, value: item.value, unit: item.unit || "元", currency: item.currency, businessTime: item.businessTime || item.period.end, periodStart: item.period.start, periodEnd: item.period.end, basis: item.basis === "restated" ? "restated" : item.basis === "consensus" ? "consensus" : "reported", dimensions: item.dimensions, locator: fixture.source.locator })),
  };
}

describe("public earnings update through the product Kernel", () => {
  it("keeps a real public document attested while completing deterministic finance without dispatching valuation", () => {
    const prior = process.env.VNEXT_EXECUTION_SCOPE;
    process.env.VNEXT_EXECUTION_SCOPE = "evaluation";
    const store = new RuntimeStore(":memory:");
    try {
      const kernel = new AgentKernel(store);
      const conversation = store.createConversation("东微业绩更新");
      const submitted = kernel.submitGoal(conversation.id, "东微半导 2025 年业绩快报更新：核验收入增长是否伴随营业利润改善，并明确估值输入缺失时的阻断边界。");
      const ingested = kernel.ingestion.ingestFinancialData(submitted.task.id, input());
      kernel.decideApproval(submitted.approval!.id, "approved");
      kernel.executeTask(submitted.task.id);
      const artifacts = store.listArtifacts(submitted.task.id);
      const model = [...artifacts].reverse().find((item) => item.kind === "financial_model")?.data as { audit?: { passed?: boolean }; computedOutputs?: Array<{ id: string; value: number }> };
      const valuation = [...artifacts].reverse().find((item) => item.kind === "valuation_analysis")?.data as { status?: string };
      const judgments = artifacts.filter((item) => item.kind === "judgment").map((item) => item.data as { disposition?: string });
      const facts = (ingested.data as { facts: Array<{ snapshotId: string }> }).facts;
      expect(facts).toHaveLength(fixture.normalizedFinancials.observations.length);
      expect(facts.every((fact) => kernel.provenance.getSnapshot(fact.snapshotId)?.documentAttestation?.rawContentHash === fixture.source.rawContentHash)).toBe(true);
      expect(model.audit?.passed).toBe(true);
      expect(model.computedOutputs?.find((item) => item.id === "revenue_growth")?.value).toBeCloseTo(24.8667, 4);
      expect(model.computedOutputs?.find((item) => item.id === "operating_profit_growth")?.value).toBeCloseTo(-8.4357, 4);
      expect(valuation).toBeUndefined();
      expect(judgments).not.toHaveLength(0);
    } finally {
      store.close();
      if (prior === undefined) delete process.env.VNEXT_EXECUTION_SCOPE; else process.env.VNEXT_EXECUTION_SCOPE = prior;
    }
  });
});
