import { createHash } from "node:crypto";
import type { FormalEvaluationPrerequisites } from "@/src/evaluation/report-quality-evaluator";
import { normalizeSourceDocumentAttestation, type SourceDocumentAttestation } from "@/src/tools/source-document-attestation";

export type FormalEvaluationStratum = "report_value" | "restraint";
export type PerturbationKind = "delete_key_evidence" | "replace_scope_or_metric" | "inject_counterevidence" | "move_information_cutoff";
export type CalibrationLevel = "C0" | "C1" | "C2" | "C3";
export type FormalEvidenceRole = "substantive" | "access_gap" | "boundary";
export type FormalEvidenceAccessStatus = "retrieved" | "metadata_only" | "unavailable";

interface FrozenRef { ref: string; hash: string; }

export interface FormalEvaluationCaseManifest {
  schemaVersion: "1.0.0";
  caseId: string;
  stratum: FormalEvaluationStratum;
  taskInput: {
    question: string;
    subjectScope: string[];
    informationCutoff: string;
    allowedEndpoint: string;
  };
  evidenceBundle: FrozenRef & {
    frozenAt: string;
    evidence: Array<{
      id: string;
      publisherId: string;
      title: string;
      uri: string;
      publishedAt: string;
      businessTime: string;
      independentSourceGroup: string;
      statementNature: "fact" | "measurement" | "forecast" | "interpretation";
      evidenceRole: FormalEvidenceRole;
      accessStatus: FormalEvidenceAccessStatus;
      locator: string;
      quote: string;
      contentHash: string;
      /**
       * Fingerprint of the complete retrieved public document. This is
       * deliberately separate from contentHash, which fingerprints only the
       * cited excerpt/normalized capture.
       */
      documentAttestation?: SourceDocumentAttestation;
      supports: string[];
      limitations: string[];
    }>;
  };
  systemArtifact: FrozenRef & { frozenAt: string; sealedAdjudicationOpenedAt: string };
  sealedAdjudication: {
    ref: string;
    independenceMode: "dual_route_independent" | "pilot_manual";
    notAReferenceReport: boolean;
    frameworkRulesUsage: "boundary_check_only" | "answer_generation";
    routeA: { modelId: string; outputHash: string };
    routeB: { modelId: string; outputHash: string };
    coordinator: { modelId: string; outputHash: string };
    coreClaims: Array<{
      claimId: string;
      statement: string;
      criticality: "primary" | "supporting" | "boundary";
      strengthCeiling: string;
      minimumEvidenceBasket: string[];
    }>;
    strongestCounterevidence: string[];
    prohibitedExpressions: string[];
    updateScenarios: Array<{ id: string; newInformation: string; expectedAction: string; affectedClaimIds: string[] }>;
    downstreamRequiredUnits: string[];
    objectiveChecks: {
      numbersTimesObjectsSources: "required";
      minimumEvidenceExists: "required";
      cutoffEnforced: "required";
      forecastsNotFacts: "required";
    };
  };
  perturbations: Array<FrozenRef & { kind: PerturbationKind; expectedAction: string }>;
  baselines: { sameEvidenceDirect: FrozenRef; sameEvidenceSummary: FrozenRef };
  evaluationModels: {
    producerModelId: string;
    judges: Array<{ modelId: string; calibrationLevel: CalibrationLevel; calibrationRef: string; calibrationHash: string }>;
    downstream: Array<{ modelId: string; role: "executor" | "scorer" }>;
  };
}

export interface FormalEligibilityCheck { id: string; passed: boolean; note: string }

export interface FormalCaseEligibilityResult {
  caseId: string;
  status: "eligible" | "not_eligible";
  manifestHash: string;
  checks: FormalEligibilityCheck[];
  missingPrerequisites: string[];
  prerequisites?: FormalEvaluationPrerequisites;
}

const requiredPerturbations: PerturbationKind[] = [
  "delete_key_evidence",
  "replace_scope_or_metric",
  "inject_counterevidence",
  "move_information_cutoff",
];

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const isHash = (value: string) => /^sha256:[a-f0-9]{64}$/u.test(value || "");
const isTime = (value: string) => !Number.isNaN(Date.parse(value));
const nonEmpty = (value: string) => Boolean(value?.trim());
const calibrationRank: Record<CalibrationLevel, number> = { C0: 0, C1: 1, C2: 2, C3: 3 };

function hasValidPublicDocumentAttestation(item: FormalEvaluationCaseManifest["evidenceBundle"]["evidence"][number]): boolean {
  if (!/^https?:\/\//u.test(item.uri) || item.accessStatus !== "retrieved") return true;
  try {
    const attestation = normalizeSourceDocumentAttestation(item.documentAttestation);
    return attestation !== undefined && attestation.rawContentHash !== item.contentHash;
  } catch {
    return false;
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashFormalEvidenceBundle(evidence: FormalEvaluationCaseManifest["evidenceBundle"]["evidence"]): string {
  return sha256(canonicalize(evidence));
}

function check(id: string, passed: boolean, note: string): FormalEligibilityCheck {
  return { id, passed, note };
}

export function evaluateFormalCaseEligibility(manifest: FormalEvaluationCaseManifest): FormalCaseEligibilityResult {
  const cutoff = Date.parse(manifest.taskInput.informationCutoff);
  const evidenceIds = new Set(manifest.evidenceBundle.evidence.map((item) => item.id));
  const claimIds = new Set(manifest.sealedAdjudication.coreClaims.map((item) => item.claimId));
  const routes = [manifest.sealedAdjudication.routeA.modelId, manifest.sealedAdjudication.routeB.modelId, manifest.sealedAdjudication.coordinator.modelId];
  const judgeIds = manifest.evaluationModels.judges.map((item) => item.modelId);
  const downstreamIds = manifest.evaluationModels.downstream.map((item) => item.modelId);
  const perturbationKinds = new Set(manifest.perturbations.map((item) => item.kind));
  const substantiveEvidence = manifest.evidenceBundle.evidence.filter((item) => item.evidenceRole === "substantive" && item.accessStatus === "retrieved");
  const accessGaps = manifest.evidenceBundle.evidence.filter((item) => item.evidenceRole === "access_gap" && item.accessStatus === "unavailable");
  const substantiveSourceGroups = new Set(substantiveEvidence.map((item) => item.independentSourceGroup));
  const allSourceGroups = new Set(manifest.evidenceBundle.evidence.map((item) => item.independentSourceGroup));
  const accessGapsOnlySupportBoundaries = accessGaps.every((item) => item.supports.every((support) => support.startsWith("boundary:")));
  const evidenceRoleCoherent = manifest.evidenceBundle.evidence.every((item) => (
    (item.evidenceRole === "substantive" && item.accessStatus === "retrieved")
    || (item.evidenceRole === "access_gap" && item.accessStatus === "unavailable")
    || (item.evidenceRole === "boundary" && ["retrieved", "metadata_only"].includes(item.accessStatus))
  ));

  const checks: FormalEligibilityCheck[] = [
    check("task_input", nonEmpty(manifest.caseId) && nonEmpty(manifest.taskInput.question) && manifest.taskInput.subjectScope.length > 0 && manifest.taskInput.subjectScope.every(nonEmpty) && isTime(manifest.taskInput.informationCutoff) && nonEmpty(manifest.taskInput.allowedEndpoint), "公开任务输入包含问题、对象、截止日和允许终点。"),
    check("frozen_hashes", [manifest.evidenceBundle.hash, manifest.systemArtifact.hash, manifest.baselines.sameEvidenceDirect.hash, manifest.baselines.sameEvidenceSummary.hash].every(isHash), "证据、系统产物和两份同证据基线均使用 SHA-256 冻结。"),
    check("evidence_bundle_integrity", isTime(manifest.evidenceBundle.frozenAt) && manifest.evidenceBundle.hash === hashFormalEvidenceBundle(manifest.evidenceBundle.evidence), "证据包哈希必须由规范化证据清单重新计算通过。"),
    check("evidence_before_artifact", isTime(manifest.evidenceBundle.frozenAt) && isTime(manifest.systemArtifact.frozenAt) && Date.parse(manifest.evidenceBundle.frozenAt) <= Date.parse(manifest.systemArtifact.frozenAt), "证据包在系统产物之前或同时冻结。"),
    check("freeze_before_seal", isTime(manifest.systemArtifact.frozenAt) && isTime(manifest.systemArtifact.sealedAdjudicationOpenedAt) && Date.parse(manifest.systemArtifact.frozenAt) < Date.parse(manifest.systemArtifact.sealedAdjudicationOpenedAt), "系统产物在打开密封裁决前冻结。"),
    check("evidence_contract", manifest.evidenceBundle.evidence.length >= 3 && evidenceIds.size === manifest.evidenceBundle.evidence.length && evidenceRoleCoherent && manifest.evidenceBundle.evidence.every((item) => nonEmpty(item.publisherId) && nonEmpty(item.title) && /^(?:https?|mcp):\/\//u.test(item.uri) && isTime(item.publishedAt) && isTime(item.businessTime) && nonEmpty(item.independentSourceGroup) && nonEmpty(item.locator) && nonEmpty(item.quote) && isHash(item.contentHash) && item.supports.length > 0 && item.supports.every(nonEmpty) && item.limitations.length > 0), "冻结证据至少三条；MCP URI、支持点、证据角色与访问状态必须自洽。"),
    check("public_document_attestation", manifest.evidenceBundle.evidence.every(hasValidPublicDocumentAttestation), "每条已取回的 HTTP(S) 正式证据均须保存完整原始文件指纹，且不得以摘录哈希冒充文件哈希；不可获取来源仍只能作为受审计缺口。"),
    check("cutoff", Number.isFinite(cutoff) && manifest.evidenceBundle.evidence.every((item) => Date.parse(item.publishedAt) <= cutoff), "全部证据发布时间不晚于研究截止日。"),
    check("independent_sources", manifest.stratum === "report_value" ? substantiveSourceGroups.size >= 2 : substantiveSourceGroups.size >= 1 && allSourceGroups.size >= 2, manifest.stratum === "report_value" ? "报告价值案例至少包含两个已取回的实质证据来源组；访问失败不能伪装成独立佐证。" : "克制案例至少包含一个已取回实质来源和一个不同来源组的受审计边界或缺口。"),
    check("stratum_evidence_boundary", manifest.stratum === "report_value" ? substantiveEvidence.length >= 3 : substantiveEvidence.length >= 1 && accessGaps.length >= 1 && accessGapsOnlySupportBoundaries, manifest.stratum === "report_value" ? "报告价值案例至少三条实质证据。" : "克制案例必须含真实访问缺口，且缺口只能支持边界判断，不能支持价值结论。"),
    check("dual_route_seal", manifest.sealedAdjudication.independenceMode === "dual_route_independent" && manifest.sealedAdjudication.notAReferenceReport && manifest.sealedAdjudication.frameworkRulesUsage === "boundary_check_only" && new Set(routes).size === 3 && [manifest.sealedAdjudication.routeA.outputHash, manifest.sealedAdjudication.routeB.outputHash, manifest.sealedAdjudication.coordinator.outputHash].every(isHash), "密封裁决由三个相互独立模型角色生成，体系规则只做边界检查。"),
    check("core_claims", manifest.sealedAdjudication.coreClaims.length >= 3 && manifest.sealedAdjudication.coreClaims.length <= 7 && claimIds.size === manifest.sealedAdjudication.coreClaims.length && manifest.sealedAdjudication.coreClaims.some((item) => item.criticality === "primary") && manifest.sealedAdjudication.coreClaims.every((item) => nonEmpty(item.statement) && nonEmpty(item.strengthCeiling) && item.minimumEvidenceBasket.length > 0 && item.minimumEvidenceBasket.every((id) => evidenceIds.has(id))), "密封裁决含 3—7 条核心判断，且最低证据篮子真实存在。"),
    check("counter_and_updates", manifest.sealedAdjudication.strongestCounterevidence.length > 0 && manifest.sealedAdjudication.prohibitedExpressions.length > 0 && manifest.sealedAdjudication.updateScenarios.length >= 2 && manifest.sealedAdjudication.updateScenarios.every((item) => item.affectedClaimIds.length > 0 && item.affectedClaimIds.every((id) => claimIds.has(id))) && manifest.sealedAdjudication.downstreamRequiredUnits.length > 0, "最强反证、禁止表达、至少两个更新场景和下游必需单元齐全。"),
    check("objective_checks", Object.values(manifest.sealedAdjudication.objectiveChecks).every((value) => value === "required"), "数字/时间/对象/来源、最低证据、截止日与预测事实边界均为必检。"),
    check("perturbations", requiredPerturbations.every((kind) => perturbationKinds.has(kind)) && manifest.perturbations.every((item) => isHash(item.hash) && nonEmpty(item.ref) && nonEmpty(item.expectedAction)), "四类扰动及预期动作齐全。"),
    check("calibrated_judges", judgeIds.length >= 2 && new Set(judgeIds).size === judgeIds.length && manifest.evaluationModels.judges.every((item) => calibrationRank[item.calibrationLevel] >= 2 && nonEmpty(item.calibrationRef) && isHash(item.calibrationHash)), "至少两个独立评测模型分别达到 C2。"),
    check("model_isolation", nonEmpty(manifest.evaluationModels.producerModelId) && downstreamIds.length >= 2 && new Set(downstreamIds).size === downstreamIds.length && !judgeIds.includes(manifest.evaluationModels.producerModelId) && !downstreamIds.includes(manifest.evaluationModels.producerModelId), "生产模型、评测模型和至少两个下游模型彼此隔离。"),
  ];
  const missingPrerequisites = checks.filter((item) => !item.passed).map((item) => item.note);
  const manifestHash = sha256(canonicalize(manifest));
  const status = missingPrerequisites.length ? "not_eligible" as const : "eligible" as const;
  return {
    caseId: manifest.caseId,
    status,
    manifestHash,
    checks,
    missingPrerequisites,
    ...(status === "eligible" ? { prerequisites: {
      frozenEvidenceBundleHash: manifest.evidenceBundle.hash,
      frozenArtifactHash: manifest.systemArtifact.hash,
      sealedAdjudicationRef: manifest.sealedAdjudication.ref,
      independenceMode: manifest.sealedAdjudication.independenceMode,
      perturbationSetRef: `manifest:${manifestHash}:perturbations`,
      calibratedEvaluatorModelIds: judgeIds,
      evaluatorCalibrationAtLeastC2: true,
      producerModelId: manifest.evaluationModels.producerModelId,
      downstreamModelIds: downstreamIds,
      sameEvidenceDirectBaselineRef: manifest.baselines.sameEvidenceDirect.ref,
      sameEvidenceSummaryBaselineRef: manifest.baselines.sameEvidenceSummary.ref,
      eligibilityAttestation: { caseId: manifest.caseId, manifestHash, protocolVersion: manifest.schemaVersion, status: "eligible" },
    } } : {}),
  };
}
