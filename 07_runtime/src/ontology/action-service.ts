import { randomUUID } from "node:crypto";
import type {
  ActionApplyResult, ActionContext, ActionExecution, ActionPreview, ActionPreviewRequest,
  OntologyEdit, OntologyLink, OntologyObject, OntologyObjectRef, Task,
} from "@/src/contracts";
import { ontologyCatalog, type OntologyActionTypeDefinition } from "@/src/ontology/catalog";
import { OntologyStore } from "@/src/ontology/store";
import { materializeNodes, planResearch } from "@/src/runtime/planner";
import { RuntimeStore } from "@/src/runtime/store";

const now = () => new Date().toISOString();
const refKey = (ref: OntologyObjectRef) => `${ref.type}:${ref.id}`;
const objectRef = (type: string): OntologyObjectRef => ({ id: randomUUID(), type });
const linkEdit = (type: string, sourceRef: OntologyObjectRef, targetRef: OntologyObjectRef, properties: Record<string, unknown> = {}): OntologyEdit => ({ operation: "create_link", id: randomUUID(), type, sourceRef, targetRef, properties });
const createEdit = (ref: OntologyObjectRef, properties: Record<string, unknown>): OntologyEdit => ({ operation: "create_object", ref, properties });
const updateEdit = (ref: OntologyObjectRef, properties: Record<string, unknown>): OntologyEdit => ({ operation: "update_object", ref, properties });

export class ActionRejectedError extends Error {
  constructor(readonly preview: ActionPreview) { super(preview.errors.join("; ") || "Action is not eligible"); }
}

export class OntologyActionService {
  readonly ontology: OntologyStore;
  constructor(readonly runtime: RuntimeStore) { this.ontology = new OntologyStore(runtime); }

  availableActions(ref: OntologyObjectRef, context: ActionContext): Array<Record<string, unknown>> {
    const object = this.ontology.getObject(ref.id);
    if (!object || object.type !== ref.type) throw new Error(`Ontology object not found: ${refKey(ref)}`);
    return ontologyCatalog.actionsForObject(ref, context.actorType).map((action) => ({
      id: action.id, version: action.version, label: action.label_zh, description: action.description,
      requiresApproval: action.approval_policy.mode !== "never", approvalKind: action.approval_policy.kind,
      automationAllowed: action.automation_allowed, parameters: action.parameters,
    }));
  }

  preview(actionType: string, request: ActionPreviewRequest, context: ActionContext): ActionPreview {
    const definition = ontologyCatalog.getActionType(actionType);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!definition.allowed_actors.includes(context.actorType)) errors.push(`${context.actorType} is not allowed to apply ${actionType}`);
    this.validateParameters(definition, request.parameters, errors);
    if (!request.idempotencyKey?.trim()) errors.push("idempotencyKey is required");
    if (request.targetRefs.length !== (definition.target_types.length ? 1 : 0)) errors.push(`${actionType} requires ${definition.target_types.length ? "one" : "no"} target object`);
    for (const target of request.targetRefs) {
      const object = this.ontology.getObject(target.id);
      if (!object || object.type !== target.type) errors.push(`target does not exist: ${refKey(target)}`);
      if (!definition.target_types.includes(target.type)) errors.push(`${target.type} is not a valid target for ${actionType}`);
      const expected = request.expectedVersions[refKey(target)] ?? request.expectedVersions[target.id];
      if (expected == null) errors.push(`expected version is required for ${refKey(target)}`);
      else if (object && expected !== object.version) errors.push(`version conflict for ${refKey(target)}: expected ${expected}, current ${object.version}`);
    }
    if (request.knowledgeLockId) {
      const row = this.runtime.db.prepare("SELECT task_id FROM knowledge_locks WHERE id=?").get(request.knowledgeLockId) as { task_id?: string } | undefined;
      if (!row) errors.push(`knowledgeLockId does not exist: ${request.knowledgeLockId}`);
      else if (context.taskId && row.task_id !== context.taskId) errors.push("knowledgeLockId does not belong to the current task");
    }

    const requiresApproval = definition.approval_policy.mode === "always";
    // Preview remains useful before an approval exists: it returns the exact edits and
    // approval requirement. If a token is supplied, validate it eagerly. Apply below
    // is the enforcement boundary for a missing token.
    if (requiresApproval && request.approvalToken) errors.push(...this.approvalErrors(definition, request, context));

    let plan: { edits: OntologyEdit[]; outputRefs: OntologyObjectRef[]; invalidatedRefs: OntologyObjectRef[] } = { edits: [], outputRefs: [], invalidatedRefs: [] };
    if (!errors.length) {
      try { plan = this.planEdits(actionType, request, context); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    for (const edit of plan.edits) {
      if (edit.operation === "create_object") ontologyCatalog.getObjectType(edit.ref.type);
      if (edit.operation === "create_link") ontologyCatalog.assertRelationEndpoints(edit.type, edit.sourceRef, edit.targetRef);
    }
    if (plan.invalidatedRefs.length) warnings.push(`${plan.invalidatedRefs.length} downstream object(s) will be invalidated or superseded`);
    return {
      actionType, actionVersion: definition.version, eligible: errors.length === 0, errors, warnings,
      requiresApproval, approvalKind: definition.approval_policy.kind as ActionPreview["approvalKind"],
      edits: plan.edits, outputRefs: plan.outputRefs, invalidatedRefs: plan.invalidatedRefs,
      postCommitEffects: [...definition.post_commit_effects], catalogFingerprint: ontologyCatalog.fingerprint,
    };
  }

  apply(actionType: string, request: ActionPreviewRequest, context: ActionContext): ActionApplyResult {
    const existing = this.ontology.findActionExecution(actionType, request.idempotencyKey);
    if (existing) {
      if (existing.status !== "applied") throw new ActionRejectedError(existing.preview);
      return { execution: existing, objects: this.objectsFor(existing), links: this.linksFor(existing), queuedTaskIds: [], reused: true };
    }
    const basePreview = this.preview(actionType, request, context);
    const approvalErrors = basePreview.requiresApproval
      ? this.approvalErrors(ontologyCatalog.getActionType(actionType), request, context)
      : [];
    const preview: ActionPreview = approvalErrors.length
      ? { ...basePreview, eligible: false, errors: [...new Set([...basePreview.errors, ...approvalErrors])] }
      : basePreview;
    const execution: ActionExecution = {
      id: randomUUID(), actionType, actionVersion: preview.actionVersion, status: preview.eligible ? "applied" : "rejected",
      actorType: context.actorType, actorId: context.actorId, conversationId: context.conversationId, taskId: context.taskId,
      idempotencyKey: request.idempotencyKey, knowledgeLockId: request.knowledgeLockId, approvalId: request.approvalToken,
      request, preview, edits: preview.edits, outputRefs: preview.outputRefs, invalidatedRefs: preview.invalidatedRefs,
      error: preview.eligible ? undefined : preview.errors.join("; "), createdAt: now(), completedAt: preview.eligible ? undefined : now(),
    };
    if (!preview.eligible) {
      this.ontology.recordRejected(execution);
      throw new ActionRejectedError(preview);
    }
    let committed: ReturnType<OntologyStore["commit"]>;
    try {
      committed = this.ontology.commit(execution);
    } catch (error) {
      const failed: ActionExecution = {
        ...execution, status: "failed", error: error instanceof Error ? error.message : String(error), completedAt: now(),
      };
      this.ontology.recordRejected(failed);
      throw error;
    }
    const queuedTaskIds = this.runPostCommitEffects(preview.postCommitEffects, committed.execution, context);
    return { ...committed, queuedTaskIds, reused: false };
  }

  researchCaseGraph(id: string): { root: OntologyObject; objects: OntologyObject[]; links: OntologyLink[]; actionExecutions: ActionExecution[] } {
    const root = this.ontology.getObject(id);
    if (!root || root.type !== "ResearchCase") throw new Error(`ResearchCase not found: ${id}`);
    const objects = new Map([[root.id, root]]);
    const links: OntologyLink[] = [];
    const pending = [root.id];
    while (pending.length) {
      const current = pending.shift()!;
      for (const link of this.ontology.listLinksForObject(current)) {
        if (links.some((item) => item.id === link.id)) continue;
        links.push(link);
        for (const ref of [link.sourceRef, link.targetRef]) {
          const object = this.ontology.getObject(ref.id);
          if (object && !objects.has(object.id)) {
            objects.set(object.id, object);
            // SourceDocument is a shared catalog identity. Traversing through it would
            // merge otherwise independent ResearchCase graphs that captured the same URI.
            if (object.type !== "SourceDocument") pending.push(object.id);
          }
        }
      }
    }
    const ids = new Set(objects.keys());
    const actionExecutions = this.ontology.listObjects("ActionExecution").filter((object) => this.ontology.listLinksForObject(object.id).some((link) => ids.has(link.targetRef.id))).map((object) => this.ontology.getActionExecution(object.id)).filter((item): item is ActionExecution => Boolean(item));
    return { root, objects: [...objects.values()], links, actionExecutions };
  }

  private validateParameters(definition: OntologyActionTypeDefinition, parameters: Record<string, unknown>, errors: string[]): void {
    for (const [name, contract] of Object.entries(definition.parameters)) {
      const value = parameters[name];
      if (contract.required && (value == null || value === "")) { errors.push(`parameter ${name} is required`); continue; }
      if (value == null) continue;
      const valid = contract.type === "string" || contract.type === "datetime" ? typeof value === "string"
        : contract.type === "array" ? Array.isArray(value)
        : contract.type === "object" ? typeof value === "object" && !Array.isArray(value)
        : contract.type === "boolean" ? typeof value === "boolean"
        : contract.type === "integer" ? Number.isInteger(value)
        : true;
      if (!valid) errors.push(`parameter ${name} must be ${contract.type}`);
      if (contract.type === "datetime" && typeof value === "string" && Number.isNaN(Date.parse(value))) errors.push(`parameter ${name} must be an ISO datetime`);
    }
  }

  private approvalErrors(definition: OntologyActionTypeDefinition, request: ActionPreviewRequest, context: ActionContext): string[] {
    const errors: string[] = [];
    const approval = request.approvalToken ? this.runtime.getApproval(request.approvalToken) : null;
    if (!approval || approval.status !== "approved") return [`${definition.label_zh} requires an approved approvalToken`];
    if (definition.approval_policy.kind && approval.kind !== definition.approval_policy.kind) errors.push(`approvalToken kind must be ${definition.approval_policy.kind}`);
    if (!context.taskId) errors.push("approved actions require a taskId in ActionContext");
    else if (approval.taskId !== context.taskId) errors.push("approvalToken does not belong to the current task");
    if (context.conversationId && approval.conversationId !== context.conversationId) errors.push("approvalToken does not belong to the current conversation");
    return errors;
  }

  private planEdits(actionType: string, request: ActionPreviewRequest, context: ActionContext): { edits: OntologyEdit[]; outputRefs: OntologyObjectRef[]; invalidatedRefs: OntologyObjectRef[] } {
    const target = request.targetRefs[0];
    const p = request.parameters;
    const edits: OntologyEdit[] = [];
    const outputRefs: OntologyObjectRef[] = [];
    const invalidatedRefs: OntologyObjectRef[] = [];
    const create = (type: string, properties: Record<string, unknown>) => { const ref = objectRef(type); edits.push(createEdit(ref, properties)); outputRefs.push(ref); return ref; };
    switch (actionType) {
      case "CreateResearchCase": {
        create("ResearchCase", { title: p.title, goal: p.goal, status: "draft", conversation_ref: p.conversationRef, created_by: context.actorId });
        break;
      }
      case "ReviseResearchScope": {
        const scope = create("ResearchScope", { label: p.label, dimensions: p.dimensions, revision_reason: p.reason });
        edits.push(linkEdit("caseHasScope", target, scope));
        for (const link of this.ontology.listLinksForObject(target.id).filter((item) => item.type === "caseProducesJudgment" && item.sourceRef.id === target.id)) {
          const judgment = this.ontology.getObject(link.targetRef.id);
          if (!judgment || !["approved", "published"].includes(String(judgment.properties.lifecycle_status))) continue;
          edits.push(updateEdit(link.targetRef, { epistemic_status: "invalidated", lifecycle_status: "superseded", invalidation_reason: p.reason }));
          invalidatedRefs.push(link.targetRef);
        }
        break;
      }
      case "CaptureSource": {
        const existing = this.ontology.listObjects("SourceDocument").find((item) => item.properties.uri === p.uri);
        const source = existing ? { id: existing.id, type: existing.type } : create("SourceDocument", { title: p.title, uri: p.uri, published_at: p.publishedAt, source_tier: p.sourceTier });
        const snapshot = create("SourceSnapshot", { source_ref: source.id, locator: p.locator, content_hash: p.contentHash, captured_at: p.capturedAt, access_scope: p.accessScope, quote: p.quote || "", verification_status: "unverified" });
        edits.push(linkEdit("caseCapturesSnapshot", target, snapshot), linkEdit("snapshotOfDocument", snapshot, source));
        if (existing) {
          const priorSnapshots = this.ontology.listLinksForObject(existing.id).filter((link) => link.type === "snapshotOfDocument" && link.targetRef.id === existing.id).map((link) => link.sourceRef);
          for (const priorSnapshot of priorSnapshots) {
            const claims = this.ontology.listLinksForObject(priorSnapshot.id).filter((link) => link.type === "claimCitesSnapshot" && link.targetRef.id === priorSnapshot.id).map((link) => link.sourceRef);
            for (const claim of claims) {
              const facts = this.ontology.listLinksForObject(claim.id).filter((link) => link.type === "factDerivedFromClaim" && link.targetRef.id === claim.id).map((link) => link.sourceRef);
              for (const fact of facts) {
                edits.push(updateEdit(fact, { validity_status: "stale", invalidation_reason: "new_source_snapshot" }));
                invalidatedRefs.push(fact);
                for (const signalLink of this.ontology.listLinksForObject(fact.id).filter((link) => link.type === "factSupportsSignal" && link.sourceRef.id === fact.id)) {
                  edits.push(updateEdit(signalLink.targetRef, { validity_status: "stale", invalidation_reason: "new_source_snapshot" }));
                  invalidatedRefs.push(signalLink.targetRef);
                }
                for (const judgment of this.ontology.listObjects("Judgment")) {
                  const refs = Array.isArray(judgment.properties.evidence_refs) ? judgment.properties.evidence_refs.map(String) : [];
                  if (!refs.includes(fact.id) || !["approved", "published"].includes(String(judgment.properties.lifecycle_status))) continue;
                  const judgmentRef = { id: judgment.id, type: judgment.type };
                  edits.push(updateEdit(judgmentRef, { epistemic_status: "invalidated", lifecycle_status: "review_required", invalidation_reason: "new_source_snapshot" }));
                  invalidatedRefs.push(judgmentRef);
                }
              }
            }
          }
        }
        break;
      }
      case "VerifySourceSnapshot": {
        const decision = String(p.decision);
        if (!["verified", "rejected"].includes(decision)) throw new Error("decision must be verified or rejected");
        edits.push(updateEdit(target, { verification_status: decision, verification_note: p.note, verified_at: now() }));
        outputRefs.push(target);
        break;
      }
      case "AcceptClaim": {
        const snapshot = this.requireObject(target, "SourceSnapshot");
        if (snapshot.properties.verification_status === "rejected") throw new Error("rejected snapshot cannot support a claim");
        const claim = create("EvidenceClaim", { statement: p.statement, locator: p.locator, extracted_at: now(), cutoff_at: p.cutoffAt, semantic_refs: p.semanticRefs || [] });
        edits.push(linkEdit("claimCitesSnapshot", claim, target));
        break;
      }
      case "PromoteEvidenceFact": {
        const snapshot = this.snapshotForClaim(target.id);
        if (!snapshot || snapshot.properties.verification_status !== "verified") throw new Error("EvidenceClaim must cite a verified SourceSnapshot");
        const stamp = String(p.cutoffAt);
        const fact = create("EvidenceFact", { statement: p.statement, subject_ref: p.subjectRef, time_basis: "as_reported", scope_ref: p.scopeRef, observed_at: stamp, valid_from: stamp, valid_to: null, published_at: stamp, cutoff_at: stamp, verification_status: "verified" });
        edits.push(linkEdit("factDerivedFromClaim", fact, target));
        break;
      }
      case "RecordEvidenceAssessment": {
        const assessment = create("EvidenceAssessment", { assessment: p.assessment, directness: p.directness, limitations: p.limitations });
        edits.push(linkEdit("assessmentEvaluatesFact", assessment, target));
        break;
      }
      case "AcceptHypothesis": {
        const unit = this.requireObject({ id: String(p.judgmentUnitRef), type: "JudgmentUnit" }, "JudgmentUnit");
        const hypothesis = create("Hypothesis", { statement: p.statement, falsification_conditions: p.falsificationConditions, time_horizon: p.timeHorizon, direction: p.direction });
        edits.push(linkEdit("unitHasHypothesis", { id: unit.id, type: unit.type }, hypothesis));
        break;
      }
      case "ApproveJudgment": {
        const evidenceRefs = Array.isArray(p.evidenceRefs) ? p.evidenceRefs.map(String) : [];
        if (p.epistemicStatus === "supported" && !evidenceRefs.some((id) => this.ontology.getObject(id)?.type === "EvidenceFact" && this.ontology.getObject(id)?.properties.verification_status === "verified")) throw new Error("supported Judgment requires at least one verified EvidenceFact");
        const judgment = create("Judgment", {
          statement: p.statement, level: p.epistemicStatus === "supported" ? "J2" : "J0", confidence: p.confidence,
          epistemic_status: p.epistemicStatus, lifecycle_status: "approved", conflict_status: p.epistemicStatus === "contested" ? "unresolved" : "none",
          not_judgeable_reason: p.epistemicStatus === "indeterminate" ? "证据不足" : null, scope_ref: p.scopeRef, cutoff_at: p.cutoffAt,
          evidence_refs: evidenceRefs, hypothesis_refs: p.hypothesisRefs, conditions: p.conditions, invalidation_conditions: p.invalidationConditions,
        });
        edits.push(linkEdit("caseProducesJudgment", target, judgment));
        break;
      }
      case "SupersedeJudgment":
        edits.push(updateEdit(target, { lifecycle_status: "superseded", superseded_reason: p.reason, replacement_ref: p.replacementRef || null })); outputRefs.push(target); invalidatedRefs.push(target); break;
      case "PublishDeliverable": {
        const deliverable = this.requireObject(target, "ResearchDeliverable");
        if (!["verified", "approved"].includes(String(deliverable.properties.lifecycle_status))) throw new Error("ResearchDeliverable must be verified or approved before publication");
        edits.push(updateEdit(target, { lifecycle_status: "published", published_at: now(), publication_note: p.publicationNote })); outputRefs.push(target);
        for (const link of this.ontology.listLinksForObject(target.id).filter((item) => item.type === "deliverableIncludesJudgment" && item.sourceRef.id === target.id)) {
          edits.push(updateEdit(link.targetRef, { lifecycle_status: "published" })); outputRefs.push(link.targetRef);
        }
        break;
      }
      case "CreateResearchDeliverable": {
        const judgmentRefs = Array.isArray(p.judgmentRefs) ? p.judgmentRefs.map(String) : [];
        const deliverable = create("ResearchDeliverable", { title: p.title, artifact_ref: p.artifactRef, lifecycle_status: "draft", published_at: null });
        edits.push(linkEdit("caseHasDeliverable", target, deliverable));
        for (const id of judgmentRefs) {
          const judgment = this.requireObject({ id, type: "Judgment" }, "Judgment");
          edits.push(linkEdit("deliverableIncludesJudgment", deliverable, { id: judgment.id, type: judgment.type }));
        }
        break;
      }
      case "VerifyResearchDeliverable": {
        if (p.passed !== true) throw new Error("ResearchDeliverable cannot be verified when the verifier failed");
        edits.push(updateEdit(target, { lifecycle_status: "verified", verifier_ref: p.verifierRef, verified_at: now() }));
        outputRefs.push(target);
        break;
      }
      case "CreateMonitoringRule": {
        const monitor = create("MonitoringRule", { judgment_ref: target.id, state_variable_ref: p.stateVariableRef || null, condition: p.condition, status: p.enabled ? "active" : "paused", last_evaluated_at: null });
        edits.push(linkEdit("judgmentHasMonitor", target, monitor));
        break;
      }
      case "TriggerJudgmentReassessment": {
        const monitor = this.requireObject(target, "MonitoringRule");
        if (monitor.properties.status !== "active") throw new Error("MonitoringRule must be active");
        const relation = this.ontology.listLinksForObject(target.id).find((item) => item.type === "monitorForJudgment" || (item.type === "judgmentHasMonitor" && item.targetRef.id === target.id));
        const judgmentRef = relation?.type === "monitorForJudgment" ? relation.targetRef : relation?.sourceRef;
        if (!judgmentRef) throw new Error("MonitoringRule is not linked to a Judgment");
        edits.push(updateEdit(target, { status: "triggered", last_evaluated_at: now(), trigger_reason: p.reason, observed_ref: p.observedRef }));
        edits.push(updateEdit(judgmentRef, { epistemic_status: "invalidated", lifecycle_status: "superseded", invalidation_reason: p.reason }));
        outputRefs.push(target); invalidatedRefs.push(judgmentRef);
        break;
      }
      default: throw new Error(`No Action handler for ${actionType}`);
    }
    return { edits, outputRefs, invalidatedRefs };
  }

  private requireObject(ref: OntologyObjectRef, type: string): OntologyObject {
    const object = this.ontology.getObject(ref.id);
    if (!object || object.type !== type) throw new Error(`${type} not found: ${ref.id}`);
    return object;
  }

  private snapshotForClaim(claimId: string): OntologyObject | null {
    const relation = this.ontology.listLinksForObject(claimId).find((item) => item.type === "claimCitesSnapshot" && item.sourceRef.id === claimId);
    return relation ? this.ontology.getObject(relation.targetRef.id) : null;
  }

  private objectsFor(execution: ActionExecution): OntologyObject[] {
    return [...execution.outputRefs, ...execution.invalidatedRefs, { id: execution.id, type: "ActionExecution" }]
      .map((ref) => this.ontology.getObject(ref.id)).filter((item): item is OntologyObject => Boolean(item));
  }

  private linksFor(execution: ActionExecution): OntologyLink[] {
    return this.ontology.listLinksForObject(execution.id);
  }

  private runPostCommitEffects(effects: string[], execution: ActionExecution, context: ActionContext): string[] {
    if (!effects.some((effect) => effect.startsWith("enqueue_")) || !context.conversationId) return [];
    if (execution.actionType === "CaptureSource" && execution.invalidatedRefs.length === 0) return [];
    const caseRef = execution.outputRefs.find((ref) => ref.type === "ResearchCase") || this.caseForExecution(execution);
    if (!caseRef) return [];
    const goal = `新状态触发局部更新判断：${execution.actionType}`;
    const plan = planResearch(goal);
    const task: Task = this.runtime.createTask({
      conversationId: context.conversationId, researchCaseId: caseRef.id, goal, intent: "update_judgment", status: "queued",
      budget: { maxModelCalls: 6, maxToolCalls: 12, maxCostUsd: 1.5 },
    });
    this.runtime.createKnowledgeLock(task.id);
    this.runtime.addTaskNodes(materializeNodes(task.id, { ...plan, intent: "update_judgment" }, task.budget));
    this.runtime.enqueueTask(task.id, "execute");
    return [task.id];
  }

  private caseForExecution(execution: ActionExecution): OntologyObjectRef | null {
    const visited = new Set<string>();
    const pending = [...execution.request.targetRefs];
    while (pending.length) {
      const ref = pending.shift()!;
      if (visited.has(ref.id)) continue;
      visited.add(ref.id);
      if (ref.type === "ResearchCase") return ref;
      for (const link of this.ontology.listLinksForObject(ref.id)) {
        if (link.sourceRef.type === "ResearchCase") return link.sourceRef;
        if (link.targetRef.type === "ResearchCase") return link.targetRef;
        for (const adjacent of [link.sourceRef, link.targetRef]) {
          if (adjacent.id !== ref.id && !visited.has(adjacent.id)) pending.push(adjacent);
        }
      }
    }
    return null;
  }
}
