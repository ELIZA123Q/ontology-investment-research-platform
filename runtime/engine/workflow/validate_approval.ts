import { createHash } from "node:crypto";
import "server-only";
import {
  getRun,
  latestArtifact,
  listSources,
  normalizeUrl,
} from "../../adapters/db";
import { evidenceBoundSourceIds } from "../evidence_sources";
import {
  validateExpressionMethodBindings,
  validateJudgmentCapabilityCoverage,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "../method_application";
import {
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "../method_registry";
import {
  checkCrossStageReferences,
  checkDerivedFields,
  computeBindingHash,
} from "../output_contract";
import { validateReasoningTraceBindings } from "../reasoning_trace";
import { schemas, type SchemaKind } from "../schemas";
import { assertDeterministicRuleResults } from "../semantic_execution";
import {
  approvedSemanticData,
  loadApprovedSemanticSnapshot,
} from "../semantic_reads";
import {
  SEMANTIC_REVIEW_CHECKS,
  validateSemanticReview,
} from "../semantic_review";
import {
  assertStage01ReadyForApproval,
  ensureStage01ContractFields,
} from "../stage01_contract";
import {
  assertStage02AnswersStage01,
  assertStage02ReadyForApproval,
  ensureStage02DocumentFields,
} from "../stage02_documents";
import {
  assertStage03ReadyForApproval,
  ensureStage03DocumentFields,
  recomputeStage03EvidenceQualityGate,
} from "../stage03_documents";
import {
  assertStage04ReadyForApproval,
  ensureStage04DocumentFields,
} from "../stage04_documents";
import {
  assertStage05ReadyForApproval,
  ensureStage05DocumentFields,
} from "../stage05_documents";
import {
  parseJson,
  type Artifact,
  type MethodApplication,
  type SourceRecord,
} from "../types";
import {
  equivalentSourceTime,
  recomputeStage04DeterministicRules,
  sameStringSet,
  stage02OntologyObjectIds,
  validateOntologyVariableBindings,
} from "../workflow_shared";

export function validateApproval(artifact: Artifact) {
  const data: any = parseJson(artifact.json_content, {});
  if (artifact.kind === "stage_01") {
    const run = getRun(artifact.run_id);
    ensureStage01ContractFields(data, run?.question || String(data.normalized_question || ""));
    // 确认门禁按补齐后的规范字段判定；不在此处回写产物，避免静默改稿。
    schemas.stage_01.parse(data);
    assertStage01ReadyForApproval(data);
  } else if (artifact.kind === "stage_02") {
    const run = getRun(artifact.run_id);
    const taskArtifact = latestArtifact(artifact.run_id, "stage_01", ["approved"]);
    const taskDefinition: any = parseJson(taskArtifact?.json_content || "{}", {});
    ensureStage02DocumentFields(data, {
      question: taskDefinition?.normalized_question || run?.question,
      taskId: artifact.run_id,
    });
    schemas.stage_02.parse(data);
    assertStage02ReadyForApproval(data);
    assertStage02AnswersStage01(data, taskDefinition);
    validateMethodApplications("stage_02", data.method_applications as MethodApplication[], {
      ontologyObjectIds: stage02OntologyObjectIds(data),
    });
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], data.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], data.judgment_units || []);
    validateOntologyVariableBindings(data.variables || []);
  } else if (artifact.kind === "stage_03") {
    const run = getRun(artifact.run_id);
    const taskArtifact = latestArtifact(artifact.run_id, "stage_01", ["approved"]);
    const taskDefinition: any = parseJson(taskArtifact?.json_content || "{}", {});
    const structure: any = approvedSemanticData(artifact.run_id, "stage_02");
    ensureStage03DocumentFields(data, { question: run?.question, taskId: artifact.run_id, structure });
    // 确认时重算证据门，防止手工编辑省略/伪造 gate 绕过生成期门禁
    Object.assign(data, recomputeStage03EvidenceQualityGate(data, {
      structure,
      sources: listSources(artifact.run_id),
      defaultScopeRef: structure?.research_scope?.id,
      cutoffAt: taskDefinition?.time_scope?.as_of,
    }));
    schemas.stage_03.parse(data);
    assertStage03ReadyForApproval(data);
  } else if (artifact.kind === "stage_04") {
    const run = getRun(artifact.run_id);
    recomputeStage04DeterministicRules(artifact.run_id, data);
    ensureStage04DocumentFields(data, { question: run?.question, taskId: artifact.run_id });
    schemas.stage_04.parse(data);
    assertStage04ReadyForApproval(data);
  } else if (artifact.kind === "stage_05") {
    const run = getRun(artifact.run_id);
    const stage04: any = approvedSemanticData(artifact.run_id, "stage_04");
    ensureStage05DocumentFields(data, { question: run?.question, taskId: artifact.run_id, stage04 });
    schemas.stage_05.parse(data);
    // Stage05 确认默认要求研报结构达标（对齐 validate_05 固定节）；minimum_pass 仅可保存草稿，不能作为正式确认。
    assertStage05ReadyForApproval(data, { requirePublishableStructure: true });
  } else {
    const schema = schemas[artifact.kind as SchemaKind];
    if (schema) schema.parse(data);
  }
  if (artifact.kind === "stage_03") {
    const structure: any = approvedSemanticData(artifact.run_id, "stage_02");
    const evidenceIds = new Set<string>((data.evidence_drafts || []).map((item: any) => String(item.id)));
    const judgmentUnitIds = new Set<string>((structure.judgment_units || []).map((item: any) => String(item.id)));
    validateMethodApplications("stage_03", data.method_applications as MethodApplication[], {
      prior: structure.method_applications || [],
      evidenceIds,
    });
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], structure.judgment_units || []);
    for (const application of data.method_applications as MethodApplication[]) {
      if (application.capability_type === "evidence" && application.status === "candidate") {
        throw new Error(`${application.application_id} 取证 MA 在 stage_03 必须收敛为 selected/degraded/blocked/rejected，不得仍为 candidate`);
      }
    }
    const referencedEvidenceIds = new Set<string>(
      (data.method_applications || []).flatMap((item: MethodApplication) => item.input_evidence_refs),
    );
    for (const application of data.method_applications as MethodApplication[]) {
      for (const ref of application.target_judgment_unit_refs) {
        if (!judgmentUnitIds.has(ref)) throw new Error(`${application.application_id} 引用了不存在的判断单元 ${ref}`);
      }
      if (application.capability_type === "evidence" && application.status === "selected" && !application.input_evidence_refs.length) {
        throw new Error(`${application.application_id} selected 取证方法必须绑定至少一项证据草稿`);
      }
    }
    const sourceRecords = listSources(artifact.run_id);
    const known = new Map(sourceRecords.map((s) => [s.id, s]));
    const sourceByKey = new Map<string, any>();
    const seenSourceIds = new Set<string>();
    for (const source of data.sources || []) {
      const key = String(source.source_key || "");
      const sourceId = String(source.source_id || "");
      if (!key || sourceByKey.has(key)) throw new Error(`stage_03 来源 source_key 为空或重复: ${key || "<empty>"}`);
      if (!sourceId || seenSourceIds.has(sourceId)) throw new Error(`${key} 缺少唯一 source_id`);
      const record = known.get(sourceId);
      if (!record) throw new Error(`${key} 未绑定当前运行 Source Registry`);
      let normalized = "";
      try { normalized = normalizeUrl(source.url); } catch { throw new Error(`${key} URL 非法`); }
      const mismatches = [
        normalized !== record.normalized_url ? "url" : "",
        String(source.content_hash || "") !== String(record.content_hash || "") ? "content_hash" : "",
        String(source.locator || "") !== String(record.locator || "") ? "locator" : "",
        String(source.source_quote || "") !== String(record.source_quote || "") ? "source_quote" : "",
        String(source.captured_at || "") !== String(record.captured_at || "") ? "captured_at" : "",
        String(source.final_url || "") !== String(record.final_url || "") ? "final_url" : "",
        String(source.retrieval_status || "") !== String(record.retrieval_status || "") ? "retrieval_status" : "",
        Boolean(source.quote_verified) !== Boolean(record.quote_verified) ? "quote_verified" : "",
        String(source.source_tier || "S8") !== String(record.source_tier || "S8") ? "source_tier" : "",
        !equivalentSourceTime(source.published_at, record.published_at) ? "published_at" : "",
      ].filter(Boolean);
      if (mismatches.length) throw new Error(`${key} 与 Source Registry 不一致: ${mismatches.join(", ")}`);
      sourceByKey.set(key, source);
      seenSourceIds.add(sourceId);
    }
    for (const evidence of data.evidence_drafts || []) {
      for (const ref of evidence.judgment_unit_ids || []) {
        if (!judgmentUnitIds.has(ref)) throw new Error(`${evidence.id} 引用了不存在的判断单元 ${ref}`);
      }
      if (evidence.kind !== "gap" && (!evidence.source_ids?.length || evidence.source_ids.some((id: string) => !known.has(id)))) {
        throw new Error(`${evidence.id} 缺少有效来源，不能确认`);
      }
      if (evidence.kind !== "gap") {
        const expectedSourceIds = (evidence.source_keys || []).map((key: string) => sourceByKey.get(String(key))?.source_id).filter(Boolean);
        if (expectedSourceIds.length !== (evidence.source_keys || []).length
          || !sameStringSet(expectedSourceIds, evidence.source_ids || [])) {
          throw new Error(`${evidence.id} 的 source_keys/source_ids 与冻结来源表不一致`);
        }
      }
      const boundSources = ((evidence.source_ids || []).map((id: string) => known.get(id)) as Array<SourceRecord | undefined>)
        .filter((source): source is SourceRecord => Boolean(source));
      if (evidence.kind !== "gap" && boundSources.some((source) => source.usability_status === "candidate" || source.usability_status === "rejected")) {
        throw new Error(`${evidence.id} 引用了尚未通过正文抓取和定位校验的来源`);
      }
      if (evidence.kind !== "gap" && boundSources.some((source) => source.usability_status === "limited") && !(evidence.limitations || []).length) {
        throw new Error(`${evidence.id} 使用受限来源时必须披露 limitations`);
      }
      if (!referencedEvidenceIds.has(evidence.id)) {
        throw new Error(`${evidence.id} 未绑定任何 MethodApplication，不能确认`);
      }
    }
  }
  if (artifact.kind === "stage_04") {
    const upstream: any = approvedSemanticData(artifact.run_id, "stage_03");
    const structure: any = approvedSemanticData(artifact.run_id, "stage_02");
    const ids = new Set<string>((upstream.evidence_drafts || []).map((x: any) => String(x.id)));
    const judgmentIds = new Set<string>((data.judgments || []).map((item: any) => String(item.id)));
    const signalIds = new Set<string>((data.signals || []).map((item: any) => String(item.id)));
    const sourceGroupById = new Map(listSources(artifact.run_id).map((source) => [source.id, source.source_group || source.publisher || source.normalized_url]));
    validateMethodApplications("stage_04", data.method_applications as MethodApplication[], {
      prior: upstream.method_applications || [],
      evidenceIds: ids,
      judgmentIds,
      signalIds,
      evidenceDrafts: upstream.evidence_drafts || [],
      sourceGroupById,
    });
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentMethodBindings(data.judgments || [], data.method_applications || []);
    validateReasoningTraceBindings(data, ids, data.method_applications || []);
    assertDeterministicRuleResults(data);
    for (const j of data.judgments || []) {
      for (const id of [...j.supporting_evidence_draft_ids, ...j.counter_evidence_draft_ids]) {
        if (!ids.has(id)) throw new Error(`${j.id} 引用了不存在的证据草稿 ${id}`);
      }
    }
  }
  if (artifact.kind === "stage_05") {
    const upstream: any = approvedSemanticData(artifact.run_id, "stage_04");
    const evidenceStage: any = approvedSemanticData(artifact.run_id, "stage_03");
    const ids = new Set((upstream.judgments || []).map((x: any) => x.id));
    const sourceIds = evidenceBoundSourceIds(evidenceStage);
    validateExpressionMethodBindings(data.report_claims || [], upstream.method_applications || [], upstream.judgments || []);
    const judgmentById = new Map((upstream.judgments || []).map((item: any) => [String(item.id), item]));
    const evidenceById = new Map((evidenceStage.evidence_drafts || []).map((item: any) => [String(item.id), item]));
    for (const c of data.report_claims || []) {
      for (const id of c.judgment_ids) if (!ids.has(id)) throw new Error(`${c.id} 引用了不存在的判断 ${id}`);
      for (const id of c.source_ids) if (!sourceIds.has(id)) throw new Error(`${c.id} 引用了不存在的来源 ${id}`);
      const judgments = (c.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean) as any[];
      const allowedEvidence = new Set(judgments.flatMap((item) => [
        ...(item.supporting_evidence_draft_ids || []), ...(item.counter_evidence_draft_ids || []),
      ]).map(String));
      const claimEvidence = (c.evidence_draft_ids || []).map(String);
      const onlyJ0Stops = judgments.length > 0 && judgments.every((item) => item.strength === "J0"
        && ["blocked", "indeterminate", "contested"].includes(String(item.decision_status)));
      if (!claimEvidence.length && !onlyJ0Stops) throw new Error(`${c.id} 缺少事实级 evidence_draft_ids 追溯`);
      for (const id of claimEvidence) if (!allowedEvidence.has(id) || !evidenceById.has(id)) throw new Error(`${c.id} 引用了来源 Judgment 未使用的证据 ${id}`);
      const expectedSources = claimEvidence.flatMap((id: string) => (evidenceById.get(id) as any)?.source_ids || []).map(String);
      if (!sameStringSet(expectedSources, c.source_ids || [])) throw new Error(`${c.id}.source_ids 必须由 evidence_draft_ids 唯一派生`);
    }
  }
  if (artifact.kind === "baseline") {
    const { artifact: current, data: currentData } = loadApprovedSemanticSnapshot(
      artifact.run_id,
      "stage_03",
    );
    const expectedHash = createHash("sha256").update(current.json_content).digest("hex");
    if (data.frozen_stage03_artifact_id !== current.id || data.frozen_stage03_artifact_hash !== expectedHash) {
      throw new Error("同证据基线与当前 stage_03 冻结证据不一致");
    }
    const boundIds = evidenceBoundSourceIds(currentData);
    const frozenByKey = new Map(
      (currentData.sources || [])
        .filter((source: any) => boundIds.has(String(source.source_id || "")))
        .map((source: any) => [String(source.source_key), source]),
    );
    for (const claim of data.core_claims || []) {
      for (const key of claim.source_keys || []) if (!frozenByKey.has(String(key))) throw new Error(`${claim.id} 引用了冻结证据外的来源 ${key}`);
    }
    for (const source of data.sources || []) {
      const frozen = frozenByKey.get(String(source.source_key || ""));
      if (!frozen || normalizeUrl(source.url) !== normalizeUrl((frozen as any).url)) {
        throw new Error(`同证据基线携带了冻结证据外的来源 ${source.source_key || source.url}`);
      }
    }
  }
  // =========================================================
  // v2 增强: 输出合同校验 (派生字段 + 跨阶段引用完整性)
  // =========================================================
  if (artifact.kind === "stage_03" || artifact.kind === "stage_04" || artifact.kind === "stage_05") {
    const stageNum = artifact.kind.slice(-2);
    const dataObj: any = parseJson(artifact.json_content, {});

    // 1. 派生字段检查
    const derivedViolations = checkDerivedFields(dataObj, artifact.kind);
    if (derivedViolations.length > 0) {
      throw new Error(
        `[output_contract] ${artifact.kind} 包含 ${derivedViolations.length} 个禁止手动填写的派生字段: ${derivedViolations.slice(0, 3).join("; ")}`
      );
    }

    // 2. 跨阶段引用完整性
    const upstreamData: Record<string, unknown> = {};
    if (stageNum === "03" || stageNum === "04" || stageNum === "05") {
      upstreamData.stage_02 = approvedSemanticData(artifact.run_id, "stage_02");
    }
    if (stageNum === "04" || stageNum === "05") {
      upstreamData.stage_03 = approvedSemanticData(artifact.run_id, "stage_03");
    }
    if (stageNum === "05") {
      upstreamData.stage_04 = approvedSemanticData(artifact.run_id, "stage_04");
    }

    const brokenRefs = checkCrossStageReferences(dataObj, artifact.kind, upstreamData);
    if (brokenRefs.length > 0) {
      throw new Error(
        `[output_contract] ${artifact.kind} 发现 ${brokenRefs.length} 个跨阶段引用断裂: ${brokenRefs.slice(0, 3).map((r) => `${r.sourceField}→${r.missingRef}`).join("; ")}`
      );
    }

    // 3. 哈希绑定生成 (不阻断，仅记录)
    const upstreamHashes: Record<string, string> = {};
    for (const [k, v] of Object.entries(upstreamData)) {
      upstreamHashes[k] = createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
    }
    const bindingHash = computeBindingHash(upstreamHashes, artifact.kind);
    // 绑定哈希供后续流程使用 (approve 时写入 manifest)
    (dataObj as any).binding_hash = bindingHash;
  }
  if (artifact.kind === "independent_review") {
    const { artifact: current } = loadApprovedSemanticSnapshot(artifact.run_id, "stage_04");
    const expectedHash = createHash("sha256").update(current.json_content).digest("hex");
    if (data.reviewed_stage04_artifact_id !== current.id || data.reviewed_stage04_artifact_hash !== expectedHash) {
      throw new Error("独立审阅不对应当前 stage_04 内容");
    }
    if (!artifact.model_name || data.reviewer_model !== artifact.model_name || data.producer_model !== current.model_name) {
      throw new Error("独立审阅的生产/审阅模型身份与实际产物不符");
    }
    const independentModel = data.independence_level === "independent_model"
      && data.reviewer_type === "model"
      && data.reviewer_model !== data.producer_model;
    const independentHuman = data.independence_level === "independent_human"
      && data.reviewer_type === "human"
      && String(data.reviewer_model || "").startsWith("human:")
      && data.reviewer_model !== data.producer_model
      && String(data.reviewer_attestation || "").trim().length >= 20;
    if (!independentModel && !independentHuman) {
      throw new Error("独立审阅必须由不同模型完成，或由留下独立性声明的非生产人类审阅者完成");
    }
    if ((data.verdict === "pass" && data.issues.length) || (data.verdict === "rework" && !data.issues.length)) {
      throw new Error("独立审阅 verdict 与 issues 不一致");
    }
    // pass 必须附带正式五项语义审查；禁止仅用批量 verdict 冒充
    if (data.verdict === "pass") {
      const checks = Array.isArray(data.semantic_checks) ? data.semantic_checks : [];
      const validated = validateSemanticReview(
        {
          reviewer_id: String(data.reviewer_model || artifact.model_name || "reviewer"),
          reviewer_type: data.reviewer_type === "human" ? "human" : "model",
          independent_from_producer: true,
          checks,
          verdict: "pass",
        },
        {
          producerId: String(data.producer_model || current.model_name || "producer"),
          runMode: "development",
          stageHashes: { stage_04: expectedHash },
          contractVersion: "1.3.0",
        },
      );
      if (!validated.valid || validated.verdict !== "pass") {
        throw new Error(
          `独立审阅 pass 须通过正式五项语义审查（${SEMANTIC_REVIEW_CHECKS.join("、")}）：${validated.errors.join("；") || validated.verdict}`,
        );
      }
    }
  }
}
