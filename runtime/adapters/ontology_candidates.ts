import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { getWorkbenchDb, withImmediateTransaction } from "./db";
import { repositoryPath, repositoryRoot } from "./repo-paths";
import {
  aggregateTaskLocalCandidates,
  extractTaskLocalCandidateOccurrences,
  type OntologyCandidateStatus,
  type TaskLocalCandidateSummary,
} from "../engine/ontology_candidates";
import {
  assertOntologyGovernanceAction,
  governanceActionDefinition,
  ontologyGovernanceActionForTransition,
  type OntologyChangeKind,
  type OntologyChangeStatus,
  type OntologyGovernanceActionId,
  type OntologyImpactSnapshot,
} from "../engine/ontology_governance";
import { loadOntologyCatalog, loadSemiconductorBusinessObjectIds } from "../engine/ontology_catalog";

export type OntologyCandidateReview = {
  candidate_key: string;
  status: OntologyCandidateStatus;
  expert_name: string;
  decision_note: string;
  target_ontology_node_id: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OntologyCandidateReviewEvent = {
  id: string;
  candidate_key: string;
  prior_status: OntologyCandidateStatus;
  next_status: OntologyCandidateStatus;
  expert_name: string;
  decision_note: string;
  target_ontology_node_id: string;
  created_at: string;
};

export type OntologyChangeRequest = {
  id: string;
  candidate_key: string;
  request_version: number;
  change_kind: OntologyChangeKind;
  status: OntologyChangeStatus;
  target_ontology_node_id: string;
  breaking_change: boolean;
  proposal_note: string;
  impact_report: OntologyImpactSnapshot | null;
  required_checks: string[];
  validation_results: Record<string, "pass" | "fail">;
  implementation_ref: string;
  migration_ref: string;
  release_fingerprint: string;
  base_fingerprint: string;
  candidate_fingerprint: string;
  branch_ref: string;
  conflicts: string[];
  rebase_required: boolean;
  approval_policy_ref: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  released_at: string | null;
};

export type OntologyChangeRequestEvent = {
  id: string;
  request_id: string;
  prior_status: string;
  next_status: OntologyChangeStatus;
  action_type: string;
  action_version: string;
  actor_name: string;
  actor_role: string;
  decision_note: string;
  evidence: Record<string, unknown>;
  prior_fingerprint: string;
  result_fingerprint: string;
  edited_object_ids: string[];
  created_at: string;
};

export type GovernedOntologyCandidate = TaskLocalCandidateSummary & {
  review: OntologyCandidateReview;
  review_events: OntologyCandidateReviewEvent[];
  change_request: OntologyChangeRequest | null;
  change_request_events: OntologyChangeRequestEvent[];
};

function pendingReview(candidateKey: string): OntologyCandidateReview {
  return {
    candidate_key: candidateKey,
    status: "pending",
    expert_name: "",
    decision_note: "",
    target_ontology_node_id: "",
    reviewed_at: null,
    created_at: "",
    updated_at: "",
  };
}

function mapReview(row: any): OntologyCandidateReview {
  return {
    candidate_key: String(row.candidate_key),
    status: row.status as OntologyCandidateStatus,
    expert_name: String(row.expert_name || ""),
    decision_note: String(row.decision_note || ""),
    target_ontology_node_id: String(row.target_ontology_node_id || ""),
    reviewed_at: row.reviewed_at ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapEvent(row: any): OntologyCandidateReviewEvent {
  return {
    id: String(row.id),
    candidate_key: String(row.candidate_key),
    prior_status: row.prior_status as OntologyCandidateStatus,
    next_status: row.next_status as OntologyCandidateStatus,
    expert_name: String(row.expert_name),
    decision_note: String(row.decision_note),
    target_ontology_node_id: String(row.target_ontology_node_id || ""),
    created_at: String(row.created_at),
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value || "")) as T;
  } catch {
    return fallback;
  }
}

function mapChangeRequest(row: any): OntologyChangeRequest {
  const impact = parseJson<Record<string, unknown>>(row.impact_report_json, {});
  return {
    id: String(row.id),
    candidate_key: String(row.candidate_key),
    request_version: Number(row.request_version),
    change_kind: row.change_kind as OntologyChangeKind,
    status: row.status as OntologyChangeStatus,
    target_ontology_node_id: String(row.target_ontology_node_id),
    breaking_change: Boolean(row.breaking_change),
    proposal_note: String(row.proposal_note || ""),
    impact_report: Object.keys(impact).length ? impact as OntologyImpactSnapshot : null,
    required_checks: parseJson<string[]>(row.required_checks_json, []),
    validation_results: parseJson<Record<string, "pass" | "fail">>(row.validation_results_json, {}),
    implementation_ref: String(row.implementation_ref || ""),
    migration_ref: String(row.migration_ref || ""),
    release_fingerprint: String(row.release_fingerprint || ""),
    base_fingerprint: String(row.base_fingerprint || ""),
    candidate_fingerprint: String(row.candidate_fingerprint || ""),
    branch_ref: String(row.branch_ref || ""),
    conflicts: parseJson<string[]>(row.conflicts_json, []),
    rebase_required: Boolean(row.rebase_required),
    approval_policy_ref: String(row.approval_policy_ref || "standard_ontology_change"),
    created_by: String(row.created_by || ""),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    released_at: row.released_at ?? null,
  };
}

function mapChangeRequestEvent(row: any): OntologyChangeRequestEvent {
  return {
    id: String(row.id),
    request_id: String(row.request_id),
    prior_status: String(row.prior_status),
    next_status: row.next_status as OntologyChangeStatus,
    action_type: String(row.action_type || "LegacyStatusTransition"),
    action_version: String(row.action_version || "1.0.0"),
    actor_name: String(row.actor_name),
    actor_role: String(row.actor_role || ""),
    decision_note: String(row.decision_note),
    evidence: parseJson<Record<string, unknown>>(row.evidence_json, {}),
    prior_fingerprint: String(row.prior_fingerprint || ""),
    result_fingerprint: String(row.result_fingerprint || ""),
    edited_object_ids: parseJson<string[]>(row.edited_object_ids_json, []),
    created_at: String(row.created_at),
  };
}

function targetResolves(targetId: string): boolean {
  const catalog = loadOntologyCatalog();
  return catalog.object_types.has(targetId)
    || catalog.relation_types.has(targetId)
    || catalog.rules.has(targetId)
    || catalog.scenario_types.has(targetId)
    || loadSemiconductorBusinessObjectIds().has(targetId);
}

function governedRepositoryRefExists(reference: string): boolean {
  const relative = reference.split("#", 1)[0].trim();
  if (!relative || path.isAbsolute(relative)) return false;
  const resolved = path.resolve(repositoryPath(relative));
  return resolved.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`) && existsSync(resolved);
}

export function listOntologyCandidates(): GovernedOntologyCandidate[] {
  const db = getWorkbenchDb();
  const artifactRows = db.prepare(`
    SELECT a.run_id, a.id AS artifact_id, a.version AS artifact_version, a.json_content, a.created_at,
           r.question, r.domain
    FROM artifacts a
    JOIN research_runs r ON r.id=a.run_id
    WHERE a.kind='stage_02'
      AND a.status IN ('approved','needs_review')
      AND a.version=(
        SELECT MAX(a2.version) FROM artifacts a2
        WHERE a2.run_id=a.run_id AND a2.kind='stage_02' AND a2.status IN ('approved','needs_review')
      )
  `).all() as any[];
  const summaries = aggregateTaskLocalCandidates(extractTaskLocalCandidateOccurrences(artifactRows));
  const reviews = new Map(
    (db.prepare("SELECT * FROM ontology_candidate_reviews").all() as any[])
      .map((row) => {
        const review = mapReview(row);
        return [review.candidate_key, review] as const;
      }),
  );
  const events = new Map<string, OntologyCandidateReviewEvent[]>();
  for (const row of db.prepare("SELECT * FROM ontology_candidate_review_events ORDER BY created_at DESC").all() as any[]) {
    const event = mapEvent(row);
    const group = events.get(event.candidate_key) || [];
    group.push(event);
    events.set(event.candidate_key, group);
  }
  const changeRequests = new Map<string, OntologyChangeRequest>();
  for (const row of db.prepare(`
    SELECT request.* FROM ontology_change_requests request
    JOIN (
      SELECT candidate_key, MAX(request_version) AS request_version
      FROM ontology_change_requests GROUP BY candidate_key
    ) latest
      ON latest.candidate_key=request.candidate_key
     AND latest.request_version=request.request_version
  `).all() as any[]) {
    const request = mapChangeRequest(row);
    changeRequests.set(request.candidate_key, request);
  }
  const changeEvents = new Map<string, OntologyChangeRequestEvent[]>();
  for (const row of db.prepare("SELECT * FROM ontology_change_request_events ORDER BY created_at DESC").all() as any[]) {
    const event = mapChangeRequestEvent(row);
    const group = changeEvents.get(event.request_id) || [];
    group.push(event);
    changeEvents.set(event.request_id, group);
  }
  return summaries.map((summary) => ({
    ...summary,
    review: reviews.get(summary.candidate_key) || pendingReview(summary.candidate_key),
    review_events: events.get(summary.candidate_key) || [],
    change_request: changeRequests.get(summary.candidate_key) || null,
    change_request_events: changeRequests.has(summary.candidate_key)
      ? changeEvents.get(changeRequests.get(summary.candidate_key)!.id) || []
      : [],
  }));
}

export function reviewOntologyCandidate(input: {
  candidateKey: string;
  status: OntologyCandidateStatus;
  expertName: string;
  decisionNote: string;
  targetOntologyNodeId?: string;
}): GovernedOntologyCandidate {
  const allowed: OntologyCandidateStatus[] = ["pending", "expert_confirmed", "promoted", "rejected"];
  if (!allowed.includes(input.status)) throw new Error("本体候选状态无效");
  const candidate = listOntologyCandidates().find((item) => item.candidate_key === input.candidateKey);
  if (!candidate) throw new Error("本体候选不存在或已无当前产物依据");
  const expertName = input.expertName.trim();
  const decisionNote = input.decisionNote.trim();
  const targetOntologyNodeId = String(input.targetOntologyNodeId || "").trim();
  if (
    candidate.change_request
    && input.status === "promoted"
    && candidate.change_request.target_ontology_node_id === targetOntologyNodeId
  ) {
    return candidate;
  }
  if (candidate.change_request) {
    throw new Error("候选已进入正式变更流程，后续决定必须在变更提案上追加，不得改写候选评审状态");
  }
  if (input.status !== "pending" && expertName.length < 2) throw new Error("专家确认必须记录审阅人");
  if (input.status !== "pending" && decisionNote.length < 8) throw new Error("专家确认必须记录至少 8 字理由");
  if (input.status === "promoted" && (!targetOntologyNodeId || targetOntologyNodeId.startsWith("task_local:"))) {
    throw new Error("登记晋升必须填写拟正式本体 ID，且不能继续使用 task_local 前缀");
  }
  if (input.status === "promoted" && candidate.review.status !== "expert_confirmed" && candidate.review.status !== "promoted") {
    throw new Error("候选必须先经专家确认，才能登记正式变更提案");
  }
  const db = getWorkbenchDb();
  const now = new Date().toISOString();
  const currentOntologyFingerprint = loadOntologyCatalog().fingerprint;
  const proposeAction = governanceActionDefinition("ProposeOntologyChange");
  withImmediateTransaction(() => {
    const existing = db.prepare("SELECT * FROM ontology_candidate_reviews WHERE candidate_key=?").get(input.candidateKey) as any;
    const priorStatus = (existing?.status || "pending") as OntologyCandidateStatus;
    if (existing) {
      db.prepare(`UPDATE ontology_candidate_reviews SET
        status=?, expert_name=?, decision_note=?, target_ontology_node_id=?, reviewed_at=?, updated_at=?
        WHERE candidate_key=?`).run(
        input.status, expertName, decisionNote, targetOntologyNodeId,
        input.status === "pending" ? null : now, now, input.candidateKey,
      );
    } else {
      db.prepare(`INSERT INTO ontology_candidate_reviews(
        candidate_key,status,expert_name,decision_note,target_ontology_node_id,reviewed_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        input.candidateKey, input.status, expertName, decisionNote, targetOntologyNodeId,
        input.status === "pending" ? null : now, now, now,
      );
    }
    db.prepare(`INSERT INTO ontology_candidate_review_events(
      id,candidate_key,prior_status,next_status,expert_name,decision_note,target_ontology_node_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.candidateKey, priorStatus, input.status, expertName, decisionNote, targetOntologyNodeId, now,
    );
    if (input.status === "promoted") {
      const existingRequest = db.prepare(`
        SELECT * FROM ontology_change_requests
        WHERE candidate_key=? ORDER BY request_version DESC LIMIT 1
      `).get(input.candidateKey) as any;
      if (!existingRequest) {
        const requestId = `OCR-${crypto.randomUUID()}`;
        db.prepare(`INSERT INTO ontology_change_requests(
          id,candidate_key,request_version,change_kind,status,target_ontology_node_id,
          proposal_note,base_fingerprint,branch_ref,approval_policy_ref,created_by,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          requestId, input.candidateKey, 1, "add", "proposed", targetOntologyNodeId,
          decisionNote, currentOntologyFingerprint, `candidate:${input.candidateKey}`,
          "standard_ontology_change", expertName, now, now,
        );
        db.prepare(`INSERT INTO ontology_change_request_events(
          id,request_id,prior_status,next_status,action_type,action_version,actor_name,actor_role,
          decision_note,evidence_json,prior_fingerprint,result_fingerprint,edited_object_ids_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          crypto.randomUUID(), requestId, "none", "proposed", "ProposeOntologyChange", proposeAction.action_log.version,
          expertName, "ontology_steward", decisionNote,
          JSON.stringify({
            candidate_key: input.candidateKey,
            target_ontology_node_id: targetOntologyNodeId,
            branch_ref: `candidate:${input.candidateKey}`,
            base_fingerprint: currentOntologyFingerprint,
          }),
          "", currentOntologyFingerprint, JSON.stringify([requestId]), now,
        );
      } else if (existingRequest.target_ontology_node_id !== targetOntologyNodeId) {
        throw new Error("已有本体变更提案时不得静默修改拟正式元素 ID");
      }
    }
  });
  return listOntologyCandidates().find((item) => item.candidate_key === input.candidateKey)!;
}

export function listOntologyChangeRequests(): OntologyChangeRequest[] {
  return (getWorkbenchDb().prepare(
    "SELECT * FROM ontology_change_requests ORDER BY updated_at DESC, request_version DESC",
  ).all() as any[]).map(mapChangeRequest);
}

export function applyOntologyGovernanceAction(input: {
  requestId: string;
  actionId: OntologyGovernanceActionId;
  actorName: string;
  actorRole: string;
  decisionNote: string;
  impactReport?: OntologyImpactSnapshot;
  validationResults?: Record<string, "pass" | "fail">;
  implementationRef?: string;
  breakingChange?: boolean;
  migrationRef?: string;
  migrationComplete?: boolean;
  releaseFingerprint?: string;
  approvalPolicySatisfied?: boolean;
  candidateFingerprint?: string;
  remainingConflicts?: string[];
}): OntologyChangeRequest {
  const db = getWorkbenchDb();
  const raw = db.prepare("SELECT * FROM ontology_change_requests WHERE id=?").get(input.requestId) as any;
  if (!raw) throw new Error("本体变更提案不存在");
  const current = mapChangeRequest(raw);
  const actorName = input.actorName.trim();
  const actorRole = input.actorRole.trim();
  const decisionNote = input.decisionNote.trim();
  if (actorName.length < 2) throw new Error("治理决定必须记录责任人");
  const action = governanceActionDefinition(input.actionId);
  if (!action.permission.roles.includes(actorRole)) {
    throw new Error(`角色 ${actorRole || "(empty)"} 无权执行 Action ${input.actionId}`);
  }
  if (decisionNote.length < 8) throw new Error("治理决定必须记录至少 8 字理由");

  const impactReport = input.impactReport || current.impact_report;
  const requiredChecks = impactReport?.required_checks || current.required_checks;
  const validationResults = input.validationResults || current.validation_results;
  const implementationRef = String(input.implementationRef ?? current.implementation_ref).trim();
  const breakingChange = input.breakingChange ?? current.breaking_change;
  const migrationRef = String(input.migrationRef ?? current.migration_ref).trim();
  const releaseFingerprint = String(input.releaseFingerprint ?? current.release_fingerprint).trim();
  const catalog = loadOntologyCatalog();
  const transitionTo = action.state_transition.to;
  const nextStatus = input.actionId === "RebaseOntologyProposal"
    ? "proposed"
    : transitionTo === "same"
      ? current.status
      : transitionTo as OntologyChangeStatus;
  if (input.actionId === "RecordOntologyImplementation" && !governedRepositoryRefExists(implementationRef)) {
    throw new Error("进入 implemented 前实现引用必须指向仓库内已存在资产");
  }
  if (
    input.actionId === "ReleaseOntologyBaseline"
    && breakingChange
    && !governedRepositoryRefExists(migrationRef)
  ) {
    throw new Error("破坏性本体变更的迁移记录必须可解析");
  }
  if (input.actionId === "CreateMigrationTask" && !governedRepositoryRefExists(migrationRef)) {
    throw new Error("迁移任务引用必须指向仓库内已存在资产");
  }
  assertOntologyGovernanceAction(input.actionId, current.status, {
    impact_report: impactReport,
    implementation_ref: implementationRef,
    required_checks: requiredChecks,
    validation_results: validationResults,
    breaking_change: breakingChange,
    migration_ref: migrationRef,
    migration_complete: input.migrationComplete ?? false,
    target_resolves: targetResolves(current.target_ontology_node_id),
    release_fingerprint: releaseFingerprint,
    current_ontology_fingerprint: catalog.fingerprint,
    base_fingerprint: input.actionId === "RebaseOntologyProposal" ? catalog.fingerprint : current.base_fingerprint,
    rebase_required: input.actionId === "RebaseOntologyProposal" ? false : current.rebase_required,
    unresolved_conflicts: input.actionId === "RebaseOntologyProposal"
      ? input.remainingConflicts || []
      : current.conflicts,
    approval_policy_satisfied: input.approvalPolicySatisfied,
  });

  const now = new Date().toISOString();
  const baseFingerprint = input.actionId === "RebaseOntologyProposal"
    ? catalog.fingerprint
    : current.base_fingerprint;
  const conflicts = input.actionId === "RebaseOntologyProposal"
    ? input.remainingConflicts || []
    : current.conflicts;
  const candidateFingerprint = String(input.candidateFingerprint ?? current.candidate_fingerprint).trim();
  withImmediateTransaction(() => {
    db.prepare(`UPDATE ontology_change_requests SET
      status=?, breaking_change=?, impact_report_json=?, required_checks_json=?,
      validation_results_json=?, implementation_ref=?, migration_ref=?, release_fingerprint=?,
      base_fingerprint=?, candidate_fingerprint=?, conflicts_json=?, rebase_required=?,
      updated_at=?, released_at=?
      WHERE id=?`).run(
      nextStatus,
      breakingChange ? 1 : 0,
      JSON.stringify(input.actionId === "RebaseOntologyProposal" ? {} : impactReport || {}),
      JSON.stringify(input.actionId === "RebaseOntologyProposal" ? [] : requiredChecks),
      JSON.stringify(validationResults),
      implementationRef,
      migrationRef,
      releaseFingerprint,
      baseFingerprint,
      candidateFingerprint,
      JSON.stringify(conflicts),
      conflicts.length ? 1 : 0,
      now,
      nextStatus === "released" ? now : current.released_at,
      input.requestId,
    );
    db.prepare(`INSERT INTO ontology_change_request_events(
      id,request_id,prior_status,next_status,action_type,action_version,actor_name,actor_role,
      decision_note,evidence_json,prior_fingerprint,result_fingerprint,edited_object_ids_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(),
      input.requestId,
      current.status,
      nextStatus,
      input.actionId,
      action.action_log.version,
      actorName,
      actorRole,
      decisionNote,
      JSON.stringify({
        impact_report: impactReport,
        validation_results: validationResults,
        implementation_ref: implementationRef,
        breaking_change: breakingChange,
        migration_ref: migrationRef,
        migration_complete: input.migrationComplete ?? false,
        release_fingerprint: releaseFingerprint,
        base_fingerprint: baseFingerprint,
        candidate_fingerprint: candidateFingerprint,
        conflicts,
        approval_policy_satisfied: input.approvalPolicySatisfied ?? false,
      }),
      current.base_fingerprint,
      nextStatus === "released" ? releaseFingerprint : candidateFingerprint || baseFingerprint,
      JSON.stringify([input.requestId]),
      now,
    );
  });
  return mapChangeRequest(
    db.prepare("SELECT * FROM ontology_change_requests WHERE id=?").get(input.requestId),
  );
}

/** @deprecated 使用 applyOntologyGovernanceAction，以 Action ID 代替自由 next_status。 */
export function advanceOntologyChangeRequest(input: {
  requestId: string;
  nextStatus: OntologyChangeStatus;
  actorName: string;
  decisionNote: string;
  impactReport?: OntologyImpactSnapshot;
  validationResults?: Record<string, "pass" | "fail">;
  implementationRef?: string;
  breakingChange?: boolean;
  migrationRef?: string;
  releaseFingerprint?: string;
}): OntologyChangeRequest {
  const current = mapChangeRequest(
    getWorkbenchDb().prepare("SELECT * FROM ontology_change_requests WHERE id=?").get(input.requestId),
  );
  const actionId = ontologyGovernanceActionForTransition(current.status, input.nextStatus);
  return applyOntologyGovernanceAction({
    ...input,
    actionId,
    actorRole: "ontology_steward",
    approvalPolicySatisfied: true,
    migrationComplete: Boolean(input.migrationRef),
  });
}
