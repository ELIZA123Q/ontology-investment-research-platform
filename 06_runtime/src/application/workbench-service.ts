import { resolve } from "node:path";
import { KnowledgeBundleLoader, type ReleasedKnowledgeAsset } from "@investment/knowledge";
import { SqliteRunLockRepository } from "@investment/persistence-sqlite";
import type { ResearchRunLock } from "@investment/domain";
import { AgentKernel } from "@/src/runtime/kernel";
import { defaultDatabasePath, getRuntimeStore, type RuntimeStore } from "@/src/runtime/store";
import { ResearchCaseService, type CreateResearchCaseInput, type ResearchCaseCommand } from "@/src/application/research-case-service";
import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { OntologyActionService } from "@/src/ontology/action-service";
import { parseActionHttpBody } from "@/src/ontology/http-contract";
import {
  assertActionExecutionAccess, assertOntologyObjectAccess, assertResearchCaseAccess,
  identityFromTrustedHeaders, trustedActionContext,
} from "@/src/security/runtime-access";
import { CninfoDisclosureConnector, CNINFO_CONNECTOR_ID } from "@/src/connectors/cninfo-disclosure-connector";
import { SourceConnectorRegistry, type SourceQueryRequest } from "@/src/connectors/source-connector";

export type { CreateResearchCaseInput, ResearchCaseCommand } from "@/src/application/research-case-service";

export interface ConnectorIngestionEnvelope {
  taskId: string;
  kind: "source_capture" | "financial_data";
  result: UnifiedSourceToolResult | FinancialDataToolResult;
}

export class WorkbenchApplicationService {
  readonly cases: ResearchCaseService;
  readonly knowledge: KnowledgeLearningService;
  readonly bundleLoader: KnowledgeBundleLoader;
  readonly locks: SqliteRunLockRepository;
  readonly sourceConnectors: SourceConnectorRegistry;

  constructor(readonly store: RuntimeStore = getRuntimeStore()) {
    this.cases = new ResearchCaseService(store);
    this.knowledge = new KnowledgeLearningService(store);
    this.bundleLoader = new KnowledgeBundleLoader(resolve(process.cwd(), ".data/knowledge-bundles"));
    this.locks = new SqliteRunLockRepository(store.db);
    this.sourceConnectors = new SourceConnectorRegistry();
    this.sourceConnectors.register(new CninfoDisclosureConnector());
  }

  listResearchCases() { return this.cases.list().map((item) => this.withLock(item)); }

  createResearchCase(input: CreateResearchCaseInput) {
    this.bundleLoader.loadCurrent();
    return this.store.transaction(() => {
      const researchCase = this.cases.create(input);
      const { manifest } = this.materializeRunKnowledge(researchCase.taskId);
      this.locks.installBundle(manifest.bundleId, manifest);
      const lock: ResearchRunLock = {
        runId: researchCase.taskId,
        researchCaseId: researchCase.id,
        bundleId: manifest.bundleId,
        asOf: researchCase.asOf,
        lockedAt: new Date().toISOString(),
      };
      this.locks.lock(lock);
      this.store.appendEvent({
        conversationId: researchCase.conversationId, taskId: researchCase.taskId,
        type: "knowledge.bundle.locked", actorType: "system", actorId: "knowledge-bundle-loader",
        payload: { bundleId: manifest.bundleId, sourceFingerprint: manifest.sourceFingerprint, asOf: researchCase.asOf },
      });
      return { ...researchCase, bundleId: manifest.bundleId };
    });
  }

  getResearchCase(id: string) { const item = this.cases.get(id); return item ? this.withLock(item) : null; }

  researchCaseSnapshot(id: string) {
    const snapshot = this.cases.snapshot(id);
    const lock = this.locks.get(snapshot.researchCase.taskId);
    return { ...snapshot, researchCase: { ...snapshot.researchCase, bundleId: lock?.bundleId }, knowledgeRunLock: lock };
  }

  executeResearchCaseCommand(id: string, command: ResearchCaseCommand) { return this.cases.execute(id, command); }

  listResearchCaseEvents(id: string, after = 0, limit = 200) {
    const researchCase = this.cases.get(id);
    if (!researchCase) return null;
    return this.store.listEvents(researchCase.conversationId, after, limit);
  }

  getArtifact(id: string) { return this.store.getArtifact(id); }

  health() {
    this.store.db.prepare("SELECT 1 AS ok").get();
    const current = this.bundleLoader.loadCurrent().manifest;
    return { status: "ready", productVersion: "v2", database: defaultDatabasePath(), knowledgeBundleId: current.bundleId };
  }

  ingestConnector(envelope: ConnectorIngestionEnvelope) {
    const kernel = new AgentKernel(this.store);
    return envelope.kind === "source_capture"
      ? kernel.ingestion.ingestExternalSource(envelope.taskId, envelope.result as UnifiedSourceToolResult)
      : kernel.ingestion.ingestFinancialData(envelope.taskId, envelope.result as FinancialDataToolResult);
  }

  async queryAndIngestSource(taskId: string, request: SourceQueryRequest) {
    const { result, trace } = await this.sourceConnectors.query(request, [CNINFO_CONNECTOR_ID]);
    const artifact = this.ingestConnector({ taskId, kind: "source_capture", result: result as UnifiedSourceToolResult });
    const task = this.store.getTask(taskId);
    if (task) this.store.appendEvent({
      conversationId: task.conversationId, taskId, type: "connector.source_query_completed", actorType: "system", actorId: result.connectorId,
      payload: { artifactId: artifact.id, trace, companyCode: request.companyCode, asOf: request.asOf },
    });
    return { artifact, trace };
  }

  previewOntologyAction(actionType: string, request: Request, input: unknown) {
    const body = parseActionHttpBody(input);
    const trustedContext = trustedActionContext(this.store, request, body.context);
    for (const ref of body.request.targetRefs) assertOntologyObjectAccess(this.store, request, ref);
    const trustedRequest = actionType === "CreateResearchCase" ? { ...body.request, parameters: { ...body.request.parameters, conversationRef: trustedContext.conversationId } } : body.request;
    return new OntologyActionService(this.store).preview(actionType, trustedRequest, trustedContext);
  }

  applyOntologyAction(actionType: string, request: Request, input: unknown) {
    const body = parseActionHttpBody(input);
    const trustedContext = trustedActionContext(this.store, request, body.context);
    for (const ref of body.request.targetRefs) assertOntologyObjectAccess(this.store, request, ref);
    const trustedRequest = actionType === "CreateResearchCase" ? { ...body.request, parameters: { ...body.request.parameters, conversationRef: trustedContext.conversationId } } : body.request;
    return new OntologyActionService(this.store).apply(actionType, trustedRequest, trustedContext);
  }

  ontologyObjectActions(request: Request, ref: { type: string; id: string }) {
    assertOntologyObjectAccess(this.store, request, ref);
    const identity = identityFromTrustedHeaders(request);
    const actorType = identity.roles.includes("tenant_admin") ? "ontology_admin" : "researcher";
    return new OntologyActionService(this.store).availableActions(ref, { actorType, actorId: identity.userId });
  }

  ontologyResearchCaseGraph(request: Request, id: string) {
    assertResearchCaseAccess(this.store, request, id);
    return new OntologyActionService(this.store).researchCaseGraph(id);
  }

  ontologyActionExecution(request: Request, id: string) {
    return assertActionExecutionAccess(this.store, request, id);
  }

  listKnowledgeCandidates(filters: { status?: string; taskId?: string } = {}) {
    return this.store.knowledge.listCandidates(filters as Parameters<RuntimeStore["knowledge"]["listCandidates"]>[0]);
  }

  decideKnowledgeCandidate(input: Parameters<KnowledgeLearningService["decideCandidate"]>[0]) {
    return this.knowledge.decideCandidate(input);
  }

  publishKnowledgeRelease(candidateIds: string[], createdBy: string) {
    const release = this.knowledge.publishCandidates(candidateIds, createdBy);
    const assets = release.assetRefs.map((ref) => this.releasedAsset(ref)).filter((item): item is ReleasedKnowledgeAsset => Boolean(item));
    const knowledgeBundle = this.bundleLoader.materializeRelease({ releaseId: release.id, assets });
    this.locks.installBundle(knowledgeBundle.manifest.bundleId, knowledgeBundle.manifest);
    return { release, knowledgeBundleId: knowledgeBundle.manifest.bundleId };
  }

  private withLock<T extends { taskId: string }>(value: T): T & { bundleId?: string } {
    return { ...value, bundleId: this.locks.get(value.taskId)?.bundleId };
  }

  private materializeRunKnowledge(taskId: string) {
    const lock = this.store.knowledge.getKnowledgeLock(taskId);
    if (!lock) return this.bundleLoader.loadCurrent();
    const assets = lock.assetRefs.map((ref) => this.releasedAsset(ref)).filter((item): item is ReleasedKnowledgeAsset => Boolean(item));
    return this.bundleLoader.materializeRelease({ releaseId: lock.fingerprint, assets });
  }

  private releasedAsset(ref: Parameters<RuntimeStore["knowledge"]["getAssetRevisionByRef"]>[0]): ReleasedKnowledgeAsset | null {
    const revision = this.store.knowledge.getAssetRevisionByRef(ref);
    if (!revision) return null;
    return {
      assetId: ref.assetId, kind: ref.kind, version: ref.version, fingerprint: ref.fingerprint,
      authorityRef: `knowledge-release://${ref.scope.kind}/${ref.assetId}@${ref.version}`,
      content: revision.content, provenanceRefs: revision.provenanceRefs,
    };
  }
}

let singleton: WorkbenchApplicationService | undefined;
export function getWorkbenchApplication(): WorkbenchApplicationService {
  singleton ||= new WorkbenchApplicationService();
  return singleton;
}
