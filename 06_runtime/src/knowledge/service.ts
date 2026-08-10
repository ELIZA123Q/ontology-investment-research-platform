import { createHash } from "node:crypto";
import type {
  AssetCandidate,
  AssetKind,
  CandidateDecision,
  CandidateStatus,
  EvaluationSummary,
  KnowledgeMiner,
  KnowledgeMinerOutput,
  KnowledgeScope,
  Task,
} from "@/src/contracts";
import { DEFAULT_KNOWLEDGE_MINERS } from "@/src/knowledge/miners";
import { RuntimeStore } from "@/src/runtime/store";

const EXTRACTOR_VERSION = "knowledge-learning/1.0.0";
const openCandidateStatuses = new Set<CandidateStatus>(["observed", "normalized", "proposed", "evaluating", "review_required", "approved", "monitor"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function candidateScope(kind: AssetKind, task: Task, tenantId: string, userId: string): KnowledgeScope {
  if (kind === "preference" || kind === "topic_index") return { kind: "user", tenantId, userId };
  return { kind: "tenant", tenantId };
}

function requiredApprovalRoles(candidate: AssetCandidate): CandidateDecision["reviewerRole"][] {
  if (candidate.riskLevel < 2) return [];
  if (candidate.riskLevel === 2) {
    if (["method", "prompt", "template", "skill"].includes(candidate.assetKind)) return ["method_owner"];
    if (["temporal_fact", "source_profile", "data_mapping"].includes(candidate.assetKind)) return ["ontology_steward"];
    return ["governance_owner"];
  }
  if (candidate.assetKind === "ontology") return ["ontology_steward", "runtime_owner", "independent_reviewer"];
  if (candidate.assetKind === "skill") return ["method_owner", "runtime_owner", "independent_reviewer"];
  return ["governance_owner", "runtime_owner", "independent_reviewer"];
}

export class KnowledgeLearningService {
  constructor(readonly store: RuntimeStore, readonly miners: readonly KnowledgeMiner[] = DEFAULT_KNOWLEDGE_MINERS) {}

  runMining(taskId: string): ReturnType<RuntimeStore["getMiningRunByTask"]> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!["completed", "failed", "cancelled"].includes(task.status)) throw new Error("Knowledge mining only runs for terminal tasks");
    const conversation = this.store.getConversation(task.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${task.conversationId}`);
    let miningRun = this.store.createMiningRun(taskId, EXTRACTOR_VERSION);
    if (miningRun.status === "completed") return miningRun;
    const lock = this.store.getKnowledgeLock(taskId);
    if (!lock) throw new Error("Knowledge lock is missing");
    miningRun = this.store.updateMiningRun(miningRun.id, { status: "running", error: undefined, startedAt: new Date().toISOString() });
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "knowledge.mining.started", actorType: "system", actorId: "knowledge-learning", payload: { miningRunId: miningRun.id, extractorVersion: EXTRACTOR_VERSION } });
    try {
      const events = this.store.listEvents(task.conversationId, 0, 10_000).filter((event) => event.taskId === taskId);
      const context = { task, conversation, artifacts: this.store.listArtifacts(taskId), events, knowledgeLock: lock };
      let observations = 0;
      for (const miner of this.miners) {
        for (const output of miner.mine(context)) {
          observations += 1;
          this.ingestOutput(miningRun.id, task, conversation.tenantId, conversation.userId, output);
        }
      }
      miningRun = this.store.updateMiningRun(miningRun.id, { status: "completed", candidateCount: observations, completedAt: new Date().toISOString() });
      this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "knowledge.mining.completed", actorType: "system", actorId: "knowledge-learning", payload: { miningRunId: miningRun.id, candidateCount: observations } });
      return miningRun;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateMiningRun(miningRun.id, { status: "failed", error: message, completedAt: new Date().toISOString() });
      this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "knowledge.mining.failed", actorType: "system", actorId: "knowledge-learning", payload: { miningRunId: miningRun.id, error: message } });
      throw error;
    }
  }

  private ingestOutput(miningRunId: string, task: Task, tenantId: string, userId: string, output: KnowledgeMinerOutput): AssetCandidate | null {
    if (!output.provenanceRefs.length) return null;
    const scope = candidateScope(output.assetKind, task, tenantId, userId);
    const existingOpen = this.store.findCandidatesByIdentity(output.identityKey, output.assetKind).find((item) => openCandidateStatuses.has(item.status) && this.store.scopeKey(item.scope) === this.store.scopeKey(scope));
    if (existingOpen) {
      this.store.putCandidateOccurrence({ candidateId: existingOpen.id, taskId: task.id });
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "candidate.observed", actorType: "system", actorId: "knowledge-learning", payload: { candidateId: existingOpen.id, identityKey: output.identityKey } });
      return existingOpen;
    }
    const target = this.store.getReleasedAssetByIdentity(output.identityKey, output.assetKind, scope);
    const assetId = target?.assetId || `asset:${this.store.scopeKey(scope)}:${output.assetKind}:${hash(output.identityKey)}`;
    const content = { ...output.content, identityKey: output.identityKey, minerVersion: EXTRACTOR_VERSION };
    const targetRevision = target ? this.store.getAssetRevisionByRef(target) : null;
    const exactDuplicate = Boolean(targetRevision && JSON.stringify(targetRevision.content) === JSON.stringify(content));
    const operation = exactDuplicate ? "no_op" : (output.suggestedOperation || (target ? "modify" : "add"));
    const revision = exactDuplicate && targetRevision ? targetRevision : this.store.putAssetRevision({
      assetId, kind: output.assetKind, scope, status: "candidate", content,
      provenanceRefs: output.provenanceRefs, validFrom: output.validFrom, validTo: output.validTo,
      supersedes: targetRevision ? [targetRevision.id] : [],
    });
    const currentBaselineFingerprint = this.store.currentBaselineFingerprint(scope);
    let candidate = this.store.putCandidate({
      miningRunId, taskId: task.id, scope, assetKind: output.assetKind, operation, identityKey: output.identityKey,
      targetAssetRef: target || undefined, proposedRevisionId: revision.id, provenanceRefs: output.provenanceRefs,
      runBaselineFingerprint: this.store.getKnowledgeLock(task.id)?.fingerprint || "",
      currentBaselineFingerprint, riskLevel: operation === "no_op" ? 0 : output.riskLevel,
      confidence: Math.max(0, Math.min(1, output.confidence)), novelty: target ? (operation === "no_op" ? 0 : 0.5) : 1,
      conflicts: [], status: operation === "no_op" ? "released" : "proposed",
    });
    this.store.putCandidateOccurrence({ candidateId: candidate.id, taskId: task.id });
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "candidate.created", actorType: "system", actorId: "knowledge-learning", payload: { candidateId: candidate.id, assetKind: candidate.assetKind, operation: candidate.operation, riskLevel: candidate.riskLevel } });
    if (candidate.assetKind === "eval_case") this.createEvaluationCase(candidate, task);
    if (candidate.riskLevel === 1) candidate = this.autoReleaseLowRisk(candidate, task);
    return candidate;
  }

  private createEvaluationCase(candidate: AssetCandidate, task: Task): void {
    const revision = this.store.getAssetRevision(candidate.proposedRevisionId);
    const content = asRecord(revision?.content);
    this.store.putEvaluationCase({
      scope: candidate.scope, sourceTaskId: task.id, name: String(content.name || `Replay ${candidate.id}`),
      inputSnapshot: { goal: content.goal || task.goal, intent: task.intent, sourceTaskId: task.id },
      assertions: [{ metric: "severe_regressions", operator: "eq", expected: 0 }], status: "candidate",
      deidentified: Boolean(content.deidentified),
    });
  }

  private autoReleaseLowRisk(candidate: AssetCandidate, task: Task): AssetCandidate {
    const approved = this.store.updateCandidate(candidate.id, { status: "approved", decisionNote: "L1 reversible scope-local auto approval", reviewedBy: "knowledge-learning" });
    const release = this.store.publishRelease({ scope: approved.scope, candidateIds: [approved.id], createdBy: "knowledge-learning" });
    if (approved.assetKind === "topic_index" || approved.assetKind === "preference") {
      const revision = this.store.getAssetRevision(approved.proposedRevisionId);
      this.store.putMemory({ conversationId: task.conversationId, kind: approved.assetKind, content: JSON.stringify(revision?.content || {}), provenanceArtifactIds: approved.provenanceRefs.filter((ref) => ref.startsWith("artifact:")).map((ref) => ref.slice("artifact:".length).split("@")[0]) });
    }
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "knowledge.release.published", actorType: "system", actorId: "knowledge-learning", payload: { releaseId: release.id, scope: release.scope, candidateIds: [approved.id], automatic: true } });
    return this.store.getCandidate(candidate.id)!;
  }

  evaluateCandidate(candidateId: string): AssetCandidate {
    let candidate = this.rebaseCandidate(candidateId);
    if (candidate.conflicts.length) throw new Error("Candidate has unresolved rebase conflicts");
    if (!["proposed", "review_required"].includes(candidate.status)) throw new Error(`Candidate cannot be evaluated from ${candidate.status}`);
    candidate = this.store.updateCandidate(candidate.id, { status: "evaluating" });
    const revision = this.store.getAssetRevision(candidate.proposedRevisionId);
    if (!revision) throw new Error("Candidate revision is missing");
    const occurrences = this.store.listCandidateOccurrences(candidate.id);
    const taskIds = new Set([candidate.taskId, ...occurrences.map((item) => item.taskId)]);
    const tasks = [...taskIds].map((id) => this.store.getTask(id)).filter(Boolean) as Task[];
    const taskFamilies = new Set(tasks.map((task) => task.intent));
    const content = asRecord(revision.content);
    const provenanceComplete = candidate.provenanceRefs.length > 0;
    let requiredRuns = 1;
    let requiredFamilies = 1;
    let requiredDelta = 0;
    if (["method", "prompt", "template"].includes(candidate.assetKind)) { requiredRuns = 3; requiredFamilies = 2; requiredDelta = 0.05; }
    if (candidate.assetKind === "skill") { requiredRuns = 5; requiredFamilies = 3; requiredDelta = 0.05; }
    const ontologyChecks = candidate.assetKind !== "ontology" || (content.compatibilityCheckPassed === true && content.impactReplayPassed === true);
    if (candidate.assetKind === "ontology") requiredRuns = content.stewardInitiated === true ? 1 : 2;
    const scoreDelta = Number(content.evaluationScoreDelta || (candidate.assetKind === "failure_pattern" || candidate.assetKind === "eval_case" ? 0.05 : 0));
    const evalCaseValid = candidate.assetKind !== "eval_case" || (content.deidentified === true && content.replayable === true);
    const sourceQualifications = Array.isArray(content.sourceQualifications) ? content.sourceQualifications.map(asRecord) : [];
    const primaryCount = sourceQualifications.filter((item) => item.sourceType === "primary").length;
    const secondaryPublishers = new Set(sourceQualifications.filter((item) => item.sourceType === "secondary").map((item) => String(item.publisherId || "")).filter(Boolean));
    const temporalValid = candidate.assetKind !== "temporal_fact" || (
      Array.isArray(content.sourceRefs) && content.sourceRefs.length >= 1 && Boolean(content.recordedAt) &&
      Boolean(content.applicabilityScope) && (primaryCount >= 1 || secondaryPublishers.size >= 2)
    );
    const skillContractValid = candidate.assetKind !== "skill" || (
      Boolean(content.typedIO) && Array.isArray(content.permissions) && Array.isArray(content.failureStates) &&
      Boolean(content.version) && Number(content.costBudget) > 0 && Number(content.latencyBudgetMs) > 0
    );
    const severeRegressions = Number(content.severeRegressions || 0);
    const passed = provenanceComplete && taskIds.size >= requiredRuns && taskFamilies.size >= requiredFamilies &&
      scoreDelta >= requiredDelta && severeRegressions === 0 && evalCaseValid && temporalValid && skillContractValid && ontologyChecks;
    const summary: EvaluationSummary = {
      passed, scoreDelta, severeRegressions,
      metrics: {
        provenance_complete: provenanceComplete ? 1 : 0, distinct_runs: taskIds.size, task_families: taskFamilies.size,
        eval_case_valid: evalCaseValid ? 1 : 0, temporal_valid: temporalValid ? 1 : 0,
        skill_contract_valid: skillContractValid ? 1 : 0, ontology_checks: ontologyChecks ? 1 : 0,
      },
    };
    const baselineReleaseId = this.store.getCurrentRelease(candidate.scope)?.id || this.store.getKnowledgeLock(candidate.taskId)?.globalReleaseId || "bootstrap";
    const cases = this.store.listEvaluationCases(candidate.scope).filter((item) => item.status !== "retired");
    this.store.putEvaluationRun({ candidateId: candidate.id, status: passed ? "passed" : "failed", caseIds: cases.map((item) => item.id), baselineReleaseId, summary, completedAt: new Date().toISOString() });
    candidate = this.store.updateCandidate(candidate.id, { status: "review_required", evaluationSummary: summary });
    const task = this.store.getTask(candidate.taskId)!;
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "candidate.evaluated", actorType: "system", actorId: "knowledge-learning", payload: { candidateId, summary } });
    return candidate;
  }

  decideCandidate(input: { candidateId: string; decision: "approved" | "rejected"; reviewer: string; reviewerRole: CandidateDecision["reviewerRole"]; note: string }): AssetCandidate {
    let candidate = this.rebaseCandidate(input.candidateId);
    if (candidate.conflicts.length) throw new Error("Candidate has unresolved rebase conflicts");
    if (candidate.riskLevel >= 2 && !candidate.evaluationSummary?.passed && input.decision === "approved") throw new Error("Candidate must pass evaluation before approval");
    if (!input.reviewer.trim() || input.note.trim().length < 8) throw new Error("Review decision requires reviewer and a meaningful note");
    const required = requiredApprovalRoles(candidate);
    if (!required.includes(input.reviewerRole) && input.decision === "approved") throw new Error(`Reviewer role is not required for this candidate: ${input.reviewerRole}`);
    this.store.putCandidateDecision({ candidateId: candidate.id, reviewer: input.reviewer.trim(), reviewerRole: input.reviewerRole, decision: input.decision, note: input.note.trim() });
    const decisions = this.store.listCandidateDecisions(candidate.id);
    if (decisions.some((item) => item.decision === "rejected")) {
      candidate = this.store.updateCandidate(candidate.id, { status: "rejected", decisionNote: input.note, reviewedBy: input.reviewer });
    } else if (required.every((role) => decisions.some((item) => item.reviewerRole === role && item.decision === "approved"))) {
      candidate = this.store.updateCandidate(candidate.id, { status: "approved", decisionNote: input.note, reviewedBy: decisions.map((item) => `${item.reviewerRole}:${item.reviewer}`).join(",") });
    }
    const task = this.store.getTask(candidate.taskId)!;
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: candidate.status === "rejected" ? "candidate.rejected" : "candidate.approval_recorded", actorType: "system", actorId: input.reviewer, payload: { candidateId: candidate.id, status: candidate.status, reviewerRole: input.reviewerRole } });
    return candidate;
  }

  publishCandidates(candidateIds: string[], createdBy: string): ReturnType<RuntimeStore["publishRelease"]> {
    if (!candidateIds.length) throw new Error("At least one candidate is required");
    const candidates = candidateIds.map((id) => this.rebaseCandidate(id));
    const scopeKey = this.store.scopeKey(candidates[0].scope);
    if (candidates.some((item) => this.store.scopeKey(item.scope) !== scopeKey)) throw new Error("A release cannot mix knowledge scopes");
    const release = this.store.publishRelease({ scope: candidates[0].scope, candidateIds, createdBy });
    const task = this.store.getTask(candidates[0].taskId)!;
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "knowledge.release.published", actorType: "system", actorId: createdBy, payload: { releaseId: release.id, scope: release.scope, candidateIds } });
    this.store.enqueueTask(task.id, "rebuild_knowledge_index");
    return release;
  }

  publishApprovedForTask(taskId: string, createdBy = "knowledge-learning"): ReturnType<RuntimeStore["publishRelease"]>[] {
    const approved = this.store.listCandidates({ taskId }).filter((item) => item.status === "approved");
    const groups = new Map<string, AssetCandidate[]>();
    for (const candidate of approved) groups.set(this.store.scopeKey(candidate.scope), [...(groups.get(this.store.scopeKey(candidate.scope)) || []), candidate]);
    return [...groups.values()].map((items) => this.publishCandidates(items.map((item) => item.id), createdBy));
  }

  evaluateCandidatesForTask(taskId: string): AssetCandidate[] {
    return this.store.listCandidates({ taskId }).filter((item) => item.status === "proposed" || item.status === "review_required").map((item) => this.evaluateCandidate(item.id));
  }

  retryMining(taskId: string): string {
    const run = this.store.getMiningRunByTask(taskId);
    if (run?.status === "running") throw new Error("Mining is already running");
    if (run) this.store.updateMiningRun(run.id, { status: "queued", error: undefined, completedAt: undefined });
    return this.store.enqueueTask(taskId, "mine_assets");
  }

  rebuildKnowledgeIndex(): number {
    try {
      this.store.db.prepare("DELETE FROM research_fts WHERE kind='knowledge_asset'").run();
      let indexed = 0;
      for (const release of this.store.listReleases().filter((item) => item.status === "current")) {
        for (const ref of release.assetRefs) {
          const revision = this.store.db.prepare("SELECT content_json FROM asset_revisions WHERE asset_id=? AND version=?").get(ref.assetId, ref.version) as { content_json?: string } | undefined;
          if (!revision?.content_json) continue;
          this.store.db.prepare("INSERT INTO research_fts (ref_id,kind,title,body) VALUES (?, 'knowledge_asset', ?, ?)")
            .run(`${ref.assetId}@${ref.version}`, ref.assetId, revision.content_json);
          indexed += 1;
        }
      }
      return indexed;
    } catch {
      return 0;
    }
  }

  private rebaseCandidate(candidateId: string): AssetCandidate {
    const candidate = this.store.getCandidate(candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    const currentFingerprint = this.store.currentBaselineFingerprint(candidate.scope);
    if (currentFingerprint === candidate.currentBaselineFingerprint) return candidate;
    const currentTarget = this.store.getReleasedAssetByIdentity(candidate.identityKey, candidate.assetKind, candidate.scope);
    if (!candidate.targetAssetRef && !currentTarget) return this.store.updateCandidate(candidate.id, { currentBaselineFingerprint: currentFingerprint, conflicts: [] });
    if (candidate.targetAssetRef && currentTarget?.fingerprint === candidate.targetAssetRef.fingerprint) return this.store.updateCandidate(candidate.id, { currentBaselineFingerprint: currentFingerprint, targetAssetRef: currentTarget, conflicts: [] });
    if (!candidate.targetAssetRef && currentTarget) return this.store.updateCandidate(candidate.id, { currentBaselineFingerprint: currentFingerprint, targetAssetRef: currentTarget, operation: "modify", conflicts: [`identity ${candidate.identityKey} was released after this proposal was created`] });
    return this.store.updateCandidate(candidate.id, { currentBaselineFingerprint: currentFingerprint, conflicts: [`target asset changed after proposal baseline ${candidate.currentBaselineFingerprint}`] });
  }
}
