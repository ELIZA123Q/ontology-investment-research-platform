import { createHash } from "node:crypto";
import "server-only";
import {
createArtifact,
getRun,
latestArtifact,
listSources
} from "../../adapters/db";
import {
loadMethodRegistry
} from "../method_registry";
import { PROMPT_VERSION } from "../prompts";
import { syncReviewWorkItems } from "../review_work_items";
import { schemas } from "../schemas";
import { applyDeterministicRuleEvaluations } from "../semantic_execution";
import { parseJson,type MethodApplication } from "../types";

import { syncStage04ReadableMarkdown } from "../readable_markdown";
import { ensureStage04DocumentFields, manifestContextFromRun } from "../stage04_documents";
import {
competingExplanationsForUnit,
normalizeCompetingExplanations
} from "../structure_candidates";
import {
normalizeBusinessCutoff,
validateGeneratedSemanticDraft
} from "../workflow_shared";

export type ControlledJudgmentInput = {
  judgment_unit_id: string;
  conclusion: string;
  evidence_draft_ids?: string[];
  supporting_evidence_draft_ids?: string[];
  counter_evidence_draft_ids?: string[];
  rationale?: string;
  uncertainties?: string[];
  invalidation_conditions?: string[];
  competing_explanation?: string;
  source_explanation_id?: string;
  discriminating_evidence?: string[];
  counterevidence_resolution?: string;
  confirmed_precondition_ids?: string[];
  tracking_signals?: string[];
  conditions?: string[];
};

export function createControlledJudgmentProjection(runId: string, inputs: ControlledJudgmentInput[]) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("受控判断投影至少需要一条显式 JudgmentUnit 裁决输入");

  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  const unitById = new Map<string, any>((structure.judgment_units || []).map((unit: any) => [String(unit.id), unit]));
  const factById = new Map<string, any>((evidence.evidence_drafts || []).filter((item: any) => item.kind !== "gap").map((item: any) => [String(item.id), item]));
  const seenUnits = new Set<string>();
  const normalizedInputs = inputs.map((input) => {
    const unitId = String(input.judgment_unit_id || "");
    if (!unitById.has(unitId)) throw new Error(`JudgmentUnit 不存在: ${unitId}`);
    if (seenUnits.has(unitId)) throw new Error(`JudgmentUnit 重复裁决: ${unitId}`);
    seenUnits.add(unitId);
    if (!String(input.conclusion || "").trim()) throw new Error(`${unitId} 缺少显式 conclusion`);
    const supportingIds = [...new Set((input.supporting_evidence_draft_ids || input.evidence_draft_ids || []).map(String))];
    const counterIds = [...new Set((input.counter_evidence_draft_ids || []).map(String))];
    if (supportingIds.some((id) => counterIds.includes(id))) throw new Error(`${unitId} 同一事实不能同时标记为支持与反证`);
    const evidenceIds = [...new Set([...supportingIds, ...counterIds])];
    if (!evidenceIds.length) throw new Error(`${unitId} 至少需要一条已批准事实`);
    for (const id of evidenceIds) {
      const fact = factById.get(id);
      if (!fact) throw new Error(`${unitId} 引用了不存在或 gap 的事实 ${id}`);
      if (!(fact.judgment_unit_ids || []).map(String).includes(unitId)) throw new Error(`${id} 未在 Stage03 绑定 ${unitId}`);
    }
    return {
      ...input,
      judgment_unit_id: unitId,
      conclusion: input.conclusion.trim(),
      evidence_draft_ids: evidenceIds,
      supporting_evidence_draft_ids: supportingIds,
      counter_evidence_draft_ids: counterIds,
      confirmed_precondition_ids: [...new Set((input.confirmed_precondition_ids || []).map(String))],
    };
  });

  const inputByUnit = new Map(normalizedInputs.map((input) => [input.judgment_unit_id, input]));
  for (const unitId of unitById.keys()) {
    if (!inputByUnit.has(unitId)) throw new Error(`受控判断投影不得遗漏 JudgmentUnit ${unitId}`);
  }
  const recordedAt = new Date().toISOString();
  const ids = new Map(normalizedInputs.map((input, index) => [input.judgment_unit_id, {
    judgment: `J-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    supportSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-S`,
    weakenSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-W`,
    hypothesis: `H-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    competition: `CE-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    trace: `RT-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
  }]));

  const methodRegistry = loadMethodRegistry();
  const applications: MethodApplication[] = (evidence.method_applications || []).map((application: MethodApplication) => {
    const boundInputs = application.target_judgment_unit_refs.map((unitId) => inputByUnit.get(unitId)).filter(Boolean) as ControlledJudgmentInput[];
    const evidenceRefs = [...new Set(boundInputs.flatMap((input) => input.evidence_draft_ids || []))];
    const judgmentRefs = [...new Set(application.target_judgment_unit_refs.map((unitId) => ids.get(unitId)?.judgment).filter(Boolean))] as string[];
    const signalRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => {
      const input = inputByUnit.get(unitId);
      const unitIds = ids.get(unitId);
      return [
        input?.supporting_evidence_draft_ids?.length ? unitIds?.supportSignal : null,
        input?.counter_evidence_draft_ids?.length ? unitIds?.weakenSignal : null,
      ].filter(Boolean);
    }))] as string[];
    if (!evidenceRefs.length) throw new Error(`${application.application_id} 没有可执行的事实输入`);
    const registeredPreconditions = methodRegistry.get(application.method_id)?.preconditions || [];
    const confirmed = new Set(boundInputs.flatMap((input) => input.confirmed_precondition_ids || []));
    const automaticallyConfirmed = new Set(["controlled_source_verification", "judgment_unit", "object_scope"]);
    const missingPreconditions = registeredPreconditions.filter((precondition) => !confirmed.has(precondition) && !automaticallyConfirmed.has(precondition));
    const checks = registeredPreconditions.length
      ? registeredPreconditions.map((precondition) => {
        const passed = confirmed.has(precondition) || automaticallyConfirmed.has(precondition);
        return {
          precondition_id: precondition,
          result: passed ? "pass" as const : "fail" as const,
          evidence_refs: evidenceRefs,
          reason: passed
            ? (automaticallyConfirmed.has(precondition) ? "由已批准结构或来源冻结合同确定性确认" : "研究者在受控裁决中显式确认，并绑定已批准事实")
            : "研究者未显式确认该语义前置条件；抓取成功不能代替方法适用性",
        };
      })
      : [{
        precondition_id: "controlled_judgment_input",
        result: "pass" as const,
        evidence_refs: evidenceRefs,
        reason: "该方法无额外登记前置条件；输入只来自已批准事实",
      }];
    const executed = missingPreconditions.length === 0;
    return {
      ...application,
      status: executed ? "executed" as const : "degraded" as const,
      precondition_checks: checks,
      input_evidence_refs: evidenceRefs,
      output_signal_refs: application.capability_type === "evidence" ? signalRefs : [],
      output_judgment_refs: application.capability_type === "evidence" ? [] : judgmentRefs,
      execution_summary: executed
        ? `基于 ${evidenceRefs.join("、")} 完成受控 ${application.capability_type} 执行；方向与证据上限由 Runtime 再校验`
        : `未执行：缺少显式确认的语义前置条件 ${missingPreconditions.join("、")}`,
      limitations: [...new Set([...(application.limitations || []), ...(executed ? [] : [`方法前置条件未满足：${missingPreconditions.join("、")}`])])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "human-controlled-judgment-projection",
        recorded_at: recordedAt,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : executed ? [] : [{ method_id: application.method_id, decision: "retry_after_precondition_confirmation", reason: "补齐并确认语义前置条件后重试" }],
    };
  });

  const signals = normalizedInputs.flatMap((input) => [
    input.supporting_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.supportSignal,
      statement: `已批准事实支持待检验结论：${input.conclusion}`,
      role: "support" as const,
      evidence_draft_ids: input.supporting_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
    input.counter_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.weakenSignal,
      statement: `已批准事实削弱或限制待检验结论：${input.conclusion}`,
      role: "weaken" as const,
      evidence_draft_ids: input.counter_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
  ].filter(Boolean)) as any[];
  const hypotheses = normalizedInputs.map((input) => ({
    id: ids.get(input.judgment_unit_id)!.hypothesis,
    statement: input.conclusion,
    signal_ids: [
      input.supporting_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.weakenSignal : null,
    ].filter(Boolean) as string[],
    falsification_conditions: input.invalidation_conditions?.length
      ? [...new Set(input.invalidation_conditions.map(String))]
      : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
    time_horizon: "仅限 Stage01 冻结的研究截止时点与范围",
    judgment_unit_ids: [input.judgment_unit_id],
  }));
  const structureCandidates = normalizeCompetingExplanations(structure.competing_explanations, {
    unitIds: [...unitById.keys()],
  });
  const competingExplanations = normalizedInputs.flatMap((input) => {
    const unitIds = ids.get(input.judgment_unit_id)!;
    const signalIds = [
      input.supporting_evidence_draft_ids?.length ? unitIds.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? unitIds.weakenSignal : null,
    ].filter(Boolean) as string[];
    const discriminating = input.discriminating_evidence?.length
      ? [...new Set(input.discriminating_evidence.map(String))]
      : ["取得跨期、同口径且来源独立的后续观察，检验当前信号是否延续并排除短期扰动"];
    const status = input.counterevidence_resolution ? "weakened" as const : "active" as const;
    const eliminationRationale = input.counterevidence_resolution
      ? `研究者记录的有限裁决：${input.counterevidence_resolution}；竞争解释仍不得标记为 eliminated`
      : "尚未取得足以排除该解释的区分性证据";
    const bound = competingExplanationsForUnit(structureCandidates, input.judgment_unit_id);
    const primarySourceId = String(input.source_explanation_id || bound[0]?.explanation_id || "").trim();
    const primarySource = bound.find((item) => item.explanation_id === primarySourceId) || bound[0];
    const primaryStatement = String(input.competing_explanation || primarySource?.statement || "观察到的变化可能来自短期扰动、口径差异或提前行为，而非待检验的可持续机制");
    const primary = {
      id: unitIds.competition,
      statement: primaryStatement,
      signal_ids: signalIds,
      discriminating_evidence: discriminating,
      status,
      elimination_rationale: eliminationRationale,
      source_explanation_id: primarySource?.explanation_id,
      judgment_unit_ids: [input.judgment_unit_id],
    };
    const extras = bound
      .filter((item) => item.explanation_id !== primary.source_explanation_id)
      .map((item, index) => ({
        id: `${unitIds.competition}-S${String(index + 2).padStart(2, "0")}`,
        statement: item.statement,
        signal_ids: signalIds,
        discriminating_evidence: discriminating,
        status: "active" as const,
        elimination_rationale: "来自 Stage02 结构候选；本轮未作为主裁决竞争解释编辑",
        source_explanation_id: item.explanation_id,
        judgment_unit_ids: [input.judgment_unit_id],
      }));
    return [primary, ...extras];
  });
  const sourceRecords = new Map(listSources(runId).map((source) => [source.id, source]));
  const judgments = normalizedInputs.map((input) => {
    const unit = unitById.get(input.judgment_unit_id);
    const applicationIds = applications
      .filter((application: MethodApplication) => application.target_judgment_unit_refs.includes(input.judgment_unit_id))
      .map((application: MethodApplication) => application.application_id);
    const inputFacts = (input.evidence_draft_ids || []).map((id) => factById.get(id)).filter(Boolean);
    const sourceGroups = new Set(inputFacts.flatMap((fact) => fact.source_ids || []).map((sourceId) => {
      const source = sourceRecords.get(String(sourceId));
      return source?.source_group || source?.publisher || source?.normalized_url || String(sourceId);
    }));
    const unresolvedConflict = Boolean(input.supporting_evidence_draft_ids?.length && input.counter_evidence_draft_ids?.length && !String(input.counterevidence_resolution || "").trim());
    const executedAdjudication = applications.some((application) => application.capability_type === "adjudication"
      && application.status === "executed" && application.target_judgment_unit_refs.includes(input.judgment_unit_id));
    const blockedByMethod = !executedAdjudication;
    const strength = unresolvedConflict || blockedByMethod ? "J0" as const : inputFacts.length >= 2 && sourceGroups.size >= 2 ? "J2" as const : "J1" as const;
    const decisionStatus = unresolvedConflict ? "contested" as const : blockedByMethod ? "indeterminate" as const : "supported" as const;
    const stopReason = unresolvedConflict
      ? "支持与反向证据并存，尚缺能够区分短期扰动与可持续改善的后续同口径证据"
      : blockedByMethod ? "裁决方法的语义前置条件未被显式确认，不能把已抓取来源直接升级为判断" : null;
    const defaultRationale = unresolvedConflict
      ? "支持证据与反向证据同时存在，且没有记录足以解决冲突的区分性证据；结论保持 J0/contested"
      : blockedByMethod
        ? "事实已登记，但裁决方法前置条件未满足；结论保持 J0/indeterminate"
        : `仅依据已批准事实 ${input.evidence_draft_ids?.join("、")} 形成受控判断；共 ${inputFacts.length} 条事实、${sourceGroups.size} 个来源组，强度上限为 ${strength}`;
    const researcherRationale = String(input.rationale || "").trim();
    const defaultConditions = ["只在已批准事实、冻结截止时间与所列适用范围内成立；不自动外推原因、持续性、行业全面性或投资建议"];
    const customConditions = (input.conditions || []).map(String).map((item) => item.trim()).filter(Boolean);
    const defaultTracking = [...new Set([...(input.discriminating_evidence || []), ...(input.invalidation_conditions || [])])];
    const customTracking = (input.tracking_signals || []).map(String).map((item) => item.trim()).filter(Boolean);
    return {
      id: ids.get(input.judgment_unit_id)!.judgment,
      judgment_unit_id: input.judgment_unit_id,
      title: String(unit.title || input.judgment_unit_id),
      conclusion: input.conclusion,
      rationale: (unresolvedConflict || blockedByMethod) ? defaultRationale : (researcherRationale || defaultRationale),
      strength,
      confidence: strength === "J2" ? "medium" as const : "low" as const,
      decision_status: decisionStatus,
      conflict_status: unresolvedConflict ? "unresolved" as const : input.counter_evidence_draft_ids?.length ? "resolved" as const : "none" as const,
      not_judgeable_reason: stopReason,
      scope_ref: String(unit.scope_ref || structure.research_scope?.id),
      cutoff_at: normalizeBusinessCutoff(parseJson<any>(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {}).time_scope?.as_of)!,
      conditions: customConditions.length ? customConditions : defaultConditions,
      supporting_evidence_draft_ids: input.supporting_evidence_draft_ids || [],
      counter_evidence_draft_ids: input.counter_evidence_draft_ids || [],
      hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
      rule_evaluation_ids: [],
      method_application_ids: applicationIds,
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: [...new Set([...(input.uncertainties || []), ...(sourceGroups.size < 2 ? ["当前事实缺少两个独立来源组的交叉验证"] : [])])],
      invalidation_conditions: input.invalidation_conditions?.length
        ? [...new Set(input.invalidation_conditions.map(String))]
        : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
      tracking_signals: customTracking.length ? [...new Set(customTracking)] : [...new Set(defaultTracking)],
    };
  });
  const reasoningTraces = judgments.map((judgment) => ({
    id: ids.get(judgment.judgment_unit_id)!.trace,
    judgment_id: judgment.id,
    node_ids: [...new Set([
      judgment.scope_ref,
      judgment.judgment_unit_id,
      ...judgment.supporting_evidence_draft_ids,
      ...judgment.counter_evidence_draft_ids,
      ...judgment.hypothesis_ids,
      ...signals.filter((signal) => signal.judgment_unit_ids.includes(judgment.judgment_unit_id)).map((signal) => signal.id),
      ...judgment.method_application_ids,
      judgment.id,
    ])],
    created_at: recordedAt,
  }));
  const data: any = {
    method_applications: applications,
    signals,
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: [],
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "受控裁决只使用已批准事实；未解决的支持/反向证据冲突保持 J0/contested，已形成方向的判断也不外推原因、持续性、行业全面性或投资建议。",
    object_differentiation: judgments
      .map((judgment) => `${judgment.title}：${judgment.conclusion}（${judgment.strength}）`)
      .join("；"),
    primary_path_ruling: normalizedInputs
      .map((input) => `${unitById.get(input.judgment_unit_id)?.title || input.judgment_unit_id}：${input.rationale || input.conclusion}`)
      .join("；"),
    investment_proposition: [
      "研究含义仅限分对象识别景气、供需与持续性差异，不直接生成个股买卖、目标价或仓位建议。",
      ...normalizedInputs.map((input) =>
        `${unitById.get(input.judgment_unit_id)?.title || input.judgment_unit_id}的改判条件：${(input.invalidation_conditions || []).slice(0, 2).join("；") || "取得同口径反向事实"}`),
    ].join(" "),
    expression_permission: {
      allowed_core_claims: judgments.filter((judgment) => judgment.strength !== "J0").map((judgment) => judgment.id),
      restricted_claims: judgments.filter((judgment) => judgment.strength === "J0").map((judgment) => judgment.id),
      prohibited_claims: ["个股买卖建议", "目标价或仓位建议", "把分对象结论外推成行业全面复苏", "超过 Runtime 裁决强度的确定性表述"],
      allowed_mechanisms: judgments.filter((judgment) => judgment.strength !== "J0").map((judgment) => judgment.conclusion),
      restricted_phrasing: ["来源预测必须保留预测属性", "条件判断不得写成确定结果", "不得省略竞争解释和改判条件"],
      max_expression_level: ["J4", "J3", "J2", "J1", "J0"]
        .find((level) => judgments.some((judgment) => judgment.strength === level)) || "J0",
      notes: "05 只能展开已获许可的 Judgment，不得新增事实、抬高强度或把合规停止句冒充研究结论。",
    },
    document_markdown: [
      "# 受控判断结果",
      "",
      ...judgments.map((judgment) => `- ${judgment.title}：${judgment.conclusion}（${judgment.strength}；${judgment.supporting_evidence_draft_ids.join("、")}）`),
      "",
      "## 总体边界",
      "",
      "未解决的证据冲突保持 J0/contested；其余判断的强度由事实数量、来源组和 Runtime 确定性规则共同限制。受控路径不把研究者填写的结论自动升级为强判断。",
    ].join("\n"),
  };
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  data.object_differentiation = data.judgments
    .map((judgment: any) => `${judgment.title}：${judgment.conclusion}（${judgment.strength}）`)
    .join("；");
  data.expression_permission.allowed_core_claims = data.judgments
    .filter((judgment: any) => judgment.strength !== "J0").map((judgment: any) => judgment.id);
  data.expression_permission.restricted_claims = data.judgments
    .filter((judgment: any) => judgment.strength === "J0").map((judgment: any) => judgment.id);
  data.expression_permission.allowed_mechanisms = data.judgments
    .filter((judgment: any) => judgment.strength !== "J0").map((judgment: any) => judgment.conclusion);
  data.expression_permission.max_expression_level = ["J4", "J3", "J2", "J1", "J0"]
    .find((level) => data.judgments.some((judgment: any) => judgment.strength === level)) || "J0";
  // 先生成可读正文，再以正文密度和确定性规则结果争取 high_quality；
  // controlled projection 不依赖模型自报 quality_status。
  syncStage04ReadableMarkdown(data, { question: run.question, taskId: runId, forceProjection: true });
  data.quality_status = "high_quality_pass";
  data.deterministic_check_status = "checked";
  data.reasoning_audit_yaml = "";
  ensureStage04DocumentFields(data, { question: run.question, taskId: runId, manifestCtx: manifestContextFromRun(run) });
  syncStage04ReadableMarkdown(data, { question: run.question, taskId: runId, forceProjection: true });
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-judgment-projection`,
    knowledge_version: "runtime-controlled-judgment-projection-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      judgments: inputs,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-judgment-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, judgment_count: judgments.length, deterministic_rules: true }),
    error_message: null,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

export function buildJudgmentGapFallback(structure: any, evidence: any, reason: string) {
  const gapsByUnit = new Map<string, string[]>();
  for (const gap of evidence.evidence_drafts || []) {
    for (const unitId of gap.judgment_unit_ids || []) {
      gapsByUnit.set(unitId, [...(gapsByUnit.get(unitId) || []), gap.id]);
    }
  }
  const applications = (evidence.method_applications || []).map((application: MethodApplication) => {
    const gapRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => gapsByUnit.get(unitId) || []))];
    return {
      ...application,
      status: "blocked" as const,
      precondition_checks: [{
        precondition_id: "fact_level_evidence_available",
        result: "fail" as const,
        evidence_refs: gapRefs,
        reason,
      }],
      input_evidence_refs: gapRefs,
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      limitations: [...new Set([...(application.limitations || []), "上游只有证据缺口，没有可用于执行的方法输入事实"])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "runtime-j0-fallback",
        recorded_at: null,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : [{ method_id: application.method_id, decision: "retry_after_evidence", reason: "补齐事实级证据后重试同一登记方法" }],
    };
  });
  const scopeRef = String(structure.research_scope?.id || "SCOPE-UNRESOLVED");
  const cutoff = new Date().toISOString();
  const hypotheses: any[] = [];
  const competingExplanations: any[] = [];
  const ruleEvaluations: any[] = [];
  const judgments: any[] = [];
  const reasoningTraces: any[] = [];
  for (const [index, unit] of (structure.judgment_units || []).entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    const hypothesisId = `H-J0-${suffix}`;
    const explanationId = `CE-J0-${suffix}`;
    const judgmentId = `J-J0-${suffix}`;
    const ruleId = `RE-SYS-PLACEHOLDER-${suffix}`;
    const adjudication = applications.find((application: MethodApplication) =>
      application.capability_type === "adjudication" && application.target_judgment_unit_refs.includes(unit.id));
    if (!adjudication) throw new Error(`${unit.id} 缺少 adjudication MA，不能生成 J0 降级判断`);
    const requirements = unit.evidence_requirements?.length ? unit.evidence_requirements : ["事实级证据"];
    hypotheses.push({
      id: hypothesisId,
      statement: `${unit.title} 的方向命题目前未被事实级证据检验`,
      signal_ids: [],
      falsification_conditions: requirements.map((item: string) => `取得并核验：${item}`),
      time_horizon: "补齐证据后重新裁决",
      judgment_unit_ids: [String(unit.id)],
    });
    const stage02Candidates = competingExplanationsForUnit(
      normalizeCompetingExplanations(structure.competing_explanations, { unitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id)) }),
      String(unit.id),
    );
    if (stage02Candidates.length) {
      for (const [candidateIndex, candidate] of stage02Candidates.entries()) {
        competingExplanations.push({
          id: candidateIndex === 0 ? explanationId : `${explanationId}-S${String(candidateIndex + 1).padStart(2, "0")}`,
          statement: candidate.statement,
          signal_ids: [],
          discriminating_evidence: requirements,
          status: "unknown" as const,
          elimination_rationale: "没有事实级 Signal，不能排除任何竞争解释",
          source_explanation_id: candidate.explanation_id,
          judgment_unit_ids: [String(unit.id)],
        });
      }
    } else {
      competingExplanations.push({
        id: explanationId,
        statement: `${unit.title} 可能改善、恶化或分化，当前均无法排除`,
        signal_ids: [],
        discriminating_evidence: requirements,
        status: "unknown" as const,
        elimination_rationale: "没有事实级 Signal，不能排除任何竞争解释",
        judgment_unit_ids: [String(unit.id)],
      });
    }
    ruleEvaluations.push({
      id: ruleId,
      rule_ref: "judgment_status_consistency",
      input_refs: [judgmentId],
      condition_results: [{
        condition_id: "j0_gap_path",
        expression: "gap_only => J0/indeterminate",
        input_refs: [judgmentId],
        outcome: "pass" as const,
        rationale: "上游只有 gap，判断保持 J0/indeterminate",
      }],
      result: "pass" as const,
      deterministic_result: null,
    });
    judgments.push({
      id: judgmentId,
      judgment_unit_id: unit.id,
      title: `${unit.title}：暂不可判断`,
      conclusion: "当前暂不可形成方向判断",
      rationale: `${reason}；没有可核验 EvidenceFact 或 Signal，禁止输出支持、削弱或趋势方向。`,
      strength: "J0" as const,
      confidence: "low" as const,
      decision_status: "indeterminate" as const,
      conflict_status: "none" as const,
      not_judgeable_reason: `缺少：${requirements.join("；")}`,
      scope_ref: scopeRef,
      cutoff_at: cutoff,
      conditions: ["仅当事实级证据补齐并重新执行裁决方法后才能升级"],
      supporting_evidence_draft_ids: [],
      counter_evidence_draft_ids: [],
      hypothesis_ids: [hypothesisId],
      rule_evaluation_ids: [ruleId],
      method_application_ids: [adjudication.application_id],
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: requirements,
      invalidation_conditions: ["取得足以形成至少 J1 的可核验事实级证据"],
      tracking_signals: requirements,
    });
    reasoningTraces.push({
      id: `RT-J0-${suffix}`,
      judgment_id: judgmentId,
      node_ids: [unit.id, hypothesisId, ruleId, adjudication.application_id, judgmentId],
      created_at: cutoff,
    });
  }
  return {
    method_applications: applications,
    signals: [],
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: ruleEvaluations,
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "上游只有经人工接受的证据缺口；本产物只登记 J0/暂不可判断，不包含任何方向性结论。",
    document_markdown: `# 判断降级结果\n\n上游 03 只有证据缺口，没有可核验事实。系统因此将全部方法收敛为 blocked，并为 ${judgments.length} 个判断单元生成 J0/暂不可判断结果。该结果仍需逐项人工审阅，不能被表达为行业方向或价格预测。\n\n失败原因：${reason}`,
  };
}

export function createJudgmentGapFallback(runId: string, reason: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  if ((evidence.evidence_drafts || []).some((item: any) => item.kind !== "gap")) {
    throw new Error("上游存在事实级证据，不能使用全量 J0 降级；请重新运行正常裁决");
  }
  const data = buildJudgmentGapFallback(structure, evidence, reason);
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  syncStage04ReadableMarkdown(data, { question: run.question, taskId: runId });
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:explicit-j0-fallback`,
    knowledge_version: `sha256:${createHash("sha256").update(JSON.stringify({
      mode: "deterministic_j0_gap_fallback",
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      reason,
    })).digest("hex")}`,
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      fact_count: 0,
      fallback_reason: reason,
      governance_version_note: "deterministic fallback fingerprint covers upstream artifact hashes + reason",
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-j0-fallback",
    tool_usage: JSON.stringify({ degraded: true, failure_category: "model_output_error", reason }),
    error_message: `[model_output_error] ${reason}；已降级为 J0 判断，尚未确认`,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

/**
 * Stage05 投影对齐：校验 claim↔judgment，必要时补齐字段与审计 YAML。
 * 不得整篇覆盖 LLM/人工研报正文为「研究判断简报」骨架。
 * options.forceDeterministicSkeleton=true 仅用于 deterministic_projection 草稿路径。
 */
