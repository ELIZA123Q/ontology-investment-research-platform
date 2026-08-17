import type { Artifact } from "@/src/contracts/evidence";
import { OntologyActionService } from "@/src/ontology/action-service";
import { deriveEvidenceRoles } from "@/src/research/method-router";
import { RuntimeStore } from "@/src/runtime/store";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { LocalSourceGateway } from "@/src/tools/local-source-gateway";
import { adaptFinancialDataResult, type FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import { adaptSourceToolResult, type UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";
import { requestFingerprint } from "@/src/application/idempotency";

type Task = NonNullable<ReturnType<RuntimeStore["getTask"]>>;
type TaskNode = ReturnType<RuntimeStore["listTaskNodes"]>[number];

export class EvidenceIngestionConflictError extends Error {}

export class ResearchDataIngestionService {
  constructor(
    readonly store: RuntimeStore,
    readonly provenance: ResearchProvenanceStore,
    readonly sources: LocalSourceGateway,
    readonly actions: OntologyActionService,
  ) {}

  ingestExternalSource(taskId: string, input: UnifiedSourceToolResult): Artifact {
    const task = this.requireTask(taskId);
    this.assertEvidenceIngestionAllowed(task);
    const adapted = adaptSourceToolResult(input);
    const ingestionKey = requestFingerprint(input.connectorId, input.operation, { requestFingerprint: adapted.snapshot.acquisition.requestFingerprint, contentHash: adapted.snapshot.contentHash });
    const existing = this.store.listArtifacts(task.id).find((artifact) => artifact.kind === "evidence_package" && artifact.title === "外部来源快照" && (artifact.data as { ingestionKey?: string }).ingestionKey === ingestionKey);
    if (existing) return existing;
    const snapshot = this.provenance.saveSnapshot(adapted.snapshot);
    if (snapshot.verification !== "verified") {
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "connector.ingestion_rejected", actorType: "system", actorId: input.connectorId, payload: { kind: "source_capture", ingestionKey, snapshotId: snapshot.id, verification: snapshot.verification } });
      throw new Error("External source capture failed provenance verification");
    }
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
    const captured = this.actions.apply("CaptureSource", {
      targetRefs: [{ id: caseObject.id, type: caseObject.type }], parameters: {
        title: snapshot.title, uri: snapshot.uri, publishedAt: snapshot.publishedAt || snapshot.capturedAt,
        sourceTier: snapshot.sourceType === "primary" ? "S1" : "S3", locator: snapshot.locator, contentHash: snapshot.contentHash,
        capturedAt: snapshot.capturedAt, accessScope: snapshot.permissionScope, quote: snapshot.quote,
      }, expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
      idempotencyKey: `capture-external:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
    }, { actorType: "system", actorId: input.connectorId, conversationId: task.conversationId, taskId: task.id });
    const ontologySnapshot = captured.objects.find((object) => object.type === "SourceSnapshot");
    if (!ontologySnapshot) throw new Error("CaptureSource did not create an external SourceSnapshot");
    const verified = this.actions.apply("VerifySourceSnapshot", {
      targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }], parameters: { decision: snapshot.verification, note: "external connector adapter and provenance verifier passed" },
      expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
      idempotencyKey: `verify-external:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
    }, { actorType: "system", actorId: "provenance-verifier", conversationId: task.conversationId, taskId: task.id });
    const verifiedSnapshot = verified.objects.find((object) => object.type === "SourceSnapshot");
    if (!verifiedSnapshot) throw new Error("VerifySourceSnapshot did not return the external SourceSnapshot");
    const { body: _body, ...safeSnapshot } = snapshot;
    const artifact = this.store.putArtifact({
      conversationId: task.conversationId, taskId: task.id, kind: "evidence_package", title: "外部来源快照", status: "verified",
      data: { ingestionKey, connectorId: input.connectorId, operation: input.operation, captures: [{ ...safeSnapshot, ontologySnapshotRef: verifiedSnapshot.id }] },
      sourceRefs: [this.sources.toSourceReference(snapshot)], createdBy: input.connectorId,
    });
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "connector.source_ingested", actorType: "system", actorId: input.connectorId, payload: { artifactId: artifact.id, ingestionKey, snapshotId: snapshot.id, ontologySnapshotRef: verifiedSnapshot.id, publisherId: snapshot.publisherId } });
    this.queueEvidenceRecompute(task, "evidence_capture", artifact.id);
    return artifact;
  }

  ingestFinancialData(taskId: string, input: FinancialDataToolResult): Artifact {
    const task = this.requireTask(taskId);
    this.assertEvidenceIngestionAllowed(task);
    const adapted = adaptFinancialDataResult(input);
    const providerResponseRef = input.providerResponse && adapted.providerResponse
      ? this.store.connectorResponses.put({
        ...adapted.providerResponse,
        body: input.providerResponse.body,
        fingerprint: adapted.providerResponse.contentHash,
        connectorId: input.connectorId,
        operation: input.operation,
        permissionScope: input.permissionScope,
        capturedAt: input.retrievedAt,
      })
      : undefined;
    const ingestionKey = requestFingerprint(input.connectorId, input.operation, { asOf: adapted.asOf, snapshots: adapted.observations.map((item) => item.source.snapshot.contentHash) });
    const existing = this.store.listArtifacts(task.id).find((artifact) => artifact.kind === "evidence_package" && (artifact.data as { ingestionKey?: string }).ingestionKey === ingestionKey);
    if (existing) return existing;
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
    const captured = adapted.observations.map((observation) => {
      const snapshot = this.provenance.saveSnapshot(observation.source.snapshot);
      const capture = this.actions.apply("CaptureSource", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }],
        parameters: {
          title: snapshot.title, uri: snapshot.uri, publishedAt: snapshot.publishedAt || snapshot.capturedAt,
          sourceTier: snapshot.sourceType === "primary" ? "S1" : "S3", locator: snapshot.locator,
          contentHash: snapshot.contentHash, capturedAt: snapshot.capturedAt, accessScope: snapshot.permissionScope, quote: snapshot.quote,
        },
        expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
        idempotencyKey: `capture-financial:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
      }, { actorType: "system", actorId: input.connectorId, conversationId: task.conversationId, taskId: task.id });
      const ontologySnapshot = capture.objects.find((object) => object.type === "SourceSnapshot");
      if (!ontologySnapshot) throw new Error("CaptureSource did not create a financial SourceSnapshot");
      const verified = this.actions.apply("VerifySourceSnapshot", {
        targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
        parameters: { decision: snapshot.verification, note: "financial data adapter and provenance verifier passed" },
        expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
        idempotencyKey: `verify-financial:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
      }, { actorType: "system", actorId: "provenance-verifier", conversationId: task.conversationId, taskId: task.id });
      const verifiedSnapshot = verified.objects.find((object) => object.type === "SourceSnapshot");
      if (!verifiedSnapshot) throw new Error("VerifySourceSnapshot did not return the financial SourceSnapshot");
      return { observation, snapshot, ontologySnapshot: verifiedSnapshot };
    });
    const facts = captured.map(({ observation, snapshot, ontologySnapshot }) => {
      const fact = this.provenance.promoteFact({ snapshotId: snapshot.id, statement: observation.statement, factType: observation.factType, businessTime: observation.businessTime, confidence: "medium" });
      const accepted = this.actions.apply("AcceptClaim", {
        targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
        parameters: { statement: observation.statement, locator: snapshot.locator, cutoffAt: adapted.asOf, semanticRefs: [adapted.entity.id, observation.metricId] },
        expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
        idempotencyKey: `accept-financial-claim:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
      }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
      const claim = accepted.objects.find((object) => object.type === "EvidenceClaim");
      if (!claim) throw new Error("AcceptClaim did not create a financial EvidenceClaim");
      const promoted = this.actions.apply("PromoteEvidenceFact", {
        targetRefs: [{ id: claim.id, type: claim.type }],
        parameters: { statement: observation.statement, subjectRef: task.researchCaseId, scopeRef: task.researchCaseId, cutoffAt: adapted.asOf },
        expectedVersions: { [`${claim.type}:${claim.id}`]: claim.version },
        idempotencyKey: `promote-financial-fact:${snapshot.id}`, knowledgeLockId: this.store.knowledge.getKnowledgeLock(task.id)?.id,
      }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
      return {
        ...fact, ontologyFactRef: promoted.objects.find((object) => object.type === "EvidenceFact")?.id,
        evidenceRoles: deriveEvidenceRoles(`${observation.metricName} ${observation.statement}`),
        metric: {
          id: observation.metricId, name: observation.metricName, value: observation.value, unit: observation.unit,
          currency: observation.currency, basis: observation.basis, dimensions: observation.dimensions,
          businessTime: observation.businessTime, periodStart: observation.periodStart, periodEnd: observation.periodEnd,
        },
      };
    });
    const sourceRefs = captured.map(({ snapshot }) => this.sources.toSourceReference(snapshot));
    const artifact = this.store.putArtifact({
      conversationId: task.conversationId, taskId: task.id, kind: "evidence_package", title: "结构化金融数据", status: "verified",
      data: { ingestionKey, connectorId: input.connectorId, operation: input.operation, entity: adapted.entity, asOf: adapted.asOf, providerResponseRef, facts }, sourceRefs, createdBy: input.connectorId,
    });
    for (const fact of facts) this.provenance.addEdge(fact.id, artifact.id, "included_in");
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "financial.data_ingested", actorType: "system", actorId: input.connectorId, payload: { artifactId: artifact.id, entity: adapted.entity, asOf: adapted.asOf, responseFingerprint: providerResponseRef?.fingerprint, factIds: facts.map((fact) => fact.id), ontologyFactRefs: facts.map((fact) => fact.ontologyFactRef) } });
    this.queueEvidenceRecompute(task, "evidence_evaluation", artifact.id);
    return artifact;
  }

  private requireTask(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  private assertEvidenceIngestionAllowed(task: Task): void {
    if (["completed", "cancelled"].includes(task.status)) throw new EvidenceIngestionConflictError("A published or cancelled task cannot be mutated by a connector; create an update branch instead");
    if (task.status === "running") throw new EvidenceIngestionConflictError("A connector cannot mutate evidence while the task is running; retry when it reaches a checkpoint");
  }

  private queueEvidenceRecompute(task: Task, startKind: "evidence_capture" | "evidence_evaluation", artifactId: string): void {
    const start = this.store.listTaskNodes(task.id).find((node) => node.kind === startKind);
    if (!start) return;
    const affected = [start, ...this.descendantNodes(task.id, start.id)];
    if (!affected.some((node) => ["completed", "failed", "blocked", "cancelled"].includes(node.status))) return;
    for (const node of affected) {
      this.store.supersedePendingApprovals(node.id, `新连接器材料 ${artifactId} 要求重新计算证据及下游制品`);
      if (["ready", "blocked", "completed", "failed"].includes(node.status)) this.store.transitionNode(node.id, "invalidate", { inputArtifactIds: [], outputArtifactIds: [] }, { actorId: "artifact-service", payload: { artifactId } });
    }
    const currentTask = this.requireTask(task.id);
    if (currentTask.status !== "queued") this.store.transitionTask(task.id, "invalidate", { actorId: "artifact-service", payload: { artifactId } });
    const jobId = this.store.queue.enqueueTask(task.id, "resume");
    this.store.appendEvent({
      conversationId: task.conversationId, taskId: task.id, nodeId: start.id, type: "connector.evidence_recompute_queued",
      actorType: "system", actorId: "connector-ingestion", payload: { artifactId, startKind, affectedNodeIds: affected.map((node) => node.id), jobId },
    });
  }

  private descendantNodes(taskId: string, nodeId: string): TaskNode[] {
    const nodes = this.store.listTaskNodes(taskId);
    const descendants = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (descendants.has(node.id) || (!node.dependsOn.includes(nodeId) && !node.dependsOn.some((dependency) => descendants.has(dependency)))) continue;
        descendants.add(node.id);
        changed = true;
      }
    }
    return nodes.filter((node) => descendants.has(node.id));
  }
}
