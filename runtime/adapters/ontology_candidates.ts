import "server-only";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getWorkbenchDb, withImmediateTransaction } from "./db";
import { repositoryPath, repositoryRoot } from "./repo-paths";
import {
  aggregateTaskLocalCandidates,
  candidateSimilarities,
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
import { loadOntologyCatalog, loadSemiconductorBusinessObjectIds, resetOntologyCatalogForTests } from "../engine/ontology_catalog";
import { extractGraph, loadDomainBusinessGraph, resetDomainBusinessGraphCache } from "../engine/instance_graph";
import { buildKnowledgePackage, validateKnowledgePackageFiles } from "../engine/knowledge_package";

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
  similarities: ReturnType<typeof candidateSimilarities>;
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
    similarities: candidateSimilarities(summary, summaries),
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

export type FormalStateVariableInput = {
  targetId: string;
  name: string;
  definition: string;
  category: string;
  variableKind: string;
  anchors: string[];
  evidenceProfileRef: string;
  decisionUse: string;
  observationGuidance: string;
  counterEvidenceGuidance: string;
};

const DOMAIN_GRAPH_REF = "ontology/02_领域/semiconductor/business_instances.yaml";

function validateFormalStateVariableInput(input: FormalStateVariableInput) {
  if (!/^[a-z][a-z0-9_]{2,80}$/.test(input.targetId)) throw new Error("正式本体 ID 只能使用小写字母、数字和下划线，且至少 3 位");
  for (const [label, value] of [
    ["正式名称", input.name], ["稳定定义", input.definition], ["判断用途", input.decisionUse],
    ["观察指引", input.observationGuidance], ["反证指引", input.counterEvidenceGuidance],
  ]) if (String(value || "").trim().length < 4) throw new Error(`${label}至少需要 4 个字符`);
  if (!input.category.trim() || !input.variableKind.trim()) throw new Error("类别和变量类型不能为空");
  if (!input.anchors.length) throw new Error("正式状态变量至少需要一个对象锚点");
  const catalog = loadOntologyCatalog();
  const unresolved = input.anchors.filter((anchor) => !catalog.object_types.has(anchor));
  if (unresolved.length) throw new Error(`对象锚点不是正式类型：${unresolved.join("、")}`);
  const domainGraph = loadDomainBusinessGraph();
  if (!domainGraph?.objects.some((object) => object.type === "EvidenceProfile" && object.id === input.evidenceProfileRef)) {
    throw new Error("证据画像必须引用领域知识库中已有的 EvidenceProfile");
  }
  if (domainGraph.objects.some((object) => object.id === input.targetId)) throw new Error("拟正式本体 ID 已存在");
}

function writeFormalStateVariable(input: FormalStateVariableInput): { rollback: () => void } {
  validateFormalStateVariableInput(input);
  const absolute = repositoryPath(DOMAIN_GRAPH_REF);
  const original = readFileSync(absolute, "utf8");
  const graph = loadDomainBusinessGraph()!;
  const nextIndex = graph.objects.filter((object) => object.type === "StateVariable").length;
  const object = {
    id: input.targetId,
    type: "StateVariable",
    properties: {
      id: input.targetId,
      name: input.name.trim(),
      category: input.category.trim(),
      definition: input.definition.trim(),
      decision_use: input.decisionUse.trim(),
      variable_kind: input.variableKind.trim(),
      anchors: [...new Set(input.anchors.map((item) => item.trim()).filter(Boolean))],
      observation_guidance: input.observationGuidance.trim(),
      evidence_profile_ref: input.evidenceProfileRef.trim(),
      counter_evidence_guidance: input.counterEvidenceGuidance.trim(),
      variable_role: "primary_judgment_variable",
    },
    projection: { section: "state_variables", index: nextIndex },
  };
  const marker = "\n  relations:\n";
  if (!original.includes(marker)) throw new Error("领域本体文件缺少 relations 分区，不能安全写入");
  const itemYaml = YAML.stringify([object], { lineWidth: 0 }).split("\n").filter(Boolean).map((line) => `  ${line}`).join("\n");
  const next = original.replace(marker, `\n${itemYaml}\n  relations:\n`);
  const projected = extractGraph(YAML.parse(next));
  if (!projected || projected.objects.filter((item) => item.id === input.targetId).length !== 1) {
    throw new Error("候选写入后的领域本体图无法通过结构解析");
  }
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, next, "utf8");
  renameSync(temporary, absolute);
  resetDomainBusinessGraphCache();
  resetOntologyCatalogForTests();
  return {
    rollback: () => {
      const restore = `${absolute}.restore-${process.pid}-${Date.now()}`;
      writeFileSync(restore, original, "utf8");
      renameSync(restore, absolute);
      if (existsSync(temporary)) unlinkSync(temporary);
      resetDomainBusinessGraphCache();
      resetOntologyCatalogForTests();
    },
  };
}

function validatePromotedStateVariable(input: FormalStateVariableInput): Record<string, "pass" | "fail"> {
  resetDomainBusinessGraphCache();
  resetOntologyCatalogForTests();
  const graph = loadDomainBusinessGraph();
  const inserted = graph?.objects.filter((object) => object.id === input.targetId) || [];
  const catalog = loadOntologyCatalog();
  const authorityValid = input.anchors.every((anchor) => catalog.object_types.has(anchor))
    && Boolean(graph?.objects.some((object) => object.type === "EvidenceProfile" && object.id === input.evidenceProfileRef));
  const baseline = buildKnowledgePackage(null);
  const packageResult = validateKnowledgePackageFiles(new Map(baseline.files.map((file) => [file.file_name, file.content])));
  const results = {
    "ontology:check": inserted.length === 1 && targetResolves(input.targetId) ? "pass" as const : "fail" as const,
    parameter_authority: authorityValid ? "pass" as const : "fail" as const,
    knowledge_package: packageResult.ok ? "pass" as const : "fail" as const,
  };
  const failed = Object.entries(results).filter(([, status]) => status === "fail").map(([check]) => check);
  if (failed.length) throw new Error(`自动入库校验失败：${failed.join("、")}`);
  return results;
}

/**
 * 面向知识库的一次性操作；内部仍追加完整治理 Action 历史。
 * 文件校验或治理发布失败时恢复领域本体资产，提案则停留在失败步骤供审计。
 */
export function promoteOntologyCandidateGroup(input: {
  candidateKey: string;
  memberCandidateKeys?: string[];
  expertName: string;
  decisionNote: string;
  definition: FormalStateVariableInput;
}) {
  validateFormalStateVariableInput(input.definition);
  const all = listOntologyCandidates();
  let candidate = all.find((item) => item.candidate_key === input.candidateKey);
  if (!candidate) throw new Error("本体候选不存在或已无当前研究依据");
  if (candidate.change_request?.status === "released") return candidate;
  const targetId = input.definition.targetId;
  if (candidate.review.status === "pending") {
    candidate = reviewOntologyCandidate({ candidateKey: candidate.candidate_key, status: "expert_confirmed", expertName: input.expertName, decisionNote: input.decisionNote, targetOntologyNodeId: targetId });
  }
  if (!candidate.change_request) {
    candidate = reviewOntologyCandidate({ candidateKey: candidate.candidate_key, status: "promoted", expertName: input.expertName, decisionNote: input.decisionNote, targetOntologyNodeId: targetId });
  }
  let current = candidate.change_request!;
  const memberKeys = [...new Set([candidate.candidate_key, ...(input.memberCandidateKeys || [])])];
  const memberRuns = [...new Set(all.filter((item) => memberKeys.includes(item.candidate_key)).flatMap((item) => item.run_ids))];
  const impactReport: OntologyImpactSnapshot = {
    changed_element_ids: [targetId],
    affected_consumers: ["runtime_semantic_catalog", "knowledge_task_slice", "knowledge_library_ui"],
    affected_run_ids: memberRuns,
    required_checks: ["ontology:check", "parameter_authority", "knowledge_package"],
  };
  if (current.status === "proposed") current = applyOntologyGovernanceAction({ requestId: current.id, actionId: "FreezeImpactAssessment", actorName: input.expertName, actorRole: "ontology_steward", decisionNote: input.decisionNote, impactReport });
  if (current.status === "impact_assessed") current = applyOntologyGovernanceAction({ requestId: current.id, actionId: "ApproveOntologyChange", actorName: input.expertName, actorRole: "ontology_steward", decisionNote: input.decisionNote, approvalPolicySatisfied: true });
  let written: ReturnType<typeof writeFormalStateVariable> | null = null;
  try {
    const targetAlreadyExists = Boolean(loadDomainBusinessGraph()?.objects.some((object) => object.id === targetId));
    if (!targetAlreadyExists) written = writeFormalStateVariable(input.definition);
    if (current.status === "approved") current = applyOntologyGovernanceAction({ requestId: current.id, actionId: "RecordOntologyImplementation", actorName: input.expertName, actorRole: "ontology_steward", decisionNote: input.decisionNote, implementationRef: DOMAIN_GRAPH_REF });
    if (current.status === "implemented") {
      const validationResults = validatePromotedStateVariable(input.definition);
      current = applyOntologyGovernanceAction({ requestId: current.id, actionId: "AttestValidationResults", actorName: input.expertName, actorRole: "ontology_steward", decisionNote: input.decisionNote, validationResults });
    }
    if (current.status === "validated") {
      const fingerprint = loadOntologyCatalog().fingerprint;
      current = applyOntologyGovernanceAction({ requestId: current.id, actionId: "ReleaseOntologyBaseline", actorName: input.expertName, actorRole: "ontology_steward", decisionNote: input.decisionNote, releaseFingerprint: fingerprint, approvalPolicySatisfied: true });
    }
  } catch (error) {
    written?.rollback();
    throw error;
  }
  for (const member of all.filter((item) => memberKeys.includes(item.candidate_key) && item.candidate_key !== candidate!.candidate_key && !item.change_request)) {
    if (member.review.status === "pending") reviewOntologyCandidate({ candidateKey: member.candidate_key, status: "expert_confirmed", expertName: input.expertName, decisionNote: `与 ${targetId} 合并治理：${input.decisionNote}`, targetOntologyNodeId: targetId });
  }
  return listOntologyCandidates().find((item) => item.candidate_key === candidate!.candidate_key)!;
}
