import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AssetCandidate, AssetKind, AssetRef, AssetRelease, AssetRevision, CandidateDecision,
  CandidateOccurrence, CandidateStatus, EvaluationCase, EvaluationRun, EvaluationSummary,
  KnowledgeLock, KnowledgeScope, MiningRun, ResearchEvaluationRun, UsageObservation,
} from "@/src/contracts/knowledge";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => typeof value === "string" && value.length ? JSON.parse(value) as T : fallback;
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(json(value)).digest("hex")}`;
const GLOBAL_AUTHORITY_REFS: AssetRef[] = [
  ["semantic", "ontology", "01_semantic_knowledge/registry.yaml"],
  ["tasks", "workflow", "02_scenario_task/registry.yaml"],
  ["capabilities", "method", "03_agent_capability/registry.yaml"],
  ["execution", "case", "04_context_state/registry.yaml"],
  ["governance", "rule", "05_control_evaluation/registry.yaml"],
].map(([domain, kind, authorityRef]) => ({
  assetId: `authority:${domain}`, kind: kind as AssetKind, identityKey: `authority:${domain}`,
  scope: { kind: "global" }, version: 1, fingerprint: fingerprint({ authorityRef, version: 1 }), authorityRef,
}));

export interface KnowledgeRepositoryHooks {
  transaction<T>(work: () => T): T;
  task(id: string): { id: string; conversationId: string; createdAt: string } | null;
  conversation(id: string): { tenantId: string; userId: string } | null;
  append(event: { conversationId: string; taskId: string; type: string; actorType: "system" | "researcher"; actorId: string; payload: Record<string, unknown> }): void;
}

export class SqliteKnowledgeRepository {
  constructor(readonly db: DatabaseSync, private readonly hooks: KnowledgeRepositoryHooks) {}

  rebuildSearchIndex(): number {
    try {
      this.db.prepare("DELETE FROM research_fts WHERE kind='knowledge_asset'").run();
      let indexed = 0;
      for (const release of this.listReleases().filter((item) => item.status === "current")) {
        for (const ref of release.assetRefs) {
          const revision = this.db.prepare("SELECT content_json FROM asset_revisions WHERE asset_id=? AND version=?")
            .get(ref.assetId, ref.version) as { content_json?: string } | undefined;
          if (!revision?.content_json) continue;
          this.db.prepare("INSERT INTO research_fts (ref_id,kind,title,body) VALUES (?, 'knowledge_asset', ?, ?)")
            .run(`${ref.assetId}@${ref.version}`, ref.assetId, revision.content_json);
          indexed += 1;
        }
      }
      return indexed;
    } catch {
      return 0;
    }
  }

  scopeKey(scope: KnowledgeScope): string {
    if (scope.kind === "global") return "global";
    if (scope.kind === "tenant") return `tenant:${scope.tenantId}`;
    return `user:${scope.tenantId}:${scope.userId}`;
  }

  getCurrentRelease(scope: KnowledgeScope): AssetRelease | null {
    const row = this.db.prepare("SELECT * FROM asset_releases WHERE scope_key=? AND status='current' ORDER BY created_at DESC LIMIT 1")
      .get(this.scopeKey(scope)) as Record<string, unknown> | undefined;
    return row ? this.mapRelease(row) : null;
  }

  getRelease(id: string): AssetRelease | null {
    const row = this.db.prepare("SELECT * FROM asset_releases WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRelease(row) : null;
  }

  listReleases(scope?: KnowledgeScope): AssetRelease[] {
    const rows = scope
      ? this.db.prepare("SELECT * FROM asset_releases WHERE scope_key=? ORDER BY created_at DESC").all(this.scopeKey(scope))
      : this.db.prepare("SELECT * FROM asset_releases ORDER BY created_at DESC").all();
    return (rows as Record<string, unknown>[]).map(this.mapRelease);
  }

  listReleasedAssetRefs(identity: { tenantId: string; userId: string }): AssetRef[] {
    const global = this.getCurrentRelease({ kind: "global" })?.assetRefs || [];
    const tenant = this.getCurrentRelease({ kind: "tenant", tenantId: identity.tenantId })?.assetRefs || [];
    const user = this.getCurrentRelease({ kind: "user", tenantId: identity.tenantId, userId: identity.userId })?.assetRefs || [];
    return this.mergeAssetRefs(this.mergeAssetRefs(global, tenant), user);
  }

  listReleasedAssetRevisions(identity: { tenantId: string; userId: string }): AssetRevision[] {
    return this.listReleasedAssetRefs(identity)
      .map((ref) => this.getAssetRevisionByRef(ref))
      .filter((revision): revision is AssetRevision => revision !== null && revision.status === "released");
  }

  createKnowledgeLock(taskId: string, requestedAsOf?: string): KnowledgeLock {
    const existing = this.getKnowledgeLock(taskId);
    if (existing) return existing;
    const task = this.hooks.task(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const conversation = this.hooks.conversation(task.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${task.conversationId}`);
    const tenantScope: KnowledgeScope = { kind: "tenant", tenantId: conversation.tenantId };
    const userScope: KnowledgeScope = { kind: "user", tenantId: conversation.tenantId, userId: conversation.userId };
    const globalRelease = this.getCurrentRelease({ kind: "global" });
    if (!globalRelease) throw new Error("Global knowledge baseline is missing");
    const tenantRelease = this.getCurrentRelease(tenantScope);
    const userRelease = this.getCurrentRelease(userScope);
    const asOf = requestedAsOf || task.createdAt;
    if (!Number.isFinite(Date.parse(asOf))) throw new Error(`Invalid knowledge asOf: ${asOf}`);
    const mergedRefs = this.mergeAssetRefs(this.mergeAssetRefs(globalRelease.assetRefs, tenantRelease?.assetRefs || []), userRelease?.assetRefs || []);
    const refs = mergedRefs.filter((ref) => this.isAssetRefActive(ref, asOf));
    const memoryRow = this.db.prepare("SELECT COUNT(*) count FROM memory_records WHERE conversation_id=? OR conversation_id IS NULL")
      .get(task.conversationId) as { count: number };
    const lockInput = {
      taskId, scope: userScope, globalReleaseId: globalRelease.id, tenantReleaseId: tenantRelease?.id,
      userReleaseId: userRelease?.id, userMemoryVersion: Number(memoryRow.count), asOf, assetRefs: refs,
    };
    const item: KnowledgeLock = { id: randomUUID(), ...lockInput, fingerprint: fingerprint(lockInput), createdAt: now() };
    this.db.prepare(`INSERT INTO knowledge_locks
      (id,task_id,scope_json,global_release_id,tenant_release_id,user_release_id,user_memory_version,as_of,asset_refs_json,fingerprint,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.taskId, json(item.scope), item.globalReleaseId, item.tenantReleaseId ?? null,
        item.userReleaseId ?? null, item.userMemoryVersion ?? null, item.asOf, json(item.assetRefs), item.fingerprint, item.createdAt);
    for (const ref of item.assetRefs) this.observeAssetUsage({ taskId, assetRef: ref, selectedReason: "knowledge_lock", outcome: "selected" });
    return item;
  }

  getKnowledgeLock(taskId: string): KnowledgeLock | null {
    const row = this.db.prepare("SELECT * FROM knowledge_locks WHERE task_id=?").get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapKnowledgeLock(row) : null;
  }

  createMiningRun(taskId: string, extractorVersion: string): MiningRun {
    const existing = this.getMiningRunByTask(taskId);
    if (existing) return existing;
    const lock = this.createKnowledgeLock(taskId);
    const item: MiningRun = {
      id: randomUUID(), taskId, status: "queued", extractorVersion,
      knowledgeLockId: lock.id, candidateCount: 0, createdAt: now(),
    };
    this.db.prepare("INSERT INTO mining_runs VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)")
      .run(item.id, item.taskId, item.status, item.extractorVersion, item.knowledgeLockId, item.createdAt);
    return item;
  }

  getMiningRunByTask(taskId: string): MiningRun | null {
    const row = this.db.prepare("SELECT * FROM mining_runs WHERE task_id=?").get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapMiningRun(row) : null;
  }

  updateMiningRun(id: string, patch: Partial<Pick<MiningRun, "status" | "candidateCount" | "error" | "startedAt" | "completedAt">>): MiningRun {
    const row = this.db.prepare("SELECT * FROM mining_runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Mining run not found: ${id}`);
    const current = this.mapMiningRun(row);
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE mining_runs SET status=?, candidate_count=?, error=?, started_at=?, completed_at=? WHERE id=?")
      .run(next.status, next.candidateCount, next.error ?? null, next.startedAt ?? null, next.completedAt ?? null, id);
    return next;
  }

  putAssetRevision(input: Omit<AssetRevision, "id" | "version" | "fingerprint" | "createdAt"> & { id?: string }): AssetRevision {
    const prior = this.db.prepare("SELECT MAX(version) version FROM asset_revisions WHERE asset_id=?").get(input.assetId) as { version?: number | null };
    const version = Number(prior.version || 0) + 1;
    const value = { assetId: input.assetId, kind: input.kind, scope: input.scope, content: input.content, contentRef: input.contentRef, validFrom: input.validFrom, validTo: input.validTo, supersedes: input.supersedes };
    const item: AssetRevision = { ...input, id: input.id || randomUUID(), version, fingerprint: fingerprint(value), createdAt: now() };
    this.db.prepare("INSERT INTO asset_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.assetId, item.kind, json(item.scope), item.version, item.status, json(item.content), item.contentRef ?? null,
        item.fingerprint, json(item.provenanceRefs), item.validFrom ?? null, item.validTo ?? null, json(item.supersedes), item.createdAt);
    return item;
  }

  getAssetRevision(id: string): AssetRevision | null {
    const row = this.db.prepare("SELECT * FROM asset_revisions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRevision(row) : null;
  }

  getAssetRevisionByRef(ref: AssetRef): AssetRevision | null {
    const row = this.db.prepare("SELECT * FROM asset_revisions WHERE asset_id=? AND version=?")
      .get(ref.assetId, ref.version) as Record<string, unknown> | undefined;
    return row ? this.mapRevision(row) : null;
  }

  getReleasedAssetByIdentity(identityKey: string, kind: AssetKind, scope: KnowledgeScope): AssetRef | null {
    const release = this.getCurrentRelease(scope);
    if (!release) return null;
    for (const ref of release.assetRefs) {
      if (ref.kind !== kind) continue;
      if (ref.identityKey === identityKey) return ref;
      const row = this.db.prepare("SELECT content_json FROM asset_revisions WHERE asset_id=? AND version=?")
        .get(ref.assetId, ref.version) as { content_json?: string } | undefined;
      const content = parse<Record<string, unknown>>(row?.content_json, {});
      if (String(content.identityKey || "") === identityKey) return ref;
    }
    return null;
  }

  putCandidate(input: Omit<AssetCandidate, "id" | "createdAt" | "updatedAt"> & { id?: string }): AssetCandidate {
    const stamp = now();
    const item: AssetCandidate = { ...input, id: input.id || randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.prepare(`INSERT INTO asset_candidates (
      id,mining_run_id,task_id,scope_json,asset_kind,operation,identity_key,target_asset_ref_json,proposed_revision_id,
      provenance_refs_json,run_baseline_fingerprint,current_baseline_fingerprint,risk_level,confidence,novelty,
      conflicts_json,status,evaluation_summary_json,decision_note,reviewed_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.id, item.miningRunId, item.taskId, json(item.scope), item.assetKind, item.operation, item.identityKey,
        item.targetAssetRef ? json(item.targetAssetRef) : null, item.proposedRevisionId, json(item.provenanceRefs),
        item.runBaselineFingerprint, item.currentBaselineFingerprint, item.riskLevel, item.confidence, item.novelty,
        json(item.conflicts), item.status, item.evaluationSummary ? json(item.evaluationSummary) : null,
        item.decisionNote ?? null, item.reviewedBy ?? null, item.createdAt, item.updatedAt);
    return item;
  }

  getCandidate(id: string): AssetCandidate | null {
    const row = this.db.prepare("SELECT * FROM asset_candidates WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCandidate(row) : null;
  }

  listCandidates(filters: { status?: CandidateStatus; scope?: KnowledgeScope; taskId?: string } = {}): AssetCandidate[] {
    const clauses: string[] = [];
    const args: string[] = [];
    if (filters.status) { clauses.push("status=?"); args.push(filters.status); }
    if (filters.scope) { clauses.push("scope_json=?"); args.push(json(filters.scope)); }
    if (filters.taskId) { clauses.push("task_id=?"); args.push(filters.taskId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`SELECT * FROM asset_candidates ${where} ORDER BY updated_at DESC`).all(...args) as Record<string, unknown>[]).map(this.mapCandidate);
  }

  findCandidatesByIdentity(identityKey: string, kind: AssetKind): AssetCandidate[] {
    return (this.db.prepare("SELECT * FROM asset_candidates WHERE identity_key=? AND asset_kind=? ORDER BY updated_at DESC")
      .all(identityKey, kind) as Record<string, unknown>[]).map(this.mapCandidate);
  }

  updateCandidate(id: string, patch: Partial<Pick<AssetCandidate, "status" | "operation" | "targetAssetRef" | "currentBaselineFingerprint" | "conflicts" | "evaluationSummary" | "decisionNote" | "reviewedBy">>): AssetCandidate {
    const current = this.getCandidate(id);
    if (!current) throw new Error(`Candidate not found: ${id}`);
    if (patch.status && patch.status !== current.status) {
      const allowed: Record<CandidateStatus, CandidateStatus[]> = {
        observed: ["normalized", "rejected"], normalized: ["proposed", "rejected"],
        proposed: ["evaluating", "monitor", "rejected", ...(current.riskLevel <= 1 ? ["approved" as CandidateStatus] : [])],
        evaluating: ["review_required", "rejected"], review_required: ["approved", "rejected", "monitor"],
        approved: ["released", "superseded"], released: ["superseded"], rejected: [], superseded: [],
        monitor: ["proposed", "rejected"],
      };
      if (!allowed[current.status].includes(patch.status)) throw new Error(`Illegal candidate transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE asset_candidates SET status=?,operation=?,target_asset_ref_json=?,current_baseline_fingerprint=?,conflicts_json=?,
      evaluation_summary_json=?,decision_note=?,reviewed_by=?,updated_at=? WHERE id=?`)
      .run(next.status, next.operation, next.targetAssetRef ? json(next.targetAssetRef) : null, next.currentBaselineFingerprint, json(next.conflicts),
        next.evaluationSummary ? json(next.evaluationSummary) : null, next.decisionNote ?? null,
        next.reviewedBy ?? null, next.updatedAt, id);
    return next;
  }

  putCandidateOccurrence(input: Omit<CandidateOccurrence, "id" | "observedAt">): CandidateOccurrence {
    const existing = this.db.prepare(`SELECT * FROM candidate_occurrences
      WHERE candidate_id=? AND task_id=? AND artifact_id IS ? ORDER BY observed_at LIMIT 1`)
      .get(input.candidateId, input.taskId, input.artifactId ?? null) as Record<string, unknown> | undefined;
    if (existing) return {
      id: String(existing.id), candidateId: String(existing.candidate_id), taskId: String(existing.task_id),
      artifactId: existing.artifact_id ? String(existing.artifact_id) : undefined,
      eventSequence: existing.event_sequence == null ? undefined : Number(existing.event_sequence),
      observedAt: String(existing.observed_at),
    };
    const item: CandidateOccurrence = { ...input, id: randomUUID(), observedAt: now() };
    this.db.prepare("INSERT INTO candidate_occurrences VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.taskId, item.artifactId ?? null, item.eventSequence ?? null, item.observedAt);
    return item;
  }

  listCandidateOccurrences(candidateId: string): CandidateOccurrence[] {
    return (this.db.prepare("SELECT * FROM candidate_occurrences WHERE candidate_id=? ORDER BY observed_at").all(candidateId) as Record<string, unknown>[])
      .map((r) => ({ id: String(r.id), candidateId: String(r.candidate_id), taskId: String(r.task_id), artifactId: r.artifact_id ? String(r.artifact_id) : undefined, eventSequence: r.event_sequence == null ? undefined : Number(r.event_sequence), observedAt: String(r.observed_at) }));
  }

  putCandidateDecision(input: Omit<CandidateDecision, "id" | "createdAt">): CandidateDecision {
    const item: CandidateDecision = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO candidate_decisions VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.reviewer, item.reviewerRole, item.decision, item.note, item.createdAt);
    return item;
  }

  listCandidateDecisions(candidateId: string): CandidateDecision[] {
    return (this.db.prepare("SELECT * FROM candidate_decisions WHERE candidate_id=? ORDER BY created_at").all(candidateId) as Record<string, unknown>[])
      .map((r) => ({ id: String(r.id), candidateId: String(r.candidate_id), reviewer: String(r.reviewer), reviewerRole: r.reviewer_role as CandidateDecision["reviewerRole"], decision: r.decision as CandidateDecision["decision"], note: String(r.note), createdAt: String(r.created_at) }));
  }

  putEvaluationCase(input: Omit<EvaluationCase, "id" | "createdAt">): EvaluationCase {
    const item: EvaluationCase = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO evaluation_cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, json(item.scope), item.sourceTaskId, item.name, json(item.inputSnapshot), json(item.assertions), item.status, item.deidentified ? 1 : 0, item.createdAt);
    return item;
  }

  listEvaluationCases(scope?: KnowledgeScope): EvaluationCase[] {
    const rows = scope
      ? this.db.prepare("SELECT * FROM evaluation_cases WHERE scope_json=? ORDER BY created_at").all(json(scope))
      : this.db.prepare("SELECT * FROM evaluation_cases ORDER BY created_at").all();
    return (rows as Record<string, unknown>[]).map(this.mapEvaluationCase);
  }

  putEvaluationRun(input: Omit<EvaluationRun, "id" | "createdAt">): EvaluationRun {
    const item: EvaluationRun = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO evaluation_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.status, json(item.caseIds), item.baselineReleaseId, json(item.summary), item.createdAt, item.completedAt ?? null);
    return item;
  }

  listEvaluationRuns(candidateId: string): EvaluationRun[] {
    return (this.db.prepare("SELECT * FROM evaluation_runs WHERE candidate_id=? ORDER BY created_at DESC").all(candidateId) as Record<string, unknown>[]).map(this.mapEvaluationRun);
  }

  putResearchEvaluationRun(input: Omit<ResearchEvaluationRun, "id" | "createdAt"> & { id?: string; createdAt?: string }): ResearchEvaluationRun {
    const item: ResearchEvaluationRun = { ...input, id: input.id || randomUUID(), createdAt: input.createdAt || now() };
    this.db.prepare(`INSERT INTO research_evaluation_runs (
      id,case_id,protocol_version,status,task_input_hash,evidence_bundle_hash,system_artifact_json,
      baseline_artifacts_json,judge_versions_json,formal_score_eligible,metrics_json,notes_json,created_at,completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.caseId, item.protocolVersion, item.status, item.taskInputHash, item.evidenceBundleHash,
        json(item.systemArtifact), json(item.baselineArtifacts), json(item.judgeVersions), item.formalScoreEligible ? 1 : 0,
        json(item.metrics), json(item.notes), item.createdAt, item.completedAt ?? null);
    return item;
  }

  listResearchEvaluationRuns(caseId?: string): ResearchEvaluationRun[] {
    const rows = caseId
      ? this.db.prepare("SELECT * FROM research_evaluation_runs WHERE case_id=? ORDER BY created_at DESC").all(caseId)
      : this.db.prepare("SELECT * FROM research_evaluation_runs ORDER BY created_at DESC").all();
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), caseId: String(row.case_id), protocolVersion: String(row.protocol_version), status: row.status as ResearchEvaluationRun["status"],
      taskInputHash: String(row.task_input_hash), evidenceBundleHash: String(row.evidence_bundle_hash),
      systemArtifact: parse<ResearchEvaluationRun["systemArtifact"]>(row.system_artifact_json, {} as ResearchEvaluationRun["systemArtifact"]),
      baselineArtifacts: parse<ResearchEvaluationRun["baselineArtifacts"]>(row.baseline_artifacts_json, []),
      judgeVersions: parse<ResearchEvaluationRun["judgeVersions"]>(row.judge_versions_json, []),
      formalScoreEligible: Boolean(row.formal_score_eligible), metrics: parse<Record<string, number>>(row.metrics_json, {}), notes: parse<string[]>(row.notes_json, []),
      createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : undefined,
    }));
  }

  publishRelease(input: { scope: KnowledgeScope; candidateIds: string[]; createdBy: string }): AssetRelease {
    const current = this.getCurrentRelease(input.scope);
    const refs = new Map((current?.assetRefs || []).map((ref) => [ref.assetId, ref]));
    const revisions: AssetRevision[] = [];
    for (const candidateId of input.candidateIds) {
      const candidate = this.getCandidate(candidateId);
      if (!candidate || candidate.status !== "approved") throw new Error(`Candidate is not approved: ${candidateId}`);
      if (json(candidate.scope) !== json(input.scope)) throw new Error("Release cannot mix knowledge scopes");
      if (candidate.currentBaselineFingerprint !== (current?.fingerprint || this.emptyReleaseFingerprint(input.scope))) throw new Error(`Candidate requires rebase: ${candidateId}`);
      if (candidate.conflicts.length) throw new Error(`Candidate has unresolved conflicts: ${candidateId}`);
      const revision = this.getAssetRevision(candidate.proposedRevisionId);
      if (!revision) throw new Error(`Revision not found: ${candidate.proposedRevisionId}`);
      revisions.push(revision);
      if (candidate.operation === "deprecate") refs.delete(revision.assetId);
      else refs.set(revision.assetId, this.assetRef(revision));
    }
    const assetRefs = [...refs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
    const releaseInput = { scope: input.scope, parentReleaseId: current?.id, rollbackOfReleaseId: undefined, candidateIds: input.candidateIds, assetRefs };
    const release: AssetRelease = {
      id: randomUUID(), ...releaseInput, status: "current", fingerprint: fingerprint(releaseInput),
      createdBy: input.createdBy, createdAt: now(),
    };
    this.hooks.transaction(() => {
      if (current) this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
      const memberInsert = this.db.prepare("INSERT INTO release_members VALUES (?, ?, ?)");
      for (const ref of release.assetRefs) {
        const revision = this.db.prepare("SELECT id FROM asset_revisions WHERE asset_id=? AND version=?").get(ref.assetId, ref.version) as { id: string } | undefined;
        if (revision) memberInsert.run(release.id, ref.assetId, revision.id);
      }
      for (const revision of revisions) {
        const retained = release.assetRefs.some((ref) => ref.assetId === revision.assetId);
        if (retained) {
          this.db.prepare("UPDATE asset_revisions SET status='deprecated', valid_to=CASE WHEN kind='temporal_fact' THEN COALESCE(valid_to, ?) ELSE valid_to END WHERE asset_id=? AND id<>? AND status='released'")
            .run(release.createdAt, revision.assetId, revision.id);
        }
        this.db.prepare("UPDATE asset_revisions SET status=? WHERE id=?").run(retained ? "released" : "deprecated", revision.id);
      }
      for (const id of input.candidateIds) this.db.prepare("UPDATE asset_candidates SET status='released',updated_at=? WHERE id=?").run(now(), id);
    });
    return release;
  }

  rollbackRelease(input: { releaseId: string; createdBy: string }): AssetRelease {
    const target = this.getRelease(input.releaseId);
    if (!target) throw new Error(`Release not found: ${input.releaseId}`);
    const current = this.getCurrentRelease(target.scope);
    if (!current) throw new Error("Current Release is missing");
    if (current.id === target.id) throw new Error("Target Release is already current");
    const releaseInput = {
      scope: target.scope, parentReleaseId: current.id, rollbackOfReleaseId: target.id,
      candidateIds: [] as string[], assetRefs: target.assetRefs,
    };
    const release: AssetRelease = {
      id: randomUUID(), ...releaseInput, status: "current", fingerprint: fingerprint(releaseInput),
      createdBy: input.createdBy, createdAt: now(),
    };
    this.hooks.transaction(() => {
      this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
      const memberInsert = this.db.prepare("INSERT INTO release_members VALUES (?, ?, ?)");
      for (const ref of release.assetRefs) {
        const revision = this.getAssetRevisionByRef(ref);
        if (revision) memberInsert.run(release.id, ref.assetId, revision.id);
      }
    });
    return release;
  }

  putUsage(input: Omit<UsageObservation, "id" | "observedAt">): UsageObservation {
    const encodedRef = json(input.assetRef);
    const existing = this.db.prepare(`SELECT * FROM asset_usage
      WHERE task_id=? AND asset_ref_json=? AND selected_reason=? AND outcome=? ORDER BY observed_at LIMIT 1`)
      .get(input.taskId, encodedRef, input.selectedReason, input.outcome) as Record<string, unknown> | undefined;
    if (existing) return this.mapUsage(existing);
    const item: UsageObservation = { ...input, id: randomUUID(), observedAt: now() };
    this.db.prepare("INSERT INTO asset_usage VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, item.taskId, encodedRef, item.selectedReason, item.outcome, item.observedAt);
    return item;
  }

  observeAssetUsage(input: Omit<UsageObservation, "id" | "observedAt">): UsageObservation {
    const task = this.hooks.task(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const lock = this.getKnowledgeLock(input.taskId);
    if (!lock) throw new Error(`KnowledgeLock not found: ${input.taskId}`);
    const selected = lock.assetRefs.find((ref) => ref.assetId === input.assetRef.assetId && ref.version === input.assetRef.version && ref.fingerprint === input.assetRef.fingerprint);
    if (!selected) throw new Error("Usage asset is not part of the Task KnowledgeLock");
    const prior = this.listUsage(input.taskId).find((item) => item.assetRef.assetId === selected.assetId && item.assetRef.version === selected.version && item.outcome === input.outcome && item.selectedReason === input.selectedReason);
    if (prior) return prior;
    const item = this.putUsage({ ...input, assetRef: selected });
    this.hooks.append({
      conversationId: task.conversationId, taskId: task.id, type: `asset.${input.outcome}`,
      actorType: input.outcome === "helpful" || input.outcome === "regression" ? "researcher" : "system",
      actorId: input.outcome === "helpful" || input.outcome === "regression" ? "knowledge-reviewer" : "runtime",
      payload: { usageObservationId: item.id, assetRef: selected, reason: input.selectedReason, knowledgeLockId: lock.id },
    });
    return item;
  }

  listUsage(taskId?: string): UsageObservation[] {
    const rows = taskId
      ? this.db.prepare("SELECT * FROM asset_usage WHERE task_id=? ORDER BY observed_at").all(taskId)
      : this.db.prepare("SELECT * FROM asset_usage ORDER BY observed_at DESC").all();
    return (rows as Record<string, unknown>[]).map(this.mapUsage);
  }

  assetLineage(assetId: string): { revisions: AssetRevision[]; releases: AssetRelease[]; candidates: AssetCandidate[]; usage: UsageObservation[] } {
    const revisions = (this.db.prepare("SELECT * FROM asset_revisions WHERE asset_id=? ORDER BY version").all(assetId) as Record<string, unknown>[]).map(this.mapRevision);
    const releases = this.listReleases().filter((release) => release.assetRefs.some((ref) => ref.assetId === assetId));
    const revisionIds = new Set(revisions.map((item) => item.id));
    const candidates = this.listCandidates().filter((candidate) => revisionIds.has(candidate.proposedRevisionId) || candidate.targetAssetRef?.assetId === assetId);
    const usage = this.listUsage().filter((item) => item.assetRef.assetId === assetId);
    return { revisions, releases, candidates, usage };
  }

  currentBaselineFingerprint(scope: KnowledgeScope): string {
    return this.getCurrentRelease(scope)?.fingerprint || this.emptyReleaseFingerprint(scope);
  }

  ensureGlobalRelease(): void {
    const scope: KnowledgeScope = { kind: "global" };
    const current = this.getCurrentRelease(scope);
    if (current && (current.createdBy !== "bootstrap" || current.assetRefs.length > 0)) return;
    const input = { scope, parentReleaseId: current?.id, rollbackOfReleaseId: undefined, candidateIds: [] as string[], assetRefs: GLOBAL_AUTHORITY_REFS };
    const release: AssetRelease = { id: randomUUID(), ...input, status: "current", fingerprint: fingerprint(input), createdBy: "bootstrap", createdAt: now() };
    this.hooks.transaction(() => {
      if (current) this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
    });
  }

  private emptyReleaseFingerprint(scope: KnowledgeScope): string {
    return fingerprint({ scope, parentReleaseId: undefined, candidateIds: [], assetRefs: [] });
  }

  private insertRelease(release: AssetRelease): void {
    this.db.prepare(`INSERT INTO asset_releases
      (id,scope_json,scope_key,parent_release_id,rollback_of_release_id,status,candidate_ids_json,asset_refs_json,fingerprint,created_by,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(release.id, json(release.scope), this.scopeKey(release.scope), release.parentReleaseId ?? null,
        release.rollbackOfReleaseId ?? null, release.status, json(release.candidateIds), json(release.assetRefs),
        release.fingerprint, release.createdBy, release.createdAt);
  }

  private assetRef(revision: AssetRevision): AssetRef {
    const identityKey = typeof revision.content.identityKey === "string" ? revision.content.identityKey : undefined;
    return { assetId: revision.assetId, kind: revision.kind, identityKey, scope: revision.scope, version: revision.version, fingerprint: revision.fingerprint, authorityRef: revision.contentRef };
  }

  private isAssetRefActive(ref: AssetRef, asOf: string): boolean {
    if (ref.kind !== "temporal_fact") return true;
    const revision = this.getAssetRevisionByRef(ref);
    if (!revision) return false;
    const point = Date.parse(asOf);
    const starts = revision.validFrom ? Date.parse(revision.validFrom) : Number.NEGATIVE_INFINITY;
    const ends = revision.validTo ? Date.parse(revision.validTo) : Number.POSITIVE_INFINITY;
    return starts <= point && point < ends;
  }

  private mergeAssetRefs(base: AssetRef[], overlay: AssetRef[]): AssetRef[] {
    const key = (ref: AssetRef) => ref.identityKey ? `${ref.kind}:${ref.identityKey}` : ref.assetId;
    const refs = new Map(base.map((ref) => [key(ref), ref]));
    for (const ref of overlay) refs.set(key(ref), ref);
    return [...refs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  }

  private mapKnowledgeLock = (r: Record<string, unknown>): KnowledgeLock => ({ id: String(r.id), taskId: String(r.task_id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), globalReleaseId: String(r.global_release_id), tenantReleaseId: r.tenant_release_id ? String(r.tenant_release_id) : undefined, userReleaseId: r.user_release_id ? String(r.user_release_id) : undefined, userMemoryVersion: r.user_memory_version == null ? undefined : Number(r.user_memory_version), asOf: r.as_of ? String(r.as_of) : String(r.created_at), assetRefs: parse<AssetRef[]>(r.asset_refs_json, []), fingerprint: String(r.fingerprint), createdAt: String(r.created_at) });
  private mapMiningRun = (r: Record<string, unknown>): MiningRun => ({ id: String(r.id), taskId: String(r.task_id), status: r.status as MiningRun["status"], extractorVersion: String(r.extractor_version), knowledgeLockId: String(r.knowledge_lock_id), candidateCount: Number(r.candidate_count), error: r.error ? String(r.error) : undefined, startedAt: r.started_at ? String(r.started_at) : undefined, completedAt: r.completed_at ? String(r.completed_at) : undefined, createdAt: String(r.created_at) });
  private mapRevision = (r: Record<string, unknown>): AssetRevision => ({ id: String(r.id), assetId: String(r.asset_id), kind: r.kind as AssetKind, scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), version: Number(r.version), status: r.status as AssetRevision["status"], content: parse<Record<string, unknown>>(r.content_json, {}), contentRef: r.content_ref ? String(r.content_ref) : undefined, fingerprint: String(r.fingerprint), provenanceRefs: parse<string[]>(r.provenance_refs_json, []), validFrom: r.valid_from ? String(r.valid_from) : undefined, validTo: r.valid_to ? String(r.valid_to) : undefined, supersedes: parse<string[]>(r.supersedes_json, []), createdAt: String(r.created_at) });
  private mapCandidate = (r: Record<string, unknown>): AssetCandidate => ({ id: String(r.id), miningRunId: String(r.mining_run_id), taskId: String(r.task_id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), assetKind: r.asset_kind as AssetKind, operation: r.operation as AssetCandidate["operation"], identityKey: String(r.identity_key), targetAssetRef: r.target_asset_ref_json ? parse<AssetRef>(r.target_asset_ref_json, {} as AssetRef) : undefined, proposedRevisionId: String(r.proposed_revision_id), provenanceRefs: parse<string[]>(r.provenance_refs_json, []), runBaselineFingerprint: String(r.run_baseline_fingerprint), currentBaselineFingerprint: String(r.current_baseline_fingerprint), riskLevel: Number(r.risk_level) as AssetCandidate["riskLevel"], confidence: Number(r.confidence), novelty: Number(r.novelty), conflicts: parse<string[]>(r.conflicts_json, []), status: r.status as CandidateStatus, evaluationSummary: r.evaluation_summary_json ? parse<EvaluationSummary>(r.evaluation_summary_json, { passed: false, scoreDelta: 0, severeRegressions: 0, metrics: {} }) : undefined, decisionNote: r.decision_note ? String(r.decision_note) : undefined, reviewedBy: r.reviewed_by ? String(r.reviewed_by) : undefined, createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
  private mapEvaluationCase = (r: Record<string, unknown>): EvaluationCase => ({ id: String(r.id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), sourceTaskId: String(r.source_task_id), name: String(r.name), inputSnapshot: parse<Record<string, unknown>>(r.input_snapshot_json, {}), assertions: parse<EvaluationCase["assertions"]>(r.assertions_json, []), status: r.status as EvaluationCase["status"], deidentified: Boolean(r.deidentified), createdAt: String(r.created_at) });
  private mapEvaluationRun = (r: Record<string, unknown>): EvaluationRun => ({ id: String(r.id), candidateId: String(r.candidate_id), status: r.status as EvaluationRun["status"], caseIds: parse<string[]>(r.case_ids_json, []), baselineReleaseId: String(r.baseline_release_id), summary: parse<EvaluationSummary>(r.summary_json, { passed: false, scoreDelta: 0, severeRegressions: 0, metrics: {} }), createdAt: String(r.created_at), completedAt: r.completed_at ? String(r.completed_at) : undefined });
  private mapRelease = (r: Record<string, unknown>): AssetRelease => ({ id: String(r.id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), parentReleaseId: r.parent_release_id ? String(r.parent_release_id) : undefined, rollbackOfReleaseId: r.rollback_of_release_id ? String(r.rollback_of_release_id) : undefined, status: r.status as AssetRelease["status"], candidateIds: parse<string[]>(r.candidate_ids_json, []), assetRefs: parse<AssetRef[]>(r.asset_refs_json, []), fingerprint: String(r.fingerprint), createdBy: String(r.created_by), createdAt: String(r.created_at) });
  private mapUsage = (r: Record<string, unknown>): UsageObservation => ({ id: String(r.id), taskId: String(r.task_id), assetRef: parse<AssetRef>(r.asset_ref_json, {} as AssetRef), selectedReason: String(r.selected_reason), outcome: r.outcome as UsageObservation["outcome"], observedAt: String(r.observed_at) });
}
