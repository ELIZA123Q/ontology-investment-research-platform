import { randomUUID } from "node:crypto";
import type { Task } from "@/src/contracts";
import type {
  ActionApplyResult, ActionContext, ActionExecution, ActionPreview, ActionPreviewRequest,
  OntologyEdit, OntologyLink, OntologyObject, OntologyObjectRef,
} from "@/src/contracts/ontology";
import { ontologyCatalog, type OntologyActionTypeDefinition } from "@/src/ontology/catalog";
import { canRead } from "@/src/ontology/query-service";
import { OntologyStore } from "@/src/ontology/store";
import { materializeNodes, planResearch } from "@/src/runtime/planner";
import { RuntimeStore } from "@/src/runtime/store";
import { evaluateJudgmentThreshold } from "@/src/governance/judgment-threshold";
import { traceReachableDownstream } from "@/src/semantic/invalidation-policy";
import { assertGlobalActionPermission } from "@/src/governance/permission-policy";

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
    try { assertGlobalActionPermission(actionType, context.actorType); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    if (!definition.allowed_actors.includes(context.actorType)) errors.push(`${context.actorType} is not allowed to apply ${actionType}`);
    this.validateParameters(definition, request.parameters, errors);
    if (!request.idempotencyKey?.trim()) errors.push("idempotencyKey is required");
    if (request.targetRefs.length !== (definition.target_types.length ? 1 : 0)) errors.push(`${actionType} requires ${definition.target_types.length ? "one" : "no"} target object`);
    for (const target of request.targetRefs) {
      const object = this.ontology.getObject(target.id);
      if (!object || object.type !== target.type) errors.push(`target does not exist: ${refKey(target)}`);
      else if (context.access && !canRead(object.properties, context.access)) errors.push(`access denied for target: ${refKey(target)}`);
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
        const scope = create("ResearchScope", { label: p.label, extra_dimensions: p.dimensions, revision_reason: p.reason });
        edits.push(linkEdit("caseHasScope", target, scope));
        for (const link of this.ontology.listLinksForObject(target.id).filter((item) => item.type === "caseProducesJudgment" && item.sourceRef.id === target.id)) {
          const judgment = this.ontology.getObject(link.targetRef.id);
          if (!judgment || !["approved", "published"].includes(String(judgment.properties.lifecycle_status))) continue;
          edits.push(updateEdit(link.targetRef, { epistemic_status: "invalidated", lifecycle_status: "superseded", invalidation_reason: p.reason }));
          invalidatedRefs.push(link.targetRef);
        }
        break;
      }
      case "CreateResearchQuestion": {
        const scope = this.resolveOrCreateScope(target, p, create, edits);
        const route = String(p.failureRoute);
        if (!["stop", "downgrade", "competing_explanation", "return_to_structure"].includes(route)) throw new Error("invalid ResearchQuestion failureRoute");
        const question = create("ResearchQuestion", { question: p.question, scope_ref: scope.id, failure_route: route });
        edits.push(linkEdit("caseAddressesQuestion", target, question));
        break;
      }
      case "ConfirmResearchMandate": {
        const question = this.requireObject({ id: String(p.questionRef), type: "ResearchQuestion" }, "ResearchQuestion");
        const belongs = this.ontology.listLinksForObject(target.id).some((link) => link.type === "caseAddressesQuestion" && link.sourceRef.id === target.id && link.targetRef.id === question.id);
        if (!belongs) throw new Error("ResearchQuestion does not belong to ResearchCase");
        const lensRefs = Array.isArray(p.lensRefs) ? p.lensRefs.map(String) : [];
        if (!lensRefs.length) throw new Error("ConfirmResearchMandate requires at least one research lens");
        for (const lens of lensRefs) ontologyCatalog.getLensProfile(lens);
        const mandate = create("ResearchMandate", {
          title: p.title, research_case_ref: target.id, question_ref: question.id, lens_refs: lensRefs,
          horizon: p.horizon, comparison_basis: p.comparisonBasis, materiality_boundary: p.materialityBoundary,
          excluded_modules: Array.isArray(p.excludedModules) ? p.excludedModules : [],
          cutoff_at: now(), conditions: ["researcher_confirmed"], invalidation_conditions: ["scope_or_lens_revised"],
        });
        edits.push(linkEdit("mandateForCase", mandate, target));
        break;
      }
      case "CaptureSource": {
        const existing = this.ontology.listObjects("SourceDocument").find((item) => item.properties.uri === p.uri);
        const source = existing ? { id: existing.id, type: existing.type } : create("SourceDocument", { title: p.title, uri: p.uri, published_at: p.publishedAt, source_tier: p.sourceTier });
        const snapshot = create("SourceSnapshot", { source_ref: source.id, locator: p.locator, content_hash: p.contentHash, captured_at: p.capturedAt, access_scope: p.accessScope, quote: p.quote || "", verification_status: "unverified" });
        edits.push(linkEdit("caseCapturesSnapshot", target, snapshot), linkEdit("snapshotOfDocument", snapshot, source));
        if (existing) {
          const priorSnapshots = this.ontology.listLinksForObject(existing.id).filter((link) => link.type === "snapshotOfDocument" && link.targetRef.id === existing.id).map((link) => link.sourceRef);
          const downstreamById = new Map(priorSnapshots.flatMap((priorSnapshot) => traceReachableDownstream(this.ontology, [priorSnapshot])).map((ref) => [ref.id, ref]));
          for (const downstream of downstreamById.values()) {
            const properties = downstream.type === "Judgment"
              ? { epistemic_status: "invalidated", lifecycle_status: "review_required", invalidation_reason: "new_source_snapshot" }
              : { validity_status: "stale", invalidation_reason: "new_source_snapshot" };
            edits.push(updateEdit(downstream, properties));
            invalidatedRefs.push(downstream);
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
        if (!this.unitBelongsToCase(unit.id, target.id)) throw new Error("JudgmentUnit does not belong to ResearchCase");
        const role = String(p.role || "primary");
        if (!["primary", "alternative", "neutral"].includes(role)) throw new Error("hypothesis role must be primary, alternative, or neutral");
        const hypothesis = create("Hypothesis", { statement: p.statement, falsification_conditions: p.falsificationConditions, time_horizon: p.timeHorizon, direction: p.direction });
        edits.push(linkEdit("unitHasHypothesis", { id: unit.id, type: unit.type }, hypothesis, { role }));
        break;
      }
      case "CreateJudgmentUnit": {
        const scope = this.resolveOrCreateScope(target, p, create, edits);
        const question = this.requireObject({ id: String(p.questionRef), type: "ResearchQuestion" }, "ResearchQuestion");
        const belongs = this.ontology.listLinksForObject(target.id).some((link) => link.type === "caseAddressesQuestion" && link.sourceRef.id === target.id && link.targetRef.id === question.id);
        if (!belongs) throw new Error("ResearchQuestion does not belong to ResearchCase");
        const unit = create("JudgmentUnit", { statement: p.statement, judgment_type: p.judgmentType, scope_ref: scope.id });
        edits.push(linkEdit("caseHasJudgmentUnit", target, unit), linkEdit("unitUsesScope", unit, scope), linkEdit("questionDecomposesIntoUnit", question, unit));
        break;
      }
      case "RegisterEvidenceRequirement": {
        const role = String(p.evidenceRole);
        if (!["support", "counter", "context", "boundary"].includes(role)) throw new Error("invalid evidence role");
        const requirement = create("EvidenceRequirement", { requirement: p.requirement, evidence_role: role, minimum_independent_sources: p.minimumIndependentSources, evidence_profile_refs: p.evidenceProfileRefs || [], no_profile_reason: p.noProfileReason || "task_local" });
        edits.push(linkEdit("requirementForJudgmentUnit", requirement, target));
        break;
      }
      case "RegisterCompetingExplanation": {
        const explanation = create("CompetingExplanation", { statement: p.statement, discriminating_evidence: p.discriminatingEvidence });
        edits.push(linkEdit("competingExplanationForUnit", explanation, target));
        break;
      }
      case "RecordBlockingFactor": {
        const effect = String(p.effect);
        if (!["method_block", "direction_block", "level_cap", "scope_cap"].includes(effect)) throw new Error("invalid blocking effect");
        const factor = create("BlockingFactor", { statement: p.statement, effect });
        edits.push(linkEdit("blockingFactorForUnit", factor, target));
        break;
      }
      case "ApproveJudgment": {
        const evidenceRefs = Array.isArray(p.evidenceRefs) ? p.evidenceRefs.map(String) : [];
        const methodApplicationRefs = Array.isArray(p.methodApplicationRefs) ? p.methodApplicationRefs.map(String) : [];
        const hypothesisRefs = Array.isArray(p.hypothesisRefs) ? p.hypothesisRefs.map(String) : [];
        if (!hypothesisRefs.length) throw new Error("ApproveJudgment requires at least one existing Hypothesis reference");
        const signalInputs = (Array.isArray(p.signalInputs) ? p.signalInputs : []).map((value) => {
          if (!value || typeof value !== "object") throw new Error("signalInputs must contain structured objects");
          const item = value as Record<string, unknown>;
          const evidenceFactRef = String(item.evidenceFactRef || "");
          const statement = String(item.statement || "");
          const role = String(item.role || "");
          if (!evidenceFactRef || !statement || !["support", "weaken", "block", "context"].includes(role)) throw new Error("signalInputs require evidenceFactRef, statement and a valid role");
          return { evidenceFactRef, statement, role };
        });
        if (p.epistemicStatus === "supported" && !evidenceRefs.some((id) => this.ontology.getObject(id)?.type === "EvidenceFact" && this.ontology.getObject(id)?.properties.verification_status === "verified")) throw new Error("supported Judgment requires at least one verified EvidenceFact");
        if (p.epistemicStatus === "supported" && !methodApplicationRefs.length) throw new Error("supported Judgment requires at least one executed MethodApplication reference");
        const methodArtifact = context.taskId ? [...this.runtime.listArtifacts(context.taskId)].reverse().find((artifact) => artifact.kind === "method_application") : undefined;
        const methodApplications = methodArtifact && methodArtifact.data && typeof methodArtifact.data === "object"
          ? (methodArtifact.data as { applications?: Array<{ id?: string; executionStatus?: string; gateStatus?: string }> }).applications || []
          : [];
        if (p.epistemicStatus === "supported" && methodApplicationRefs.some((ref) => !methodApplications.some((application) => application.id === ref && application.executionStatus === "executed" && application.gateStatus === "passed"))) {
          throw new Error("supported Judgment requires MethodApplication references that are executed and gate-passed in the current Task");
        }
        if (p.epistemicStatus === "supported" && !signalInputs.some((item) => item.role === "support")) throw new Error("supported Judgment requires at least one support signal");
        if (p.epistemicStatus === "supported" && signalInputs.some((item) => item.role === "block")) throw new Error("supported Judgment cannot contain a block signal");
        if (signalInputs.some((item) => !evidenceRefs.includes(item.evidenceFactRef))) throw new Error("signalInputs must be a subset of evidenceRefs");
        const factInputs = signalInputs.map((item) => {
          const fact = this.requireObject({ id: item.evidenceFactRef, type: "EvidenceFact" }, "EvidenceFact");
          if (fact.properties.verification_status !== "verified") throw new Error("signals require verified EvidenceFact inputs");
          if (String(fact.properties.statement) !== item.statement) throw new Error("signal statement must preserve the EvidenceFact statement");
          return { item, fact };
        });
        const scope = this.requireObject({ id: String(p.scopeRef), type: "ResearchScope" }, "ResearchScope");
        const unit = this.requireObject({ id: String(p.judgmentUnitRef), type: "JudgmentUnit" }, "JudgmentUnit");
        if (!this.unitBelongsToCase(unit.id, target.id)) throw new Error("JudgmentUnit does not belong to ResearchCase");
        if (String(unit.properties.scope_ref) !== scope.id) throw new Error("JudgmentUnit scope_ref must match ApproveJudgment scopeRef");
        const hypotheses = hypothesisRefs.map((id) => {
          const hypothesis = this.requireObject({ id, type: "Hypothesis" }, "Hypothesis");
          if (!this.hypothesisBelongsToUnit(hypothesis.id, unit.id)) throw new Error(`Hypothesis ${id} does not belong to JudgmentUnit ${unit.id}`);
          return hypothesis;
        });
        const primaryHypothesis = hypotheses[0]!;
        const roleLabels: Record<string, string> = { support: "支持", weaken: "削弱", block: "阻断", context: "背景" };
        const signals = factInputs.map(({ item }) => ({
          input: item,
          ref: create("Signal", { statement: `${roleLabels[item.role]}｜${item.statement}`, role: item.role, validity_status: "current" }),
        }));
        const suppliedThreshold = p.thresholdEvaluation as { evidenceGrade?: "Q0" | "Q1" | "Q2" | "Q3" | "Q4"; counterevidenceStatus?: "cleared" | "weakened" | "contested" | "decisive" | "not_checked" | "not_applicable"; pathReadiness?: "ready" | "restricted" | "blocked" | "not_applicable" };
        if (!suppliedThreshold?.evidenceGrade || !suppliedThreshold.counterevidenceStatus || !suppliedThreshold.pathReadiness) throw new Error("ApproveJudgment requires thresholdEvaluation inputs");
        const threshold = evaluateJudgmentThreshold({ evidenceGrade: suppliedThreshold.evidenceGrade, counterevidenceStatus: suppliedThreshold.counterevidenceStatus, pathReadiness: suppliedThreshold.pathReadiness });
        if (p.judgmentLevel !== threshold.maxLevel) throw new Error(`judgmentLevel ${String(p.judgmentLevel)} exceeds or differs from policy cap ${threshold.maxLevel}`);
        if (p.epistemicStatus === "supported" && !["J2", "J3", "J4"].includes(threshold.maxLevel)) throw new Error("supported Judgment requires policy level J2 or above");
        const conditionResults = [
          { condition: "verified_evidence", expression: "all signal inputs are verified EvidenceFact", inputs: evidenceRefs, result: true, reason: "来源快照与事实晋级校验通过" },
          { condition: "executed_method_application", expression: "at least one executed MethodApplication is referenced", inputs: methodApplicationRefs, result: methodApplicationRefs.length > 0, reason: "Runtime 在批准前校验 executed/passed" },
          { condition: "support_signal_present", expression: "at least one signal has role=support", inputs: signalInputs.map((item) => item.evidenceFactRef), result: signalInputs.some((item) => item.role === "support"), reason: "研究员在判断卡中确认证据作用" },
          { condition: "no_block_signal", expression: "no signal has role=block", inputs: signalInputs.map((item) => item.evidenceFactRef), result: !signalInputs.some((item) => item.role === "block"), reason: "阻断信号会阻止 supported Judgment" },
          { condition: "judgment_level_policy_cap", expression: "judgment level equals the minimum evidence/counterevidence/path cap", inputs: [threshold.evidenceGrade, threshold.counterevidenceStatus, threshold.pathReadiness], result: p.judgmentLevel === threshold.maxLevel, reason: threshold.allowedExpression },
        ];
        const ruleEvaluation = create("RuleEvaluation", { rule_ref: threshold.policyRef, input_refs: [...evidenceRefs, ...methodApplicationRefs], condition_results: conditionResults, result: "pass", policy_projection: threshold });
        const judgment = create("Judgment", {
          statement: p.statement, level: threshold.maxLevel, confidence: p.confidence,
          epistemic_status: p.epistemicStatus, lifecycle_status: "approved", conflict_status: p.epistemicStatus === "contested" ? "unresolved" : "none",
          not_judgeable_reason: p.epistemicStatus === "indeterminate" ? "证据不足" : null, scope_ref: scope.id, cutoff_at: p.cutoffAt,
          evidence_refs: evidenceRefs, method_application_refs: methodApplicationRefs, hypothesis_refs: hypotheses.map((item) => item.id), signal_refs: signals.map((signal) => signal.ref.id),
          rule_evaluation_refs: [ruleEvaluation.id], judgment_unit_refs: [unit.id], conditions: p.conditions, invalidation_conditions: p.invalidationConditions,
        });
        const unitRef = { id: unit.id, type: unit.type };
        const scopeRef = { id: scope.id, type: scope.type };
        const hypothesisRefsForTrace = hypotheses.map((item) => ({ id: item.id, type: item.type }));
        const traceNodeRefs = [scopeRef, unitRef, ...factInputs.map(({ fact }) => ({ id: fact.id, type: fact.type })), ...signals.map((signal) => signal.ref), ...hypothesisRefsForTrace, ruleEvaluation];
        const trace = create("ReasoningTrace", { judgment_ref: judgment.id, node_refs: traceNodeRefs.map((ref) => ref.id), created_at: now() });
        edits.push(
          ...signals.flatMap((signal) => [
            linkEdit("factSupportsSignal", { id: signal.input.evidenceFactRef, type: "EvidenceFact" }, signal.ref, { role: signal.input.role }),
            linkEdit("signalEvaluatesHypothesis", signal.ref, { id: primaryHypothesis.id, type: primaryHypothesis.type }),
          ]),
          linkEdit("judgmentResolvesUnit", judgment, unitRef),
          ...hypotheses.map((hypothesis) => linkEdit("judgmentBasedOnHypothesis", judgment, { id: hypothesis.id, type: hypothesis.type })),
          linkEdit("judgmentHasRuleEvaluation", judgment, ruleEvaluation),
          linkEdit("caseProducesJudgment", target, judgment),
          linkEdit("judgmentHasReasoningTrace", judgment, trace),
          ...traceNodeRefs.map((ref, index) => linkEdit("traceIncludesNode", trace, ref, { sequence: index + 1 })),
        );
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
        const deliverable = create("ResearchDeliverable", {
          title: p.title, artifact_ref: p.artifactRef, report_kind: p.reportKind, audience: p.audience, depth: p.depth,
          report_spec_version: p.reportSpecVersion, section_keys: p.sectionKeys, lifecycle_status: "draft", published_at: null,
        });
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

  private resolveOrCreateScope(
    researchCase: OntologyObjectRef,
    parameters: Record<string, unknown>,
    create: (type: string, properties: Record<string, unknown>) => OntologyObjectRef,
    edits: OntologyEdit[],
  ): OntologyObjectRef {
    if (parameters.scopeRef) {
      const explicit = this.requireObject({ id: String(parameters.scopeRef), type: "ResearchScope" }, "ResearchScope");
      if (!this.scopeBelongsToCase(explicit.id, researchCase.id)) throw new Error("ResearchScope does not belong to ResearchCase");
      return { id: explicit.id, type: explicit.type };
    }
    const linked = this.ontology.listLinksForObject(researchCase.id).find((link) => link.type === "caseHasScope" && link.sourceRef.id === researchCase.id);
    const linkedScope = linked ? this.ontology.getObject(linked.targetRef.id) : null;
    if (linkedScope?.type === "ResearchScope") return { id: linkedScope.id, type: linkedScope.type };
    const scope = create("ResearchScope", {
      label: parameters.scopeLabel || "本轮研究范围",
      extra_dimensions: parameters.scopeDimensions || { research_case_ref: researchCase.id },
      revision_reason: "CreateJudgmentUnit 初始化正式范围",
    });
    edits.push(linkEdit("caseHasScope", researchCase, scope));
    return scope;
  }

  private scopeBelongsToCase(scopeId: string, caseId: string): boolean {
    return this.ontology.listLinksForObject(caseId).some((link) => link.type === "caseHasScope" && link.sourceRef.id === caseId && link.targetRef.id === scopeId);
  }

  private unitBelongsToCase(unitId: string, caseId: string): boolean {
    return this.ontology.listLinksForObject(caseId).some((link) => link.type === "caseHasJudgmentUnit" && link.sourceRef.id === caseId && link.targetRef.id === unitId);
  }

  private hypothesisBelongsToUnit(hypothesisId: string, unitId: string): boolean {
    return this.ontology.listLinksForObject(unitId).some((link) => link.type === "unitHasHypothesis" && link.sourceRef.id === unitId && link.targetRef.id === hypothesisId);
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
    this.runtime.knowledge.createKnowledgeLock(task.id);
    this.runtime.addTaskNodes(materializeNodes(task.id, { ...plan, intent: "update_judgment" }, task.budget));
    this.runtime.queue.enqueueTask(task.id, "execute");
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
