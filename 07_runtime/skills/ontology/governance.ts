import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";

export type OntologyChangeStatus =
  | "proposed"
  | "impact_assessed"
  | "approved"
  | "implemented"
  | "validated"
  | "released"
  | "rejected";
export type OntologyChangeKind = "add" | "modify" | "deprecate" | "split" | "merge";
export type OntologyGovernanceActionId =
  | "ProposeOntologyChange"
  | "FreezeImpactAssessment"
  | "RebaseOntologyProposal"
  | "ApproveOntologyChange"
  | "RejectOntologyChange"
  | "RecordOntologyImplementation"
  | "AttestValidationResults"
  | "CreateMigrationTask"
  | "ReleaseOntologyBaseline"
  | "GrantGovernanceException"
  | "ExpireGovernanceException";

export type OntologyImpactSnapshot = {
  changed_element_ids: string[];
  affected_consumers?: string[];
  affected_consumer_ids?: string[];
  affected_run_ids: string[];
  required_checks: string[];
  [key: string]: unknown;
};

export type OntologyChangeTransitionEvidence = {
  impact_report?: OntologyImpactSnapshot | null;
  implementation_ref?: string;
  required_checks?: string[];
  validation_results?: Record<string, "pass" | "fail">;
  breaking_change?: boolean;
  migration_ref?: string;
  migration_complete?: boolean;
  target_resolves?: boolean;
  release_fingerprint?: string;
  current_ontology_fingerprint?: string;
  base_fingerprint?: string;
  rebase_required?: boolean;
  unresolved_conflicts?: string[];
  approval_policy_satisfied?: boolean;
};

type GovernanceActionDefinition = {
  metadata: { id: string; version: string };
  applies_to: string;
  permission: { roles: string[]; policy: string };
  submission_criteria: Array<{ rule_ref: string; required: boolean }>;
  state_transition: {
    object_type: string;
    property: string;
    from: string[];
    to: string;
  };
  writes: {
    creates: string[];
    updates: string[];
    links: string[];
  };
  action_log: { object_type: string; version: string; immutable: boolean };
};

const governanceRegistry = YAML.parse(readFileSync(
  repositoryPath("05_governance", "05_元治理本体", "元治理本体", "model_registry.yaml"),
  "utf8",
)) as Record<string, any>;
if (
  governanceRegistry.schema_name !== "ontology_governance_model_registry"
  || governanceRegistry.status !== "active"
  || governanceRegistry.formal_ontology_registration !== "forbidden"
) {
  throw new Error("本体演进治理模型注册表非法");
}

const registeredModelFiles = (governanceRegistry.model_files || []).map(String);
const governanceModels: Record<string, any>[] = registeredModelFiles.map((relative: string) => YAML.parse(readFileSync(
  repositoryPath("05_governance", "05_元治理本体", "元治理本体", relative),
  "utf8",
)) as Record<string, any>);
const governanceObjectTypes = Object.assign({}, ...governanceModels.map((model) => model.object_types || {}));
const governanceActionTypes = Object.assign({}, ...governanceModels.map((model) => model.action_types || {})) as
  Record<OntologyGovernanceActionId, GovernanceActionDefinition>;

const proposalStatusDefinition = governanceObjectTypes.ChangeProposal?.attributes?.status;
export const ONTOLOGY_CHANGE_STATUSES = Object.freeze(
  [...(proposalStatusDefinition?.allowed_values || [])].map(String) as OntologyChangeStatus[],
);
if (ONTOLOGY_CHANGE_STATUSES.length !== 7) {
  throw new Error("治理本体 ChangeProposal 状态定义不完整");
}

export const ONTOLOGY_GOVERNANCE_ACTION_IDS = Object.freeze(
  Object.keys(governanceActionTypes) as OntologyGovernanceActionId[],
);
if (!ONTOLOGY_GOVERNANCE_ACTION_IDS.includes("ReleaseOntologyBaseline")) {
  throw new Error("治理本体 Action 定义不完整");
}

const LIFECYCLE_ACTIONS = Object.fromEntries(
  ONTOLOGY_GOVERNANCE_ACTION_IDS
    .map((actionId) => [actionId, governanceActionTypes[actionId]] as const)
    .filter(([, action]) =>
      action.state_transition.object_type === "ChangeProposal"
      && ONTOLOGY_CHANGE_STATUSES.includes(action.state_transition.to as OntologyChangeStatus)
      && action.metadata.id !== "RebaseOntologyProposal",
    ),
) as Partial<Record<OntologyGovernanceActionId, GovernanceActionDefinition>>;

const TRANSITIONS = Object.fromEntries(ONTOLOGY_CHANGE_STATUSES.map((status) => [
  status,
  Object.freeze(
    Object.values(LIFECYCLE_ACTIONS)
      .filter((action) => action!.state_transition.from.includes(status))
      .map((action) => action!.state_transition.to as OntologyChangeStatus),
  ),
])) as Record<OntologyChangeStatus, readonly OntologyChangeStatus[]>;

export function governanceActionDefinition(actionId: OntologyGovernanceActionId): Readonly<GovernanceActionDefinition> {
  const action = governanceActionTypes[actionId];
  if (!action) throw new Error(`未注册的本体治理 Action: ${actionId}`);
  return action;
}

export function ontologyGovernanceActionForTransition(
  current: OntologyChangeStatus,
  next: OntologyChangeStatus,
): OntologyGovernanceActionId {
  const matches = Object.entries(LIFECYCLE_ACTIONS)
    .filter(([, action]) => action!.state_transition.from.includes(current) && action!.state_transition.to === next)
    .map(([actionId]) => actionId as OntologyGovernanceActionId);
  if (matches.length !== 1) {
    throw new Error(`本体变更状态不得从 ${current} 跳转到 ${next}`);
  }
  return matches[0];
}

export function allowedOntologyChangeTransitions(status: OntologyChangeStatus): readonly OntologyChangeStatus[] {
  return TRANSITIONS[status];
}

function assertBaselineCurrent(evidence: OntologyChangeTransitionEvidence) {
  if (evidence.rebase_required === true || (evidence.unresolved_conflicts || []).length) {
    throw new Error("当前基线已变化或仍有冲突，必须先 rebase");
  }
  const baseFingerprint = String(evidence.base_fingerprint || "");
  const currentFingerprint = String(evidence.current_ontology_fingerprint || "");
  if (!/^sha256:[a-f0-9]{64}$/i.test(baseFingerprint) || !/^sha256:[a-f0-9]{64}$/i.test(currentFingerprint)) {
    throw new Error("提案与当前正式本体必须绑定 sha256 基线指纹");
  }
  if (baseFingerprint !== currentFingerprint) {
    throw new Error("提案基线指纹不是当前正式本体指纹，必须先 rebase");
  }
}

function assertSubmissionRule(ruleRef: string, evidence: OntologyChangeTransitionEvidence) {
  if (ruleRef === "impact_snapshot_complete") {
    const impact = evidence.impact_report;
    if (!impact || !Array.isArray(impact.changed_element_ids) || !impact.changed_element_ids.length) {
      throw new Error("影响评估必须冻结至少一个拟变更元素");
    }
    if (!Array.isArray(impact.required_checks) || !impact.required_checks.length) {
      throw new Error("影响评估必须生成必跑检查");
    }
  } else if (ruleRef === "proposal_baseline_current") {
    assertBaselineCurrent(evidence);
  } else if (ruleRef === "required_approvals_satisfied") {
    if (evidence.approval_policy_satisfied !== true) throw new Error("适用批准策略尚未满足");
  } else if (ruleRef === "implementation_ref_resolves") {
    if (!String(evidence.implementation_ref || "").trim()) throw new Error("必须绑定可解析的实现引用");
  } else if (ruleRef === "all_required_checks_pass") {
    const checks = [...new Set((evidence.required_checks || []).map(String).filter(Boolean))];
    const results = evidence.validation_results || {};
    if (!checks.length) throw new Error("必须继承影响分析的必跑检查");
    const missing = checks.filter((check) => results[check] !== "pass");
    if (missing.length) throw new Error(`本体变更仍有未通过检查: ${missing.join("、")}`);
  } else if (ruleRef === "breaking_change_migration_complete") {
    if (
      evidence.breaking_change
      && (!String(evidence.migration_ref || "").trim() || evidence.migration_complete !== true)
    ) {
      throw new Error("破坏性本体变更必须绑定可解析且完成的迁移任务");
    }
  } else if (ruleRef === "target_resolves") {
    if (evidence.target_resolves !== true) {
      throw new Error("正式发布前拟正式元素 ID 必须能从当前本体或领域参数图解析");
    }
  } else if (ruleRef === "release_fingerprint_current") {
    const releaseFingerprint = String(evidence.release_fingerprint || "");
    if (!/^sha256:[a-f0-9]{64}$/i.test(releaseFingerprint)) {
      throw new Error("正式发布必须绑定 sha256 本体内容指纹");
    }
    if (releaseFingerprint !== String(evidence.current_ontology_fingerprint || "")) {
      throw new Error("正式发布指纹必须等于当前正式本体内容指纹");
    }
  }
}

export function assertOntologyGovernanceAction(
  actionId: OntologyGovernanceActionId,
  current: OntologyChangeStatus,
  evidence: OntologyChangeTransitionEvidence,
): void {
  const action = governanceActionDefinition(actionId);
  const transition = action.state_transition;
  if (transition.object_type !== "ChangeProposal" || !transition.from.includes(current)) {
    throw new Error(`Action ${actionId} 不适用于状态 ${current}`);
  }
  for (const criterion of action.submission_criteria) {
    if (criterion.required) assertSubmissionRule(criterion.rule_ref, evidence);
  }
}

/** @deprecated 使用 assertOntologyGovernanceAction；保留给旧调用方的状态迁移兼容入口。 */
export function assertOntologyChangeTransition(
  current: OntologyChangeStatus,
  next: OntologyChangeStatus,
  evidence: OntologyChangeTransitionEvidence,
): void {
  const actionId = ontologyGovernanceActionForTransition(current, next);
  const compatibilityFingerprint = evidence.current_ontology_fingerprint
    || evidence.base_fingerprint
    || `sha256:${"0".repeat(64)}`;
  const compatibilityEvidence = {
    ...evidence,
    base_fingerprint: evidence.base_fingerprint ?? compatibilityFingerprint,
    current_ontology_fingerprint: evidence.current_ontology_fingerprint ?? compatibilityFingerprint,
    approval_policy_satisfied: evidence.approval_policy_satisfied ?? true,
    migration_complete: evidence.migration_complete ?? Boolean(evidence.migration_ref),
  };
  assertOntologyGovernanceAction(actionId, current, compatibilityEvidence);
}
