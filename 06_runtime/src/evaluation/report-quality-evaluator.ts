import type {
  EvidenceFact,
  FormalResearchValueReadiness,
  ReportDisciplineMetric,
  ReportQualityEvaluation,
  ReportSurfaceData,
  SourceReference,
} from "@/src/contracts";
import { verifyModelDraftSections, verifySourceReference } from "@/src/governance/verifiers";

export interface FormalEvaluationPrerequisites {
  frozenEvidenceBundleHash?: string;
  frozenArtifactHash?: string;
  sealedAdjudicationRef?: string;
  independenceMode?: "pilot_manual" | "dual_route_independent";
  perturbationSetRef?: string;
  calibratedEvaluatorModelIds?: string[];
  evaluatorCalibrationAtLeastC2?: boolean;
  producerModelId?: string;
  downstreamModelIds?: string[];
  sameEvidenceDirectBaselineRef?: string;
  sameEvidenceSummaryBaselineRef?: string;
  eligibilityAttestation?: {
    caseId: string;
    manifestHash: string;
    protocolVersion: "1.0.0";
    status: "eligible";
  };
}

export interface ReportQualityEvaluationInput {
  report: ReportSurfaceData;
  sourceRefs: SourceReference[];
  evidenceFacts: EvidenceFact[];
  formalPrerequisites?: FormalEvaluationPrerequisites;
}

const labels: Record<ReportDisciplineMetric["id"], string> = {
  citation_provenance: "正式判断引用溯源",
  requested_section_coverage: "交付章节完整性",
  method_traceability: "章节方法可追溯",
  evidence_lineage: "事实与来源血缘",
  change_condition_operability: "改判条件可操作性",
  personalization_traceability: "定制要求可追溯",
  model_drafting_boundary: "AI 草拟边界",
  abstention_discipline: "证据不足时克制",
};

export function evaluateReportQuality(input: ReportQualityEvaluationInput): ReportQualityEvaluation {
  const { report, sourceRefs, evidenceFacts } = input;
  const sections = report.sections || [];
  const methods = new Map((report.methodApplications || []).map((application) => [application.id, application]));
  const facts = new Map(evidenceFacts.filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact]));
  const verifiedSources = new Set(sourceRefs
    .filter((source) => source.verification === "verified" && verifySourceReference(source).passed)
    .map((source) => source.sourceId));
  const claims = report.claims || [];

  const validClaims = claims.filter((claim) => claim.sourceIds.length > 0 && claim.sourceIds.every((id) => verifiedSources.has(id))).length;
  const citationMetric = metric(
    "citation_provenance",
    claims.length === 0 ? "not_applicable" : validClaims === claims.length ? "passed" : "attention",
    claims.length === 0 ? "本报告没有正式 Claim；不以零引用伪装满分。" : `${validClaims}/${claims.length} 条正式 Claim 绑定已核验来源。`,
    validClaims,
    claims.length,
  );

  const requested = report.reportSpec?.sections || [];
  const present = new Set(sections.filter((section) => section.paragraphs.length > 0 || section.bullets.length > 0 || section.status === "not_applicable").map((section) => section.key));
  const covered = requested.filter((key) => present.has(key)).length;
  const sectionMetric = metric(
    "requested_section_coverage",
    requested.length > 0 && covered === requested.length ? "passed" : "attention",
    `${covered}/${requested.length} 个 ReportSpec 章节有明确内容、受限说明或不适用状态。`,
    covered,
    requested.length,
  );

  const tracedSections = sections.filter((section) => section.methodApplicationIds?.length);
  const validMethodSections = tracedSections.filter((section) => (section.methodApplicationIds || []).every((id) => {
    const application = methods.get(id);
    return Boolean(application) && (section.evidenceFactIds || []).every((factId) => application!.evidenceFactIds.includes(factId));
  })).length;
  const methodMetric = metric(
    "method_traceability",
    tracedSections.length === 0 ? "not_applicable" : validMethodSections === tracedSections.length ? "passed" : "attention",
    tracedSections.length === 0 ? "本次交付没有章节级 MethodApplication。" : `${validMethodSections}/${tracedSections.length} 个方法化章节可回溯到 MethodApplication。`,
    validMethodSections,
    tracedSections.length,
  );

  const evidenceBearing = sections.filter((section) => section.evidenceFactIds?.length || section.sourceIds.length);
  const validEvidenceSections = evidenceBearing.filter((section) => {
    const sectionFacts = (section.evidenceFactIds || []).map((id) => facts.get(id));
    if (section.sourceIds.some((id) => !verifiedSources.has(id))) return false;
    if ((section.evidenceFactIds || []).some((id) => !facts.has(id))) return false;
    const factSourceIds = new Set(sectionFacts.map((fact) => fact?.snapshotId).filter(Boolean));
    return section.sourceIds.every((id) => factSourceIds.has(id)) || section.evidenceFactIds?.length === 0;
  }).length;
  const evidenceMetric = metric(
    "evidence_lineage",
    evidenceBearing.length === 0 ? "not_applicable" : validEvidenceSections === evidenceBearing.length ? "passed" : "attention",
    evidenceBearing.length === 0 ? "本报告没有事实型章节引用。" : `${validEvidenceSections}/${evidenceBearing.length} 个事实型章节保持 EvidenceFact → SourceSnapshot 血缘。`,
    validEvidenceSections,
    evidenceBearing.length,
  );

  const changeSection = sections.find((section) => section.key === "risks_change_conditions");
  const actionableChangeConditions = changeSection?.bullets.filter((item) => item.trim() && !/等待定义/.test(item)) || [];
  const changeMetric = metric(
    "change_condition_operability",
    actionableChangeConditions.length > 0 ? "passed" : "attention",
    actionableChangeConditions.length > 0 ? `已列出 ${actionableChangeConditions.length} 条可供重新取证的改判条件。` : "尚未形成可操作的改判条件。",
    actionableChangeConditions.length,
    changeSection?.bullets.length || 0,
  );

  const customInstruction = report.reportSpec?.customInstructions?.trim();
  const scopeText = sections.filter((section) => section.key === "research_scope").flatMap((section) => [...section.paragraphs, ...section.bullets]).join("\n");
  const personalizationMetric = metric(
    "personalization_traceability",
    !customInstruction ? "not_applicable" : scopeText.includes(customInstruction) ? "passed" : "attention",
    !customInstruction ? "本次 ReportSpec 未声明额外定制要求。" : scopeText.includes(customInstruction) ? "定制要求已原样记录在研究范围中；专业门槛不随之降低。" : "ReportSpec 的定制要求未在研究范围中留下可审计记录。",
  );

  const draftedCount = sections.filter((section) => section.modelDraft).length;
  const modelCheck = verifyModelDraftSections(report, sourceRefs, evidenceFacts);
  const modelMetric = metric(
    "model_drafting_boundary",
    draftedCount === 0 ? "not_applicable" : modelCheck.passed ? "passed" : "attention",
    draftedCount === 0 ? "本报告未采用模型章节草稿，使用确定性 Composer。" : modelCheck.passed ? `${draftedCount} 个 AI 草拟章节通过事实、方法与引用边界复核。` : modelCheck.errors.join("；"),
  );

  const judgmentSections = sections.filter((section) => section.key === "executive_summary" || section.key === "core_judgments");
  const abstentionPassed = claims.length > 0 || judgmentSections.every((section) => section.status !== "ready");
  const abstentionMetric = metric(
    "abstention_discipline",
    abstentionPassed ? "passed" : "attention",
    claims.length > 0 ? "正式 Judgment 已绑定引用；此项检查不替代 R 可靠性评测。" : abstentionPassed ? "没有正式 Claim 时，核心判断章节保持受限状态。" : "没有正式 Claim，但核心判断章节被错误标记为 ready。",
  );

  const metrics = [citationMetric, sectionMetric, methodMetric, evidenceMetric, changeMetric, personalizationMetric, modelMetric, abstentionMetric];
  return {
    kind: "runtime_discipline_diagnostics",
    version: "1.0.0",
    disciplineStatus: metrics.some((item) => item.status === "attention") ? "attention" : "passed",
    metrics,
    formalResearchValue: formalReadiness(input.formalPrerequisites),
  };
}

function metric(
  id: ReportDisciplineMetric["id"],
  status: ReportDisciplineMetric["status"],
  note: string,
  numerator?: number,
  denominator?: number,
): ReportDisciplineMetric {
  return { id, label: labels[id], status, note, ...(numerator === undefined ? {} : { numerator }), ...(denominator === undefined ? {} : { denominator }) };
}

function formalReadiness(input?: FormalEvaluationPrerequisites): FormalResearchValueReadiness {
  const missing: string[] = [];
  if (!input?.eligibilityAttestation || input.eligibilityAttestation.status !== "eligible" || !/^sha256:[a-f0-9]{64}$/u.test(input.eligibilityAttestation.manifestHash)) missing.push("经可执行案例准入校验器签发的资格证明");
  if (!input?.frozenEvidenceBundleHash) missing.push("冻结且哈希锁定的评测证据包");
  if (!input?.frozenArtifactHash) missing.push("在打开密封裁决前冻结的系统产物哈希");
  if (!input?.sealedAdjudicationRef || input.independenceMode !== "dual_route_independent") missing.push("双轨独立生成的密封裁决契约");
  if (!input?.perturbationSetRef) missing.push("删除、口径替换、反证注入与截止日四类扰动");
  if (!input?.evaluatorCalibrationAtLeastC2 || new Set(input.calibratedEvaluatorModelIds || []).size < 2) missing.push("两个独立评测模型分别达到 C2 的校准结果");
  if (!input?.sameEvidenceDirectBaselineRef || !input.sameEvidenceSummaryBaselineRef) missing.push("同证据直接生成稿与同证据摘要稿基线");
  const downstreamIds = new Set(input?.downstreamModelIds || []);
  if (downstreamIds.size < 2 || (input?.producerModelId && downstreamIds.has(input.producerModelId))) missing.push("与生产模型隔离的下游执行模型配置");
  return {
    framework: "R/U/delta/S/C",
    status: missing.length ? "not_eligible" : "eligible",
    missingPrerequisites: missing,
    protocolRef: "05_control_evaluation/05_evals/protocols/01_评测总纲.md",
    claimBoundary: missing.length
      ? "当前结果仅为运行时专业纪律诊断，不代表 R、U、delta、S、C 或研究增益已经通过。"
      : "已满足正式评测准入条件；仍须运行协议并由独立评测结果产生 R、U、delta、S、C。",
  };
}
