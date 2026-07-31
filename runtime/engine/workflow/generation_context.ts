import { createHash } from "node:crypto";
import "server-only";
import { latestArtifact, listSources, quarantineUnboundWebCitations } from "../../adapters/db";
import { assembleStageContext, buildSemanticRoute, clipUpstreamJsonSoft, CONTEXT_SLOT_BUDGETS } from "../context_assembler";
import { evidenceBoundSourceIds, evidenceBoundSources } from "../evidence_sources";
import { buildGovernanceFingerprint } from "../governance_fingerprint";
import { formalOntologyRuleIds } from "../judgment_draft_normalize";
import {
  buildStageGenerationGuidance,
  evidenceJudgmentTypeCardsForPrompt,
  executedMethodsSummary,
  judgmentThresholdCapsForPrompt,
  mcpChannelHintsForPrompt,
  methodDisciplineDigest,
} from "../method_guidance";
import { methodRoutesForPrompt } from "../method_registry";
import { loadOntologyCatalog } from "../ontology_catalog";
import { ontologyContextForPrompt, ontologyPromptSourceFiles } from "../ontology_tools";
import { promptFor } from "../prompts";
import { summarizeInjectedAssets } from "../runtime_asset_coverage";
import { pendingClarificationQuestion } from "../stage01_contract";
import { parseJson, type ArtifactKind, type StageKind } from "../types";
import {
  methodCandidatesForPrompt,
  sourceForFrozenBaseline,
  sourcesForPrompt,
  upstreamJudgmentTypes,
} from "../workflow_shared";
import { compactStage03ForUpstream, compactStage04ForStage05, compactStructuredArtifact } from "../workflow_support";

export function buildGenerationContext(input: {
  runId: string;
  kind: ArtifactKind;
  run: { id: string; question: string; domain: string; package_path: string | null };
}) {
  const { runId, kind, run } = input;
  const dependencyStages: Partial<Record<ArtifactKind, StageKind[]>> = {
    stage_01: [],
    stage_02: ["stage_01"],
    stage_03: ["stage_01", "stage_02"],
    stage_04: ["stage_02", "stage_03"],
    stage_05: ["stage_01", "stage_03", "stage_04"],
    baseline: [],
    independent_review: ["stage_02", "stage_03", "stage_04"],
  };
  const upstreamStages = dependencyStages[kind] || [];
  const upstreamRaw = upstreamStages
    .map((s) => latestArtifact(runId, s, ["approved"]))
    .filter(Boolean)
    .map((a) => {
      const raw = parseJson(a!.json_content, {});
      const compressed = a!.kind === "stage_03" && ["stage_04", "stage_05", "independent_review"].includes(kind)
        ? compactStage03ForUpstream(raw)
        : a!.kind === "stage_04" && kind === "stage_05"
          ? compactStage04ForStage05(raw)
          : compactStructuredArtifact(raw);
      return {
        artifact_id: a!.id,
        artifact_hash: createHash("sha256").update(a!.json_content).digest("hex"),
        model_name: a!.model_name,
        kind: a!.kind,
        json: compressed,
      };
    });
  const upstreamClip = clipUpstreamJsonSoft(upstreamRaw, CONTEXT_SLOT_BUDGETS.upstream_json_soft);
  const upstream = upstreamClip.value;
  const approvedEvidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  const approvedEvidence: any = approvedEvidenceArtifact
    ? parseJson(approvedEvidenceArtifact.json_content, {})
    : undefined;
  if (approvedEvidence && kind !== "stage_03") {
    quarantineUnboundWebCitations(runId, evidenceBoundSourceIds(approvedEvidence));
  }
  const allSources = listSources(runId);
  const isEvidenceConsumer = ["stage_04", "stage_05", "baseline", "independent_review"].includes(kind);
  const frozenSources = isEvidenceConsumer && approvedEvidence
    ? evidenceBoundSources(allSources, approvedEvidence)
    : [];
  const taskContext: any = upstream.find((item) => item.kind === "stage_01")?.json
    || parseJson(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {});
  const deliveryArchetype = String(
    taskContext?.delivery_archetype?.primary
    || "industry_cycle_report",
  );
  const routePreview = buildSemanticRoute(upstream);
  const ontologyRaw = ontologyContextForPrompt(runId, {
    focusNodeIds: routePreview.ontology_node_ids,
    focusJudgmentUnitIds: routePreview.judgment_unit_ids,
  });
  const assembled = assembleStageContext({
    kind,
    upstream,
    ontologyObjectSet: ontologyRaw,
    deliveryArchetype,
  });
  const judgmentTypesForKnowledge = assembled.semantic_route.judgment_types.length
    ? assembled.semantic_route.judgment_types
    : upstreamJudgmentTypes(upstream);
  const knowledge = {
    version: assembled.knowledge_version,
    context: assembled.knowledge_context,
    files: assembled.knowledge_files,
  };
  const promptSources = sourcesForPrompt(kind, allSources, taskContext?.time_scope?.as_of);
  // Plan A：抓取全文只存 Source Registry（DB snapshot_text），绝不进入模型上下文。
  // 上下文仅保留“指针 + ≤300 字逐字引文窗口”，模型照样能照抄 ≥20 字原文；
  // 同时把写进 artifact.input_context 的体量从 ~12k/源压到几百字/源。
  const SOURCE_CITATION_WINDOW_CHARS = 300;
  const sourceContext = promptSources.map((source) => {
    const { snapshot_text: _omit, ...sourceWithoutSnapshot } = source;
    void _omit;
    return {
      ...sourceWithoutSnapshot,
      citation_window: String(source.source_quote || source.search_excerpt || "").slice(0, SOURCE_CITATION_WINDOW_CHARS),
    };
  });
  // 同证据基线只能看到 Stage03 已登记的逐字引文，不能从完整快照
  // 额外开采主链未登记的新事实，否则“同证据”比较失真。
  const frozenSourceContext = frozenSources.map(sourceForFrozenBaseline);
  const ontologyContext = assembled.ontology_object_set;
  const frozenEvidenceArtifact = kind === "baseline" ? approvedEvidenceArtifact : undefined;
  const frozenEvidence: any = frozenEvidenceArtifact ? parseJson(frozenEvidenceArtifact.json_content, {}) : undefined;
  const priorStage01 = kind === "stage_01"
    ? latestArtifact(runId, "stage_01", ["needs_review", "approved"])
    : null;
  const priorStage01Data = priorStage01 ? parseJson<any>(priorStage01.json_content, {}) : null;
  const methodCandidates = methodCandidatesForPrompt(kind, upstream, run.question);
  // C1 修复：将方法关键纪律提取为文本，注入 system prompt 前面，避免模型忽略 JSON 深处的方法正文
  const methodDigest = (kind === "stage_02" || kind === "stage_03" || kind === "stage_04")
    ? methodDisciplineDigest(methodCandidates)
    : "";
  const systemPrompt = methodDigest ? `${promptFor(kind)}\n\n${methodDigest}` : promptFor(kind);
  const stageGuidance = (kind === "stage_02" || kind === "stage_03" || kind === "stage_04")
    ? buildStageGenerationGuidance({
      kind,
      candidates: methodCandidates,
      taskText: run.question,
      totalChars: CONTEXT_SLOT_BUDGETS.method_guidance,
    })
    : undefined;
  const selectedMethodGuidance = stageGuidance?.selected_method_guidance;
  const scenarioCardIds = stageGuidance?.scenario_card_ids || [];
  const stage04Json: any = kind === "stage_05"
    ? (upstream.find((item) => item.kind === "stage_04")?.json
      || parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {}))
    : undefined;
  const stage03UpstreamJson: any = kind === "stage_04" || kind === "stage_05"
    ? (upstream.find((item) => item.kind === "stage_03")?.json
      || parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {}))
    : undefined;
  const injectedAssets = summarizeInjectedAssets({
    knowledge_files: knowledge.files,
    ontology_files: ontologyPromptSourceFiles(),
    method_guidance: selectedMethodGuidance,
    scenario_card_ids: scenarioCardIds,
    structured_keys: [
      kind === "stage_03" || kind === "stage_04" ? "judgment_method_routes" : "",
      kind === "stage_03" || kind === "stage_04" ? "judgment_threshold_caps" : "",
      kind === "stage_03" ? "mcp_channel_hints" : "",
      kind === "stage_05" ? "expression_permission_from_04" : "",
      kind === "stage_05" ? "executed_methods_summary" : "",
      kind === "stage_05" ? "allowed_05_output_from_03" : "",
    ].filter(Boolean),
  });
  const { governance_version: governanceVersion, detail: governanceDetail } = buildGovernanceFingerprint({
    knowledge_source_version: assembled.knowledge_source_version,
    knowledge_injected_version: assembled.knowledge_version,
    knowledge_files: knowledge.files,
    knowledge_file_injections: assembled.file_injections,
    ontology_source_version: loadOntologyCatalog().fingerprint,
    ontology_injected_text: ontologyContext,
    ontology_files: injectedAssets.ontology_files,
    method_guidance: selectedMethodGuidance,
    scenario_card_ids: scenarioCardIds,
    structured_keys: injectedAssets.structured_keys,
    route: {
      judgment_types: assembled.semantic_route.judgment_types,
      ontology_node_ids: assembled.semantic_route.ontology_node_ids,
      judgment_unit_ids: assembled.semantic_route.judgment_unit_ids,
    },
  });
  const allowed05From03 = String(stage03UpstreamJson?.allowed_05_output || "");
  const inputContext = JSON.stringify(
    {
      question: run.question,
      domain: run.domain,
      package_path: run.package_path,
      upstream,
      semantic_route: assembled.semantic_route,
      context_assembly: {
        note: assembled.assembly_note,
        budgets: assembled.budgets,
        knowledge_version: assembled.knowledge_version,
        knowledge_source_version: assembled.knowledge_source_version,
        governance_version: governanceVersion,
        governance_libraries: governanceDetail,
        standards_loading: assembled.standards_loading,
        file_injections: assembled.file_injections,
        injected_assets: injectedAssets,
        upstream_json: {
          clipped: upstreamClip.clipped,
          original_chars: upstreamClip.original_chars,
          final_chars: upstreamClip.final_chars,
        },
      },
      clarification_state: kind === "stage_01" && priorStage01Data
        ? {
          previous_artifact_id: priorStage01?.id,
          task_disposition: priorStage01Data.task_disposition,
          input_resolution: priorStage01Data.input_resolution,
          pending_question: pendingClarificationQuestion(priorStage01Data),
          pending_questions: (priorStage01Data?.input_resolution?.clarifications || [])
            .filter((item: any) => !item?.answer),
        }
        : undefined,
      // 04/05/独立审阅只能看到 Stage03 已批准并冻结的逐字引文。
      // 完整 snapshot 会让后续模型重新开采未登记事实，既破坏同证据边界，
      // 也把输入放大到数十万 token。
      sources: kind === "baseline"
        ? undefined
        : isEvidenceConsumer
          ? frozenSourceContext
          : sourceContext,
      frozen_evidence: kind === "baseline" ? {
        artifact_id: frozenEvidenceArtifact?.id,
        artifact_version: frozenEvidenceArtifact?.version,
        artifact_hash: frozenEvidenceArtifact ? createHash("sha256").update(frozenEvidenceArtifact.json_content).digest("hex") : null,
        evidence_drafts: frozenEvidence?.evidence_drafts || [],
        source_registry: frozenSourceContext,
      } : undefined,
      ontology_object_set: ontologyContext,
      method_candidates: methodCandidates,
      selected_method_guidance: selectedMethodGuidance,
      scenario_card_ids: scenarioCardIds.length ? scenarioCardIds : undefined,
      judgment_method_routes: kind === "stage_02" || kind === "stage_03" || kind === "stage_04"
        ? methodRoutesForPrompt()
        : undefined,
      judgment_threshold_caps: kind === "stage_03" || kind === "stage_04"
        ? judgmentThresholdCapsForPrompt()
        : undefined,
      evidence_judgment_type_cards: kind === "stage_03"
        ? evidenceJudgmentTypeCardsForPrompt(judgmentTypesForKnowledge)
        : undefined,
      mcp_channel_hints: kind === "stage_03" ? mcpChannelHintsForPrompt() : undefined,
      executed_methods_summary: kind === "stage_05"
        ? executedMethodsSummary(
          upstream.flatMap((item) => (item.json as any)?.method_applications || []),
        )
        : undefined,
      expression_permission_from_04: kind === "stage_05"
        ? (stage04Json?.expression_permission || null)
        : undefined,
      allowed_05_output_from_03: kind === "stage_05" ? (allowed05From03 || null) : undefined,
      gap_report_only: kind === "stage_05" && allowed05From03 === "gap_report_only",
      formal_ontology_rules: kind === "stage_04" ? [...formalOntologyRuleIds()].sort() : undefined,
      delivery_archetype: kind === "stage_05" ? {
        primary: deliveryArchetype,
        secondary: taskContext?.delivery_archetype?.secondary || [],
        modules: taskContext?.delivery_archetype?.modules || [],
        template_hint: deliveryArchetype === "industry_cycle_report"
          ? "delivery/02_模板/05C_行业周期判断模板.md"
          : deliveryArchetype === "event_commentary"
            ? "delivery/02_模板/05A_事件点评模板.md"
            : deliveryArchetype === "industry_dynamic_commentary"
              ? "delivery/02_模板/05B_行业动态点评模板.md"
              : deliveryArchetype === "company_earnings_commentary"
                ? "delivery/02_模板/05D_公司业绩点评模板.md"
                : deliveryArchetype === "theme_deep_dive"
                  ? "delivery/02_模板/05E_主题深度研究模板.md"
                  : "delivery/02_模板/05C_行业周期判断模板.md",
        expression_standard: "delivery/01_标准/05_投研表达标准.md",
        quality_gate_note: "工作台确认 ≠ PUBLISHABLE；正式发布仍须 governance validate_05_outputs / validate_run。",
        gap_report_constraint: allowed05From03 === "gap_report_only"
          ? "上游仅允许缺口报告：只写缺口说明、补证建议与停止理由，不得包装为完整研究报告或方向性洞见。"
          : undefined,
      } : undefined,
      knowledge_files: knowledge.files,
      knowledge_context: knowledge.context,
    },
    null,
    2,
  );
  return {
    upstream,
    frozenSources,
    frozenEvidenceArtifact,
    taskContext,
    deliveryArchetype,
    judgmentTypesForKnowledge,
    stage03UpstreamJson,
    injectedAssets,
    systemPrompt,
    inputContext,
    governanceVersion,
  };
}
