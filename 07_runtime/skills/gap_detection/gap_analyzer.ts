import { listSources } from "../../storage/db";
import type { ResearchModelClient } from "../model_client/deepseek_client";
import {
mergeStage03Patch,
normalizeStage03Patch,
objectId,
type Stage03Patch,
} from "../replan/change_set";
import { CONTEXT_SLOT_BUDGETS } from "../../workflow/context_assembler";
import {
buildCapturePriorityKeys,
buildSupplementBrief,
dedupeStage03DraftSources,
findUnchangedEvidenceIds,
trimStage03DraftForModel,
} from "./supplement_pure";
import {
  enrichPromptMethodCards,
  evidenceJudgmentTypeCardsForPrompt,
  evidenceMethodIdsFromApplications,
  loadSelectedMethodGuidance,
  methodDisciplineDigest,
  mcpChannelHintsForPrompt,
} from "../method_selection/method_guidance";
import { loadMethodRegistry, type RegisteredMethod } from "../method_selection/method_registry";
import {
  materializeFrozenStage03CandidateDrafts,
  preAcquireStage03CandidateSources,
  selectFrozenStage03CandidateSources,
} from "./candidate_acquisition";
import { promptForEvidenceSupplement } from "../../agents/shared/prompts_source";
import { controlledEvidencePatchSchema } from "../ontology/revise_schemas";
import { schemas } from "../../schemas/schemas";
import { computeSourceCoverage } from "../evidence_evaluation/source_coverage";
import type { EvidenceRequirementProjection } from "../../agents/02_structure/structure_candidates";
import type { SourceRecord } from "../../schemas/types";
import { repairEvidencePreparationDraft } from "../../workflow/projections";
import {
  enforceStage03AcquisitionHonesty,
  isolateStage03BatchPatch,
  scopeStage03DataForBatch,
} from "../evidence_evaluation/batch_isolation";
import { applyStage03SourceSnapshots } from "../evidence_evaluation/snapshot_apply";

export {
applyRegistryFreezeFields,buildCapturePriorityKeys,
buildSupplementBrief,
buildSupplementCoverage,dedupeStage03DraftSources,evidenceFingerprint,
findUnchangedEvidenceIds,
orderByCapturePriority,selectEvidenceSnapshotExcerpt,syncStage03DraftSourcesFromRegistry
} from "./supplement_pure";
export * from "./acquisition_planning";
export * from "./candidate_acquisition";
export * from "../evidence_evaluation/batch_isolation";
export * from "../evidence_evaluation/snapshot_apply";

/**
 * 补证/取证批次轮的“关键纪律”摘要：把 kb03 方法的产出门禁/最低证据/质量门/必需角色
 * 压成 ~2–4K 文本，注入 system prompt（与主生成路径的 methodDisciplineDigest 对齐）。
 * 作用：让方法级硬性门禁在系统提示里高亮呈现，避免模型只扫 JSON 深处的
 * selected_method_guidance（实测 9 方法正文仅 ~10.6K，完整发送）而漏看强制规则。
 * 成本约 1.9K token/批（占 1M 预算 ~2%），属于质量保险而非省钱项。
 * 同一 run 内 kb03Ids + judgmentTypes 通常稳定，模块级记忆化避免每批次重复解析注册表。
 */
let cachedDisciplineDigest: { key: string; digest: string } | null = null;

function getEvidenceDisciplineDigest(kb03Ids: string[], judgmentTypes: string[]): string {
  const key = `${[...kb03Ids].sort().join(",")}|${[...judgmentTypes].sort().join(",")}`;
  if (cachedDisciplineDigest && cachedDisciplineDigest.key === key) {
    return cachedDisciplineDigest.digest;
  }
  const registry = loadMethodRegistry();
  const cards = enrichPromptMethodCards(
    kb03Ids
      .map((id) => registry.get(id))
      .filter((method): method is RegisteredMethod => Boolean(method)),
    judgmentTypes,
  );
  const digest = methodDisciplineDigest(cards);
  cachedDisciplineDigest = { key, digest };
  return digest;
}

export async function runEvidenceSupplementRound(input: {
  client: ResearchModelClient;
  runId: string;
  baseData: any;
  supplementContext: Record<string, unknown>;
  assertRunning: () => void;
  onProgress?: (event: { round: number; message: string }) => void;
  existingSources: SourceRecord[];
  maxSourceCount?: number;
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
  targetUnitIds?: string[];
  maxToolRounds?: number;
  idNamespace?: string;
  /** Stage02 完整结构；用于把 JU/变量/EvidenceProfile 编译成机器查询计划。 */
  structure?: any;
  /** 补证轮次（1-based）；传递给预取阶段用于查询差异化。 */
  round?: number;
}) {
  const targetUnitIds = [...new Set((input.targetUnitIds || []).map(String).filter(Boolean))];
  const targetSet = new Set(targetUnitIds);
  const scopedRequirements = targetSet.size
    ? (input.requirements || []).filter((item) =>
      item.judgment_unit_ids.some((id) => targetSet.has(String(id))),
    )
    : input.requirements;
  input.onProgress?.({ round: 0, message: "Runtime 正在按 EvidenceRequirement 预取并冻结候选来源…" });
  const runtimeAcquisition = await preAcquireStage03CandidateSources({
    runId: input.runId,
    question: String((input.supplementContext as any)?.question || ""),
    requirements: scopedRequirements,
    targetUnitIds,
    existingSources: input.existingSources,
    maxSourceCount: input.maxSourceCount,
    structure: input.structure,
    cutoffMs: input.cutoffMs,
    round: input.round,
  });
  input.assertRunning();
  if (runtimeAcquisition.plan.gap_details.length) {
    throw new Error(
      `EVIDENCE_ROUTE_MISSING: ${runtimeAcquisition.plan.gap_details
        .map((gap) => `${gap.requirement_id}: ${gap.detail}`)
        .join("；")}`,
    );
  }
  const sourcesAfterRuntimeAcquisition = listSources(input.runId);
  const frozenCandidates = selectFrozenStage03CandidateSources({
    sources: sourcesAfterRuntimeAcquisition,
    requirements: scopedRequirements,
    maxCandidates: 6,
  });
  const frozenDraftSources = materializeFrozenStage03CandidateDrafts({
    sources: frozenCandidates,
    requirements: scopedRequirements,
    existingDraftSources: input.baseData.sources || [],
  });
  const workingBase = dedupeStage03DraftSources({
    ...input.baseData,
    sources: [
      ...(Array.isArray(input.baseData.sources) ? input.baseData.sources : []),
      ...frozenDraftSources,
    ],
  }).data;
  const scopedBaseWithoutCandidates = targetSet.size
    ? scopeStage03DataForBatch(workingBase, targetUnitIds)
    : workingBase;
  // Runtime 新冻结的候选在事实绑定前天然是“未绑定来源”。如果这里沿用只按
  // 旧 EvidenceDraft 反查来源的批次裁剪，它们会在送模前被静默丢掉。
  const scopedBase = targetSet.size
    ? {
      ...scopedBaseWithoutCandidates,
      sources: dedupeStage03DraftSources({
        sources: [
          ...(Array.isArray(scopedBaseWithoutCandidates.sources) ? scopedBaseWithoutCandidates.sources : []),
          ...frozenDraftSources,
        ],
        evidence_drafts: scopedBaseWithoutCandidates.evidence_drafts || [],
      }).data.sources,
    }
    : scopedBaseWithoutCandidates;
  const brief = buildSupplementBrief({
    coverage: computeSourceCoverage({
      sources: sourcesAfterRuntimeAcquisition,
      evidence: scopedBase.evidence_drafts || [],
      requirements: scopedRequirements,
      cutoffMs: input.cutoffMs,
    }),
    evidence: scopedBase.evidence_drafts || [],
    sources: sourcesAfterRuntimeAcquisition,
    draftSources: scopedBase.sources || [],
    requirements: scopedRequirements,
    methodApplications: scopedBase.method_applications || [],
  });

  input.onProgress?.({ round: 0, message: "正在按优先级队列针对缺口与失败来源生成补证 patch…" });
  const judgmentTypes = Array.isArray((input.supplementContext as any)?.judgmentTypes)
    ? [...(input.supplementContext as any).judgmentTypes].map(String)
    : [];
  const kb03Ids = evidenceMethodIdsFromApplications(scopedBase.method_applications || []);
  const disciplineDigest = getEvidenceDisciplineDigest(kb03Ids, judgmentTypes);
  const result = await input.client.generateStructured(
    "evidence_supplement",
    controlledEvidencePatchSchema,
    promptForEvidenceSupplement(disciplineDigest),
    JSON.stringify({
      supplement_brief: brief,
      acquisition_plan: runtimeAcquisition.plan,
      target_batch: targetSet.size ? {
        judgment_unit_ids: targetUnitIds,
        requirement_ids: (scopedRequirements || []).map((item) => item.id),
        new_id_namespace: input.idNamespace || "BATCH",
        reserved_source_keys: (input.baseData.sources || []).map((item: any) => item?.source_key).filter(Boolean),
        reserved_evidence_ids: (input.baseData.evidence_drafts || []).map((item: any) => item?.id).filter(Boolean),
        instruction: "本轮只处理这些判断单元；其他单元由其他批次负责，不得扩展。",
      } : null,
      current_evidence_draft: (() => {
        // 失败/返工/缺口必须修复的来源钉住，绝不能因 recent-N 裁剪而丢失修复上下文。
        const mustIncludeSourceKeys = (brief.failed_sources || [])
          .map((item: any) => item?.source_key)
          .filter(Boolean) as string[];
        // delta 风格收敛：本批必需（已绑定 + 必修复）来源钉住；其余未绑定/溢出来源
        // 按最近 N 条保留，避免被反复补证的单元把整份历史来源逐轮重发（最大乘数）。
        // method_applications / unresolved_gaps 体量小且质量必需，原样保留。
        return trimStage03DraftForModel({
          methodApplications: scopedBase.method_applications || [],
          sources: scopedBase.sources || [],
          evidenceDrafts: scopedBase.evidence_drafts || [],
          unresolvedGaps: scopedBase.unresolved_gaps || [],
          mustIncludeSourceKeys,
        });
      })(),
      selected_method_guidance: loadSelectedMethodGuidance(kb03Ids, {
        // 实测：9 个 kb03 方法正文合计仅 ~10.6K 字符（远低于 56K 上限），
        // 故此处用主生成同档预算即可，方法正文完整发送、无需压半。
        totalChars: Number(process.env.STAGE03_SUPPLEMENT_METHOD_GUIDANCE_CHARS)
          || CONTEXT_SLOT_BUDGETS.method_guidance,
      }),
      evidence_judgment_type_cards: evidenceJudgmentTypeCardsForPrompt(judgmentTypes),
      mcp_channel_hints: mcpChannelHintsForPrompt(),
      patch_contract: {
        id_space: "source_key/application_id/evidence_id",
        note: "affected_object_refs 与 upserts/removals 使用同一套稳定业务 ID（如 SRC-09、MA-EV-01、EV-1），不是 registry UUID。新增对象只需出现在 upserts；Runtime 会自动补齐 affected_object_refs。",
      },
      runtime_acquired_candidates: frozenCandidates.map((source) => ({
        source_id: source.id,
        source_key: frozenDraftSources.find((draft: any) => draft.source_id === source.id)?.source_key,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        published_at: source.published_at,
        search_excerpt: source.search_excerpt,
        source_quote: frozenDraftSources.find((draft: any) => draft.source_id === source.id)?.source_quote,
        content_hash: source.content_hash,
        retrieval_status: source.retrieval_status,
        instruction: "该候选已由 Runtime 物化进 current_evidence_draft.sources。直接绑定既有 source_key；不要重复 upsert 来源，也不得改写 source_quote。",
      })),
      runtime_acquisition_trace: {
        route_registry_version: runtimeAcquisition.plan.registry_version,
        acquisition_task_ids: runtimeAcquisition.plan.tasks.map((task) => task.task_id),
        evidence_profile_ids: runtimeAcquisition.plan.generated_from.evidence_profile_ids,
        deterministic_queries: runtimeAcquisition.queries,
        registered_candidate_count: runtimeAcquisition.sources.length,
        registry_reused_candidate_count: frozenCandidates.filter((source) =>
          !runtimeAcquisition.sources.some((candidate) => candidate.id === source.id),
        ).length,
        error: runtimeAcquisition.error || null,
      },
      ...input.supplementContext,
    }, null, 2),
    {
      // MCP 证据通道始终开放：即使已有预取候选，模型仍可查询 cninfo/datayes
      // 等结构化数据源，补齐预取未覆盖的判断单元。这是覆盖率提升的关键路径。
      mcpEvidenceTools: true,
      // web search 在以下条件开放：①无预取候选（原始逻辑）②覆盖率仍低于 70%
      // 且有缺口单元（预取候选不足以覆盖所有缺口时，允许模型自行联网补充）。
      webSearch: frozenDraftSources.length === 0
        || (brief.coverage_rate < 0.7 && brief.coverage_gap_count > 0),
      requireEvidenceAcquisition: frozenCandidates.length === 0,
      // 本轮目标是调用工具取得并冻结来源，不是形成最终判断。关闭 thinking
      // 可显著降低“检索前长思考”，推理质量由后续证据结构化/Stage04 承担。
      disableReasoning: true,
      // 本批目标和本体节点已由 Stage02 固定；关闭 ontology 工具避免在取证环空转。
      ontologyTools: false,
      maxToolRounds: input.maxToolRounds || Number(process.env.STAGE03_SUPPLEMENT_MAX_TOOL_ROUNDS || 4),
      runId: input.runId,
      // 提交时即把 upserts/removals ID 并入 affected，避免 schema 过关后 merge 再因漏声明失败。
      repairOutput: (data) => {
        const normalized = normalizeStage03Patch(data as Stage03Patch);
        return targetSet.size
          ? isolateStage03BatchPatch({
            baseData: workingBase,
            patch: normalized,
            targetUnitIds,
            namespace: input.idNamespace || "BATCH",
          })
          : normalized;
      },
    },
  );
  input.assertRunning();

  const combinedToolUsage = {
    ...(result.toolUsage && typeof result.toolUsage === "object" ? result.toolUsage as Record<string, unknown> : {}),
    runtime_preacquired_sources: frozenCandidates.length,
    runtime_acquisition_queries: runtimeAcquisition.queries,
    ...(runtimeAcquisition.error ? { runtime_acquisition_error: runtimeAcquisition.error } : {}),
  };
  const patch = enforceStage03AcquisitionHonesty({
    patch: normalizeStage03Patch(result.data),
    baseData: workingBase,
    toolUsage: combinedToolUsage,
    targetUnitIds,
    runtimeAcquiredSourceUrls: frozenCandidates.map((source) => source.url),
  });
  const merged = mergeStage03Patch(workingBase, patch);
  const repaired = repairEvidencePreparationDraft(merged);
  // 抓取前先过契约：避免 gap 残留 source_keys / 非法 kind 烧完一轮抓取才失败。
  const precheck = schemas.stage_03.safeParse(repaired);
  if (!precheck.success) {
    throw new Error(JSON.stringify(precheck.error.issues));
  }
  const affectedRefs = new Set([
    ...patch.affected_object_refs,
    ...frozenDraftSources.map((source: any) => String(source.source_key)),
  ]);
  // 合并后按“失败源/返工绑定/单元缺口/其余新线索”重排抓取顺序，预算先喂高优先项。
  const capturePriorityKeys = buildCapturePriorityKeys({
    draftSources: repaired.sources || [],
    evidence: repaired.evidence_drafts || [],
    failedSourceKeys: brief.failed_sources
      .map((item) => item.source_key)
      .filter((key): key is string => Boolean(key)),
    reworkEvidenceIds: brief.rework_evidence.map((item) => item.evidence_id),
    gapUnitIds: brief.gap_units.map((item) => item.unit_id),
  });
  const withSnapshots = await applyStage03SourceSnapshots({
    runId: input.runId,
    data: repaired,
    affectedRefs,
    existingSources: sourcesAfterRuntimeAcquisition,
    maxNewSources: input.maxSourceCount === undefined
      ? undefined
      : Math.max(
        0,
        input.maxSourceCount
          - sourcesAfterRuntimeAcquisition.filter((source) => source.usability_status !== "rejected").length,
      ),
    cutoffMs: input.cutoffMs,
    capturePriorityKeys,
    assertRunning: input.assertRunning,
    onCaptureProgress: (index, total) => {
      input.onProgress?.({ round: index, message: `补证来源抓取 ${index}/${total}` });
    },
  });
  schemas.stage_03.parse(withSnapshots);
  return {
    data: withSnapshots,
    patch,
    usage: result.usage,
    toolUsage: combinedToolUsage,
    unchangedEvidenceIds: findUnchangedEvidenceIds(workingBase.evidence_drafts || [], withSnapshots.evidence_drafts || []),
  };
}

export function collectAffectedSourceKeys(patch: { affected_object_refs: string[]; upserts: Record<string, unknown[]> }) {
  const keys = new Set<string>();
  for (const source of patch.upserts.sources || []) {
    const id = objectId(source);
    if (id) keys.add(id);
  }
  for (const ref of patch.affected_object_refs) {
    if (ref.startsWith("SRC-")) keys.add(ref);
  }
  return keys;
}
