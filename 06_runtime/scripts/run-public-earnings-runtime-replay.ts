import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import type { EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";
import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = process.argv[2] ? resolve(process.argv[2]) : resolve(runtimeRoot, "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as EarningsUpdateReplayFixture;

function financialInput(source: EarningsUpdateReplayFixture): FinancialDataToolResult {
  return {
    connectorId: "frozen.public.earnings.replay",
    operation: "materialize_frozen_public_earnings_update",
    requestParameters: { sourceUri: source.source.uri, sourceHash: source.source.rawContentHash, fixtureId: source.id },
    requestedAt: source.asOf,
    retrievedAt: source.asOf,
    asOf: source.asOf,
    entity: source.entity,
    upstream: {
      sourceId: `frozen-public-document:${source.id}`,
      uri: source.source.uri,
      title: source.source.title,
      publisherId: source.source.publisherId,
      publishedAt: source.source.publishedAt,
      sourceType: "primary",
    },
    permissionScope: "public_research_use",
    documentAttestation: { rawContentHash: source.source.rawContentHash, byteLength: source.source.byteLength, mimeType: "application/pdf" },
    observations: source.normalizedFinancials.observations.map((item) => ({
      metricId: item.metricId,
      metricName: item.metricName || item.metricId,
      value: item.value,
      unit: item.unit || "元",
      currency: item.currency,
      businessTime: item.businessTime || item.period.end,
      periodStart: item.period.start,
      periodEnd: item.period.end,
      basis: item.basis === "restated" ? "restated" : item.basis === "consensus" ? "consensus" : "reported",
      dimensions: item.dimensions,
      locator: source.source.locator,
    })),
  };
}

const priorScope = process.env.VNEXT_EXECUTION_SCOPE;
process.env.VNEXT_EXECUTION_SCOPE = "evaluation";
const store = new RuntimeStore(":memory:");
try {
  const kernel = new AgentKernel(store);
  const conversation = store.createConversation(`${fixture.entity.name}业绩更新回放`);
  const submitted = kernel.submitGoal(conversation.id, `${fixture.entity.name} 2025 年业绩快报更新：核验收入增长是否伴随营业利润改善，并明确估值输入缺失时的阻断边界。`);
  const financialArtifact = kernel.ingestion.ingestFinancialData(submitted.task.id, financialInput(fixture));
  kernel.decideApproval(submitted.approval!.id, "approved");
  kernel.executeTask(submitted.task.id);
  const task = store.getTask(submitted.task.id)!;
  const artifacts = store.listArtifacts(submitted.task.id);
  const model = [...artifacts].reverse().find((item) => item.kind === "financial_model")?.data as { audit?: { passed?: boolean }; computedOutputs?: Array<{ id: string; value: number }> } | undefined;
  const valuation = [...artifacts].reverse().find((item) => item.kind === "valuation_analysis")?.data as { status?: string; blockers?: string[] } | undefined;
  const judgments = artifacts.filter((item) => item.kind === "judgment").map((item) => item.data as { disposition?: string });
  const ingestedFacts = (financialArtifact.data as { facts: Array<{ snapshotId: string }> }).facts;
  const result = {
    schemaName: "public_earnings_runtime_replay", schemaVersion: "1.0.0", formalScoreEligible: false,
    fixtureId: fixture.id, taskStatus: task.status, outcome: task.outcome,
    sourceDocumentAttested: ingestedFacts.length === fixture.normalizedFinancials.observations.length
      && ingestedFacts.every((fact) => kernel.provenance.getSnapshot(fact.snapshotId)?.documentAttestation?.rawContentHash === fixture.source.rawContentHash),
    financialModelAuditPassed: model?.audit?.passed === true,
    computedOutputs: model?.computedOutputs?.filter((item) => ["revenue_growth", "operating_profit_growth", "reported_adjusted_net_profit_gap"].includes(item.id)) || [],
    valuationStatus: valuation?.status || "not_dispatched",
    valuationBlocked: valuation?.status === "blocked" || valuation === undefined,
    judgmentDispositions: judgments.map((item) => item.disposition || "unknown"),
    completedNodeKinds: store.listTaskNodes(submitted.task.id).filter((node) => node.status === "completed").map((node) => node.kind),
    boundary: "Single issuer source may support deterministic historical calculation, but cannot establish an independently corroborated formal investment judgment.",
  };
  const passed = result.sourceDocumentAttested && result.financialModelAuditPassed && result.computedOutputs.length === 3 && result.valuationBlocked;
  console.log(JSON.stringify({ ...result, passed }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  store.close();
  if (priorScope === undefined) delete process.env.VNEXT_EXECUTION_SCOPE;
  else process.env.VNEXT_EXECUTION_SCOPE = priorScope;
}
