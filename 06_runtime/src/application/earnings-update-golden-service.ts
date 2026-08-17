import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SkillHandlerRegistry, TypedSkillWorkerAdapter, type SkillArtifactDraft } from "@investment/adapters";
import type { AgentContract, ArtifactEnvelope, KnowledgeRef } from "@investment/domain";
import { KnowledgeBundleLoader } from "@investment/knowledge";
import { DeterministicSupervisor, EARNINGS_UPDATE_GRAPH, WorkerRegistry } from "@investment/orchestrator";
import { SqliteOrchestratorRepository } from "@investment/persistence-sqlite";
import { runEarningsUpdateReplay, type EarningsUpdateReplayFixture, type EarningsUpdateReplayResult } from "@/src/evaluation/earnings-update-replay";

export type GoldenGate = "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation";

export interface GoldenEarningsRunResult {
  runId: string;
  status: "completed" | "waiting_approval";
  waitingFor?: GoldenGate;
  replay: EarningsUpdateReplayResult;
  artifacts: ArtifactEnvelope[];
  workOrders: ReturnType<SqliteOrchestratorRepository["listOrders"]>;
  events: ReturnType<SqliteOrchestratorRepository["listEvents"]>;
  passed: boolean;
}

const contracts: AgentContract[] = [
  { agentId: "research-lead", contextPolicy: "conversation", writableArtifactKinds: ["judgment", "report"], allowedNodeKinds: ["judgment", "compose"] },
  { agentId: "evidence-investigator", contextPolicy: "delegated_slice", writableArtifactKinds: ["evidence_package"], allowedNodeKinds: ["evidence_capture"] },
  { agentId: "financial-modeler", contextPolicy: "delegated_slice", writableArtifactKinds: ["normalized_financials", "financial_model"], allowedNodeKinds: ["financial_normalization", "model_build_or_update"] },
  { agentId: "independent-critic", contextPolicy: "isolated_review", writableArtifactKinds: ["review"], allowedNodeKinds: ["independent_review"] },
];

export class EarningsUpdateGoldenService {
  readonly repository: SqliteOrchestratorRepository;
  constructor(readonly db: DatabaseSync, readonly bundleLoader: KnowledgeBundleLoader) {
    this.repository = new SqliteOrchestratorRepository(db);
  }

  async run(fixture: EarningsUpdateReplayFixture, approve: (gate: GoldenGate) => boolean = () => true): Promise<GoldenEarningsRunResult> {
    const runId = `golden:${fixture.id}:${randomUUID()}`;
    const { bundle } = this.bundleLoader.loadCurrent();
    const replay = runEarningsUpdateReplay(fixture);
    const knowledgeRefs = new Map<string, KnowledgeRef>();
    for (const id of ["task:earnings_update", "skill:independent-research-review", "skill:research-delivery"]) {
      knowledgeRefs.set(id, this.bundleLoader.references(bundle, [id])[0]);
    }
    const workers = this.workers(fixture, replay);
    const supervisor = new DeterministicSupervisor(workers, this.repository, this.repository, this.repository);
    let previous: ArtifactEnvelope | undefined;
    const completedNodeKinds = new Set<string>();
    for (const [index, node] of EARNINGS_UPDATE_GRAPH.entries()) {
      const refs = node.requiredKnowledgeAssets.map((id) => knowledgeRefs.get(id)!);
      const order = supervisor.createOrder({
        runId, nodeId: `${String(index + 1).padStart(2, "0")}:${node.kind}`, node,
        goal: fixture.researchQuestion, input: { fixtureId: fixture.id, previous: previous?.content },
        inputArtifactIds: previous ? [previous.id] : [], knowledgeRefs: refs,
        budget: { maxModelCalls: 1, maxToolCalls: 2, maxCostUsd: 1 }, completedNodeKinds: [...completedNodeKinds],
      });
      const result = await supervisor.execute(order);
      if (result.status !== "completed" || !result.artifact) throw new Error(result.error?.message || `Golden node failed: ${node.kind}`);
      previous = result.artifact;
      completedNodeKinds.add(node.kind);
      if (node.humanGateAfter) {
        this.repository.append({ runId, type: "approval.requested", actorId: "research-lead", payload: { gate: node.humanGateAfter, nodeId: order.nodeId, artifactId: result.artifact.id } });
        if (!approve(node.humanGateAfter)) return this.result(runId, "waiting_approval", replay, node.humanGateAfter);
        this.repository.append({ runId, type: "approval.approved", actorId: "researcher", payload: { gate: node.humanGateAfter, nodeId: order.nodeId, artifactId: result.artifact.id } });
      }
    }
    return this.result(runId, "completed", replay);
  }

  private workers(fixture: EarningsUpdateReplayFixture, replay: EarningsUpdateReplayResult): WorkerRegistry {
    const handlers = new SkillHandlerRegistry();
    const handler = (skillId: string, execute: (nodeKind: string) => Promise<SkillArtifactDraft> | SkillArtifactDraft) => handlers.register({
      skillId,
      execute: async (context) => execute(context.nodeKind),
    });
    handler("evidence-research", () => ({
      kind: "evidence_package", schemaId: "evidence-package", schemaVersion: "1.0.0",
      content: { source: fixture.source, attested: /^sha256:[a-f0-9]{64}$/.test(fixture.source.rawContentHash), capturedAt: fixture.asOf },
      sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }));
    handler("financial-modeling", (nodeKind) => nodeKind === "financial_normalization" ? ({
      kind: "normalized_financials", schemaId: "normalized-financials", schemaVersion: "1.0.0",
      content: fixture.normalizedFinancials, sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }) : ({
      kind: "financial_model", schemaId: "deterministic-financial-model-replay", schemaVersion: "1.0.0",
      content: { outputChecks: replay.outputChecks, audit: replay.modelAudit, limitations: replay.limitations }, sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }));
    handler("judgment-reasoning", () => ({
      kind: "judgment", schemaId: "bounded-judgment", schemaVersion: "1.0.0",
      content: { disposition: replay.outcome, statement: replay.judgment, limitations: replay.limitations, valuationStatus: replay.valuationStatus }, sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }));
    handler("independent-research-review", () => ({
      kind: "review", schemaId: "independent-review", schemaVersion: "1.0.0",
      content: { passed: replay.passed, blockers: replay.valuationGate.errors, isolation: "artifact_only" }, sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }));
    handler("research-delivery", () => ({
      kind: "report", schemaId: "research-report", schemaVersion: "1.0.0",
      content: { title: `${fixture.entity.name}业绩更新复核`, judgment: replay.judgment, outputChecks: replay.outputChecks, limitations: replay.limitations }, sourceRefs: [fixture.source.uri], knowledgeRefs: [],
    }));
    handlers.assertCoverage(EARNINGS_UPDATE_GRAPH.map((node) => node.skillId));
    const registry = new WorkerRegistry();
    for (const contract of contracts) {
      registry.register(new TypedSkillWorkerAdapter(contract, handlers));
    }
    return registry;
  }

  private result(runId: string, status: GoldenEarningsRunResult["status"], replay: EarningsUpdateReplayResult, waitingFor?: GoldenGate): GoldenEarningsRunResult {
    const artifacts = this.repository.listArtifacts(runId);
    const workOrders = this.repository.listOrders(runId);
    const events = this.repository.listEvents(runId);
    return {
      runId, status, waitingFor, replay, artifacts, workOrders, events,
      passed: replay.passed && status === "completed" && artifacts.length === EARNINGS_UPDATE_GRAPH.length
        && workOrders.every((item) => item.result?.status === "completed")
        && new Set(workOrders.map((item) => item.order.assignedAgent)).size === 4,
    };
  }
}
