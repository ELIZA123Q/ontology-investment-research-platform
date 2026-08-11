import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

export type JudgmentLevel = "J0" | "J1" | "J2" | "J3" | "J4";
export type EvidenceGrade = "Q0" | "Q1" | "Q2" | "Q3" | "Q4";
export type CounterevidenceStatus = "cleared" | "weakened" | "contested" | "decisive" | "not_checked" | "not_applicable";
export type PathReadiness = "ready" | "restricted" | "blocked" | "not_applicable";

const policy = DOMAIN_CATALOG.governance.judgmentThreshold as unknown as {
  formal_rule_ref: string;
  evidence_grade_caps: Record<EvidenceGrade, JudgmentLevel>;
  counterevidence_caps: Record<CounterevidenceStatus, JudgmentLevel>;
  path_readiness_caps: Record<PathReadiness, JudgmentLevel>;
  level_outputs: Record<JudgmentLevel, { evidence_permission: string; allowed_04_output: string; allowed_expression: string }>;
};
const order: JudgmentLevel[] = ["J0", "J1", "J2", "J3", "J4"];

export interface JudgmentThresholdEvaluation {
  policyRef: string;
  evidenceGrade: EvidenceGrade;
  counterevidenceStatus: CounterevidenceStatus;
  pathReadiness: PathReadiness;
  caps: { evidence: JudgmentLevel; counterevidence: JudgmentLevel; pathReadiness: JudgmentLevel };
  maxLevel: JudgmentLevel;
  evidencePermission: string;
  allowedOutput: string;
  allowedExpression: string;
}

export function evaluateJudgmentThreshold(input: { evidenceGrade: EvidenceGrade; counterevidenceStatus: CounterevidenceStatus; pathReadiness: PathReadiness }): JudgmentThresholdEvaluation {
  const caps = {
    evidence: policy.evidence_grade_caps[input.evidenceGrade],
    counterevidence: policy.counterevidence_caps[input.counterevidenceStatus],
    pathReadiness: policy.path_readiness_caps[input.pathReadiness],
  };
  const maxLevel = order[Math.min(...Object.values(caps).map((level) => order.indexOf(level)))];
  const output = policy.level_outputs[maxLevel];
  return {
    policyRef: policy.formal_rule_ref,
    evidenceGrade: input.evidenceGrade,
    counterevidenceStatus: input.counterevidenceStatus,
    pathReadiness: input.pathReadiness,
    caps,
    maxLevel,
    evidencePermission: output.evidence_permission,
    allowedOutput: output.allowed_04_output,
    allowedExpression: output.allowed_expression,
  };
}
