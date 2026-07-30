import "server-only";
import {
createArtifact,
getArtifact,
getRun,
listSources,
supersedeDownstream,
updateArtifact
} from "../adapters/db";
import { loadDomainBusinessGraph } from "./instance_graph";
import {
validateExpressionMethodBindings,
validateJudgmentCapabilityCoverage,
validateJudgmentMethodBindings,
validateMethodApplications,
} from "./method_application";
import { enrichPromptMethodCards } from "./method_guidance";
import {
recallRegisteredMethodCandidates,
registeredMethodCandidates,
validateMethodRoutes,
validateRegisteredMethodApplications
} from "./method_registry";
import {
syncStage01ReadableMarkdown,
syncStage02ReadableMarkdown,
syncStage03ReadableMarkdown,
syncStage04ReadableMarkdown,
syncStage05ReadableMarkdown,
} from "./readable_markdown";
import { validateReasoningTraceBindings } from "./reasoning_trace";
import { syncReviewWorkItems } from "./review_work_items";
import { schemas,type SchemaKind } from "./schemas";
import { applyDeterministicRuleEvaluations } from "./semantic_execution";
import {
approvedSemanticData,
approvedSemanticDataIfPresent,
} from "./semantic_reads";
import { ensureStage05DocumentFields } from "./stage05_documents";
import {
normalizeCompetingExplanations,
normalizeCounterEvidenceDirections,
resolveEvidenceRequirementsFromStructure
} from "./structure_candidates";
import { type ArtifactKind,type SourceRecord } from "./types";

export function stageNumber(kind: ArtifactKind) {
  return kind.startsWith("stage_") ? Number(kind.slice(-2)) : 0;
}

export function equivalentSourceTime(left: unknown, right: unknown) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (leftValue === rightValue) return true;
  const leftTime = Date.parse(leftValue);
  const rightTime = Date.parse(rightValue);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

export function sameStringSet(left: unknown[], right: unknown[]) {
  const leftSet = new Set(left.map(String));
  const rightSet = new Set(right.map(String));
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function validateOntologyVariableBindings(variables: any[]) {
  const stateVariables = new Set(
    (loadDomainBusinessGraph()?.objects || [])
      .filter((object) => object.type === "StateVariable")
      .map((object) => object.id),
  );
  for (const variable of variables || []) {
    const variableId = String(variable?.id || "");
    const nodeId = String(variable?.ontology_node_id || "");
    if (nodeId === `task_local:${variableId}`) continue;
    if (!stateVariables.has(nodeId)) {
      throw new Error(`${variableId}.ontology_node_id=${nodeId} 既不是正式 StateVariable，也不是 task_local:${variableId}；禁止为满足结构而牵强挂靠本体`);
    }
  }
}

export function stage02OntologyObjectIds(data: any): Set<string> {
  return new Set<string>([
    ...(loadDomainBusinessGraph()?.objects || []).map((object) => String(object.id)),
    ...((data?.ontology_instances || []) as any[]).map((item) => String(item?.id || "")),
    ...((data?.variables || []) as any[]).flatMap((item) => [
      String(item?.id || ""),
      String(item?.ontology_node_id || ""),
    ]),
    ...((data?.judgment_units || []) as any[]).flatMap((item) =>
      Array.isArray(item?.ontology_node_ids) ? item.ontology_node_ids.map(String) : []),
  ].filter(Boolean));
}

export function validateGeneratedSemanticDraft(runId: string, kind: ArtifactKind, data: any) {
  if (kind === "stage_02") {
    validateMethodApplications("stage_02", data.method_applications || [], {
      ontologyObjectIds: stage02OntologyObjectIds(data),
    });
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], data.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], data.judgment_units || []);
    validateOntologyVariableBindings(data.variables || []);
    return;
  }
  if (kind === "stage_03") {
    const structure: any = approvedSemanticData(runId, "stage_02");
    const evidenceIds = new Set<string>((data.evidence_drafts || []).map((item: any) => String(item.id)));
    validateMethodApplications("stage_03", data.method_applications || [], {
      prior: structure.method_applications || [],
      evidenceIds,
    });
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], structure.judgment_units || []);
    for (const application of data.method_applications || []) {
      if (application.capability_type === "evidence" && application.status === "candidate") {
        throw new Error(`${application.application_id} 取证 MA 在 stage_03 必须收敛，不能仍为 candidate`);
      }
    }
    return;
  }
  if (kind === "stage_04") {
    const evidence: any = approvedSemanticData(runId, "stage_03");
    const structure: any = approvedSemanticData(runId, "stage_02");
    const evidenceIds = new Set<string>((evidence.evidence_drafts || []).map((item: any) => String(item.id)));
    const judgmentIds = new Set<string>((data.judgments || []).map((item: any) => String(item.id)));
    const signalIds = new Set<string>((data.signals || []).map((item: any) => String(item.id)));
    const sourceGroupById = new Map(listSources(runId).map((source) => [source.id, source.source_group || source.publisher || source.normalized_url]));
    validateMethodApplications("stage_04", data.method_applications || [], {
      prior: evidence.method_applications || [],
      evidenceIds,
      judgmentIds,
      signalIds,
      evidenceDrafts: evidence.evidence_drafts || [],
      sourceGroupById,
    });
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentMethodBindings(data.judgments || [], data.method_applications || []);
    validateReasoningTraceBindings(data, evidenceIds, data.method_applications || []);
    return;
  }
  if (kind === "stage_05") {
    const evidence: any = approvedSemanticData(runId, "stage_03");
    const judgment: any = approvedSemanticData(runId, "stage_04");
    const allowed = String(evidence?.allowed_05_output || "");
    const maxLevel = String(
      judgment?.expression_permission?.max_expression_level
      || judgment?.judgment_level
      || "J0",
    );
    const body = String(data?.document_markdown || "");
    if (allowed === "gap_report_only") {
      const directional = /全面看多|全面看空|确定反转|周期已结束|目标价|买入评级|卖出评级|确定性见顶/.test(body);
      const looksFullReport = /##\s*投资要点/.test(body)
        && /Research Edge|市场认知差/.test(body)
        && (body.match(/^##\s+[一二三四五]、/gm) || []).length >= 2
        && body.length >= 6_000
        && !/缺口说明|证据不足|暂不可判断|补证建议/.test(body);
      if (directional || looksFullReport) {
        throw new Error(
          "allowed_05_output=gap_report_only：禁止将缺口包装为完整研究报告或方向性洞见；仅允许缺口说明、补证建议与停止理由",
        );
      }
    }
    const J_RANK: Record<string, number> = { J0: 0, J1: 1, J2: 2, J3: 3, J4: 4 };
    const maxRank = J_RANK[maxLevel] ?? 0;
    if (maxRank <= 0 && /目标价|买入评级|卖出评级|确定性见顶|周期已确认反转/.test(body)) {
      throw new Error(`expression_permission.max_expression_level=${maxLevel}：正文越权使用高强度方向性措辞`);
    }
    if (Array.isArray(data.expressions) && data.expressions.length) {
      validateExpressionMethodBindings(data.expressions, judgment.method_applications || []);
    }
  }
}


/** 按当前 Stage02/03 与来源注册表重算 Stage04 正式规则；覆盖可编辑的 deterministic_result。 */
export function recomputeStage04DeterministicRules(runId: string, data: any) {
  const evidence: any = approvedSemanticData(runId, "stage_03");
  const structure: any = approvedSemanticData(runId, "stage_02");
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  for (const judgment of data.judgments || []) {
    if (judgment.strength) judgment.level = judgment.strength;
    else if (judgment.level) judgment.strength = judgment.level;
  }
  const run = getRun(runId);
  syncStage04ReadableMarkdown(data, { question: run?.question, taskId: runId });
  return data;
}


export function upstreamJudgmentTypes(upstream: Array<{ json: any }>): string[] {
  return [...new Set(
    upstream.flatMap((item) => (item.json?.judgment_units || []).map((unit: any) => String(unit.judgment_type || ""))).filter(Boolean),
  )];
}

export function methodCandidatesForPrompt(kind: ArtifactKind, upstream: Array<{ json: any }>, taskText = "") {
  const judgmentTypes = upstreamJudgmentTypes(upstream);
  let base;
  if (kind === "stage_02") {
    base = taskText.trim()
      ? recallRegisteredMethodCandidates(taskText)
      : registeredMethodCandidates();
  } else if (kind === "stage_03" || kind === "stage_04") {
    const inheritedMethodIds = new Set<string>(
      upstream.flatMap((item) => (item.json?.method_applications || []).map((application: any) => String(application.method_id))),
    );
    base = registeredMethodCandidates().filter((method) => inheritedMethodIds.has(method.method_id));
  } else {
    return [];
  }
  return enrichPromptMethodCards(base, judgmentTypes);
}

export function sourcesForPrompt(kind: ArtifactKind, sources: SourceRecord[], cutoffAt?: string | null) {
  if (kind !== "stage_03") return [];
  const normalizedCutoff = normalizeBusinessCutoff(cutoffAt);
  const cutoff = normalizedCutoff ? Date.parse(normalizedCutoff) : null;
  return sources.filter((source) => source.usability_status !== "rejected"
    && (cutoff === null || !source.published_at || !Number.isFinite(Date.parse(source.published_at)) || Date.parse(source.published_at) <= cutoff));
}

export function sourceForFrozenBaseline(source: SourceRecord) {
  return { ...source, snapshot_text: source.source_quote || "" };
}

function clampCutoffToAvailableDay(cutoff: string, now: Date): string {
  const cutoffTime = Date.parse(cutoff);
  if (!Number.isFinite(cutoffTime) || cutoffTime <= now.getTime()) return cutoff;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}T23:59:59.999+08:00`;
}

export function normalizeBusinessCutoff(value?: string | null, now = new Date()) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = raw.match(/(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/)
    || raw.match(/(20\d{2})年([01]?\d)月([0-3]?\d)日/);
  if (date) {
    const [, year, month, day] = date;
    return clampCutoffToAvailableDay(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T23:59:59.999+08:00`,
      now,
    );
  }
  const half = raw.match(/(20\d{2})年(上|下)半年/);
  if (half) return clampCutoffToAvailableDay(
    `${half[1]}-${half[2] === "上" ? "06-30" : "12-31"}T23:59:59.999+08:00`,
    now,
  );
  const quarter = raw.match(/(20\d{2})年?第?([一二三四1-4])季度|(?:^|\D)(20\d{2})Q([1-4])/i);
  if (quarter) {
    const year = quarter[1] || quarter[3];
    const token = quarter[2] || quarter[4];
    const index = ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[token] || Number(token);
    const ends = ["03-31", "06-30", "09-30", "12-31"];
    return clampCutoffToAvailableDay(`${year}-${ends[index - 1]}T23:59:59.999+08:00`, now);
  }
  const monthOnly = raw.match(/(20\d{2})年([01]?\d)月(?![0-3]?\d日)/);
  if (monthOnly) {
    const year = Number(monthOnly[1]);
    const month = Number(monthOnly[2]);
    if (month >= 1 && month <= 12) {
      const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return clampCutoffToAvailableDay(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59.999+08:00`,
        now,
      );
    }
  }
  return Number.isFinite(Date.parse(raw))
    ? clampCutoffToAvailableDay(new Date(raw).toISOString(), now)
    : null;
}

export function syncReadableMarkdownForArtifact(artifact: { id: string; run_id: string; kind: string }, data: any): string {
  const run = getRun(artifact.run_id);
  if (artifact.kind === "stage_01") return syncStage01ReadableMarkdown(data, run?.question || "");
  if (artifact.kind === "stage_02") return syncStage02ReadableMarkdown(data);
  if (artifact.kind === "stage_03") {
    const structure: any = approvedSemanticData(artifact.run_id, "stage_02");
    return syncStage03ReadableMarkdown(data, { question: run?.question, taskId: artifact.run_id, structure });
  }
  if (artifact.kind === "stage_04") {
    return syncStage04ReadableMarkdown(data, { question: run?.question, taskId: artifact.run_id });
  }
  if (artifact.kind === "stage_05") {
    const stage04: any = approvedSemanticDataIfPresent(artifact.run_id, "stage_04") || {};
    return syncStage05ReadableMarkdown(data, run?.question || "", listSources(artifact.run_id), {
      taskId: artifact.run_id,
      stage04,
    });
  }
  return String(data.document_markdown || "");
}

export function editArtifact(
  id: string,
  jsonContent: string,
  markdownContent?: string,
  options?: { preferMarkdown?: boolean },
) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error("稿件不存在");
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error("结构化内容不是合法 JSON，无法保存");
  }
  if (artifact.kind === "stage_02") {
    const unitIds = (data.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean);
    data.competing_explanations = normalizeCompetingExplanations(data.competing_explanations, { unitIds });
    data.counter_evidence_directions = normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds });
    data.evidence_requirements = resolveEvidenceRequirementsFromStructure({
      units: data.judgment_units || [],
      evidence_requirements: data.evidence_requirements,
      counter_evidence_directions: data.counter_evidence_directions,
    });
    if (!Array.isArray(data.questions) || !data.questions.length) {
      const statement = String(data.research_scope?.dimensions?.question || data.research_scope?.label || "").trim();
      if (statement) {
        data.questions = [{
          id: "RQ-01",
          question: statement,
          statement,
          scope_ref: String(data.research_scope?.id || "SCOPE-UNRESOLVED"),
          failure_route: "return_to_structure",
        }];
      }
    } else {
      data.questions = data.questions.map((item: any, index: number) => {
        const statement = String(item.question || item.statement || "").trim();
        return {
          id: String(item.id || item.question_id || `RQ-${String(index + 1).padStart(2, "0")}`),
          question: statement,
          statement,
          scope_ref: String(item.scope_ref || data.research_scope?.id || "SCOPE-UNRESOLVED"),
          failure_route: item.failure_route || "return_to_structure",
        };
      });
    }
  }
  if (artifact.kind === "stage_04") {
    recomputeStage04DeterministicRules(artifact.run_id, data);
  }
  const schema = schemas[artifact.kind as SchemaKind];
  const syncedKinds = new Set(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
  const preferMarkdown = Boolean(options?.preferMarkdown) && artifact.kind === "stage_05" && typeof markdownContent === "string";
  const markdown = preferMarkdown
    ? markdownContent!
    : syncedKinds.has(artifact.kind)
      ? syncReadableMarkdownForArtifact(artifact, data)
      : (markdownContent ?? String(data.document_markdown || ""));
  if (syncedKinds.has(artifact.kind) || preferMarkdown) data.document_markdown = markdown;
  if (artifact.kind === "stage_05" && preferMarkdown) {
    const stage04: any = approvedSemanticDataIfPresent(artifact.run_id, "stage_04") || {};
    ensureStage05DocumentFields(data, {
      question: getRun(artifact.run_id)?.question,
      taskId: artifact.run_id,
      stage04,
    });
  }
  if (schema) schema.parse(data);
  const nextJson = JSON.stringify(data, null, 2);

  const stage = stageNumber(artifact.kind);
  if (stage) supersedeDownstream(artifact.run_id, stage);
  if (artifact.status === "approved" || artifact.status === "superseded") {
    const next = createArtifact(artifact.run_id, artifact.kind, {
      status: "needs_review",
      json_content: nextJson,
      markdown_content: markdown,
      model_name: artifact.model_name,
      prompt_version: artifact.prompt_version,
      knowledge_version: artifact.knowledge_version,
      input_context: artifact.input_context,
      raw_model_output: artifact.raw_model_output,
      response_id: artifact.response_id,
      token_usage: artifact.token_usage,
      tool_usage: artifact.tool_usage,
    });
    if (["stage_03", "stage_04", "independent_review"].includes(next.kind)) syncReviewWorkItems(next, data);
    return next;
  }
  return updateArtifact(id, {
    json_content: nextJson,
    markdown_content: markdown,
    status: "needs_review",
    approved_at: null,
  });
}
