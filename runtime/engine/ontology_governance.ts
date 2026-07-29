import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";

export type OntologyChangeStatus =
  | "proposed"
  | "impact_assessed"
  | "approved"
  | "implemented"
  | "validated"
  | "released"
  | "rejected";
export type OntologyChangeKind = "add" | "modify" | "deprecate" | "split" | "merge";

export type OntologyImpactSnapshot = {
  changed_element_ids: string[];
  affected_consumers: string[];
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
  target_resolves?: boolean;
  release_fingerprint?: string;
  current_ontology_fingerprint?: string;
};

const governanceControlContract = YAML.parse(readFileSync(
  repositoryPath("governance", "02_合同", "governance_control_contract.yaml"),
  "utf8",
)) as Record<string, any>;
if (
  governanceControlContract.schema_name !== "ontology_governance_control_contract"
  || governanceControlContract.status !== "active"
  || governanceControlContract.decision !== "control_plane_not_formal_ontology_domain"
) {
  throw new Error("本体元治理控制面合同非法");
}

export const ONTOLOGY_CHANGE_STATUSES = Object.freeze(
  [...(governanceControlContract.change_request?.statuses || [])].map(String) as OntologyChangeStatus[],
);

const TRANSITIONS = Object.fromEntries(
  Object.entries(governanceControlContract.change_request?.transitions || {}).map(([status, targets]) => [
    status,
    Object.freeze([...(targets as unknown[] || [])].map(String) as OntologyChangeStatus[]),
  ]),
) as Record<OntologyChangeStatus, readonly OntologyChangeStatus[]>;

if (
  ONTOLOGY_CHANGE_STATUSES.length !== 7
  || ONTOLOGY_CHANGE_STATUSES.some((status) => !Object.hasOwn(TRANSITIONS, status))
) {
  throw new Error("本体元治理变更状态或迁移合同不完整");
}

export function allowedOntologyChangeTransitions(status: OntologyChangeStatus): readonly OntologyChangeStatus[] {
  return TRANSITIONS[status];
}

export function assertOntologyChangeTransition(
  current: OntologyChangeStatus,
  next: OntologyChangeStatus,
  evidence: OntologyChangeTransitionEvidence,
): void {
  if (!TRANSITIONS[current].includes(next)) {
    throw new Error(`本体变更状态不得从 ${current} 跳转到 ${next}`);
  }
  if (next === "rejected") return;

  if (next === "impact_assessed") {
    const impact = evidence.impact_report;
    if (!impact || !Array.isArray(impact.changed_element_ids) || !impact.changed_element_ids.length) {
      throw new Error("影响评估必须冻结至少一个拟变更元素");
    }
    if (!Array.isArray(impact.required_checks) || !impact.required_checks.length) {
      throw new Error("影响评估必须生成必跑检查");
    }
  }

  if (next === "implemented" && !String(evidence.implementation_ref || "").trim()) {
    throw new Error("进入 implemented 前必须绑定实现引用");
  }

  if (next === "validated") {
    const checks = [...new Set((evidence.required_checks || []).map(String).filter(Boolean))];
    const results = evidence.validation_results || {};
    if (!checks.length) throw new Error("进入 validated 前必须继承影响分析的必跑检查");
    const missing = checks.filter((check) => results[check] !== "pass");
    if (missing.length) throw new Error(`本体变更仍有未通过检查: ${missing.join("、")}`);
  }

  if (next === "released") {
    if (evidence.target_resolves !== true) {
      throw new Error("正式发布前拟正式元素 ID 必须能从当前本体或领域参数图解析");
    }
    const releaseFingerprint = String(evidence.release_fingerprint || "");
    if (!releaseFingerprint.startsWith("sha256:")) {
      throw new Error("正式发布必须绑定 sha256 本体内容指纹");
    }
    if (releaseFingerprint !== String(evidence.current_ontology_fingerprint || "")) {
      throw new Error("正式发布指纹必须等于当前正式本体内容指纹");
    }
    if (evidence.breaking_change && !String(evidence.migration_ref || "").trim()) {
      throw new Error("破坏性本体变更必须绑定迁移记录");
    }
  }
}
