import { listSources } from "../adapters/db";
import type { ResearchModelClient } from "../adapters/deepseek";
import {
mergeStage03Patch,
normalizeStage03Patch,
objectId,
type Stage03Patch,
} from "./change_set";
import { CONTEXT_SLOT_BUDGETS } from "./context_assembler";
import {
buildCapturePriorityKeys,
buildSupplementBrief,
dedupeStage03DraftSources,
findUnchangedEvidenceIds,
} from "./evidence_supplement_pure";
import {
evidenceJudgmentTypeCardsForPrompt,
evidenceMethodIdsFromApplications,
loadSelectedMethodGuidance,
mcpChannelHintsForPrompt,
} from "./method_guidance";
import {
  materializeFrozenStage03CandidateDrafts,
  preAcquireStage03CandidateSources,
  selectFrozenStage03CandidateSources,
} from "./evidence_candidate_acquisition";
import { promptForEvidenceSupplement } from "./prompts";
import { controlledEvidencePatchSchema } from "./revise_schemas";
import { schemas } from "./schemas";
import { computeSourceCoverage } from "./source_coverage";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";
import { repairEvidencePreparationDraft } from "./workflow_projections";
import {
  enforceStage03AcquisitionHonesty,
  isolateStage03BatchPatch,
  scopeStage03DataForBatch,
} from "./evidence_batch_isolation";
import { applyStage03SourceSnapshots } from "./evidence_snapshot_apply";

export {
applyRegistryFreezeFields,buildCapturePriorityKeys,
buildSupplementBrief,
buildSupplementCoverage,dedupeStage03DraftSources,evidenceFingerprint,
findUnchangedEvidenceIds,
orderByCapturePriority,selectEvidenceSnapshotExcerpt,syncStage03DraftSourcesFromRegistry
} from "./evidence_supplement_pure";
export * from "./evidence_acquisition_planning";
export * from "./evidence_candidate_acquisition";
export * from "./evidence_batch_isolation";
export * from "./evidence_snapshot_apply";

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
  const result = await input.client.generateStructured(
    "evidence_supplement",
    controlledEvidencePatchSchema,
    promptForEvidenceSupplement(),
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
      current_evidence_draft: {
        method_applications: scopedBase.method_applications || [],
        sources: scopedBase.sources || [],
        evidence_drafts: scopedBase.evidence_drafts || [],
        unresolved_gaps: scopedBase.unresolved_gaps || [],
      },
      selected_method_guidance: loadSelectedMethodGuidance(kb03Ids, {
        totalChars: CONTEXT_SLOT_BUDGETS.method_guidance,
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
      // 冻结候选已足够时只保留结构化 submit 工具；禁止模型重复搜索并在
      // 每轮重放整份上下文。只有无候选时才开放取证工具。
      webSearch: frozenDraftSources.length === 0,
      requireEvidenceAcquisition: frozenCandidates.length === 0,
      // 本轮目标是调用工具取得并冻结来源，不是形成最终判断。关闭 thinking
      // 可显著降低“检索前长思考”，推理质量由后续证据结构化/Stage04 承担。
      disableReasoning: true,
      // 本批目标和本体节点已由 Stage02 固定；关闭 ontology 工具避免在取证环空转。
      ontologyTools: false,
      maxToolRounds: input.maxToolRounds || 8,
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
