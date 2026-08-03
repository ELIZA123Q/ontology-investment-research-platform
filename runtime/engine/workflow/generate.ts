import { createHash } from "node:crypto";
import "server-only";
import {
createArtifact,
getArtifact,
getRun,
latestArtifact,
listSources,
normalizeUrl,
updateArtifact,
updateArtifactIfStatus
} from "../../adapters/db";
import { accumulateTokenUsage,createResearchModelClient } from "../../adapters/deepseek";
import { generationLeaseMs } from "../../adapters/model_provider";
import { logger } from "../../lib/logger";
import {
findUnchangedEvidenceIds,
partitionStage03EvidenceBatches,
runEvidenceSupplementRound,
stage03AutoSupplementMaxRounds,
stage03EvidenceBatchConfig
} from "../evidence_auto_supplement";
import { evaluateEvidenceQuality } from "../evidence_quality_gate";
import { buildGenerationProgressHeartbeat,parseGenerationProgress } from "../generation_progress";
import { repairJudgmentPreparationDraft } from "../judgment_draft_normalize";
import { PROMPT_VERSION } from "../prompts";
import { syncStage03ReadableMarkdown,syncStage04ReadableMarkdown } from "../readable_markdown";
import { syncReviewWorkItems } from "../review_work_items";
import { schemas,type SchemaKind } from "../schemas";
import { buildStageSemanticContext } from "../semantic_context";
import { applyDeterministicRuleEvaluations } from "../semantic_execution";
import { computeSourceCoverage } from "../source_coverage";
import { ensureStage02DocumentFields,repairStage02GenerationDraft } from "../stage02_documents";
import {
initializeStage03BatchCheckpoint,
readStage03BatchCheckpoint,
} from "../stage03_batch_checkpoint";
import { ensureStage03DocumentFields,findStage03NumericGroundingIssues } from "../stage03_documents";
import { ensureStage04DocumentFields } from "../stage04_documents";
import { ensureStage05DocumentFields } from "../stage05_documents";
import { projectEvidenceRequirementsFromStructure,resolveEvidenceRequirementsFromStructure } from "../structure_candidates";
import { parseJson,STAGES,type ArtifactKind,type StageKind } from "../types";
import {
buildEvidenceGapFallback,
buildJudgmentGapFallback,
normalizeStage01Projection,
repairEvidencePreparationDraft
} from "../workflow_projections";
import { normalizeBusinessCutoff,stageNumber,validateGeneratedSemanticDraft } from "../workflow_shared";
import {
classifyRuntimeFailure,
formatRuntimeFailureMessage,
shouldAbortStage03Batching
} from "../workflow_support";
import { runGenerationHighQualityRetry } from "./generation_hq_retry";
import { buildGenerationContext } from "./generation_context";
import { runStage05ResearchValueReview } from "./generation_stage05_review";
import { runStage03BatchSequence } from "./stage03_batch_runner";

export async function generateArtifact(
  runId: string,
  kind: ArtifactKind,
  options?: {
    mode?: "regenerate" | "evidence_supplement";
    maxAutoRounds?: number;
    maxSourceCount?: number;
    /** 仅供后台任务租约恢复：复用含 Stage03 批次检查点的 running 产物。 */
    resumeArtifactId?: string;
    executionLease?: {
      assertActive(): void;
      onArtifactCreated?(artifactId: string): void;
    };
  },
) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (kind === "independent_review" && !latestArtifact(runId, "stage_04", ["approved"])) {
    throw new Error("请先确认阶段 04，再运行独立审阅");
  }
  if (kind === "baseline" && !latestArtifact(runId, "stage_03", ["approved"])) {
    throw new Error("请先确认阶段 03 并冻结证据，再生成同证据基线");
  }
  if (kind.startsWith("stage_")) {
    const n = stageNumber(kind);
    if (n > 1 && !latestArtifact(runId, STAGES[n - 2], ["approved"])) {
      throw new Error(`请先确认阶段 ${String(n - 1).padStart(2, "0")}`);
    }
  }
  const resumeArtifact = options?.resumeArtifactId ? getArtifact(options.resumeArtifactId) : undefined;
  if (options?.resumeArtifactId && (
    !resumeArtifact
    || resumeArtifact.run_id !== runId
    || resumeArtifact.kind !== kind
    || kind !== "stage_03"
    || resumeArtifact.status !== "running"
    || !readStage03BatchCheckpoint(parseJson(resumeArtifact.json_content, {}))
  )) {
    throw new Error("STAGE03_RESUME_INVALID: 只能恢复当前任务中带有效批次检查点的 running Stage03 产物");
  }
  const running = latestArtifact(runId, kind, ["running"]);
  if (running && running.id !== resumeArtifact?.id) {
    const leaseMs = generationLeaseMs();
    const ageMs = Date.now() - Date.parse(running.created_at);
    if (Number.isFinite(ageMs) && ageMs < leaseMs + 60_000) {
      throw new Error(`${kind} 已有生成请求运行中（artifact=${running.id}），请等待或在超时后重试`);
    }
    updateArtifact(running.id, {
      status: "failed",
      error_message: "[model_output_error] MODEL_TIMEOUT_RECOVERED: 上一进程终止后遗留 running，已由新请求恢复",
      tool_usage: JSON.stringify({ failure_category: "model_output_error", recovered_abandoned_generation: true }),
    });
  }
  const {
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
  } = buildGenerationContext({ runId, kind, run });
  const client = createResearchModelClient(
    kind === "independent_review" ? "reviewer" : "producer",
    kind,
  );
  const artifact = resumeArtifact || createArtifact(runId, kind, {
      status: "running",
      prompt_version: PROMPT_VERSION,
      knowledge_version: governanceVersion,
      input_context: inputContext,
      model_name: client.model,
    });
  try {
    options?.executionLease?.onArtifactCreated?.(artifact.id);
  } catch (error) {
    updateArtifactIfStatus(artifact.id, "running", {
      status: "failed",
      error_message: "[model_output_error] GENERATION_LEASE_LOST: 新产物无法绑定到当前 job 租约",
    });
    throw error;
  }

  const runModelJob = async () => {
    const startedAt = new Date().toISOString();
    let lastHeartbeatJson = JSON.stringify({
      in_progress: true,
      phase: "model_round",
      round: 0,
      max_rounds: 0,
      tool_names: [],
      heartbeat_at: startedAt,
      started_at: startedAt,
      elapsed_ms: 0,
      message: "已开始生成，等待首轮模型响应",
    });
    updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
    try {
      const assertRunning = () => {
        options?.executionLease?.assertActive();
        if (getArtifact(artifact.id)?.status !== "running") {
          throw new Error("GENERATION_LEASE_LOST: 当前生成已被超时恢复流程取代，禁止旧请求写回");
        }
      };
      const writeCoverageHeartbeat = (
        autoRound: number,
        maxRounds: number,
        coverage: { coverage_rate: number; verification_rate: number; coverage_gap_count: number },
        message: string,
      ) => {
        const heartbeat = {
          ...buildGenerationProgressHeartbeat({
            phase: "coverage_pass",
            round: autoRound,
            max_rounds: maxRounds,
            tool_names: [],
            message,
          }, startedAt),
          auto_round: autoRound,
          max_auto_rounds: maxRounds,
          coverage_rate: coverage.coverage_rate,
          verification_rate: coverage.verification_rate,
          coverage_gap_count: coverage.coverage_gap_count,
        };
        lastHeartbeatJson = JSON.stringify(heartbeat);
        updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
      };

      const stage03Mode = kind === "stage_03" ? (options?.mode ?? "regenerate") : undefined;
      const maxAutoRounds = kind === "stage_03" ? (options?.maxAutoRounds ?? stage03AutoSupplementMaxRounds()) : 1;
      let inheritFromArtifactId: string | undefined;
      let initialBaseData: any | undefined;
      let result: Awaited<ReturnType<typeof client.generate>> | null = null;
      const resumedStage03Data = resumeArtifact
        ? parseJson<any>(resumeArtifact.json_content, {})
        : undefined;
      let cumulativeUsage: unknown = resumeArtifact
        ? parseJson(resumeArtifact.token_usage, {})
        : {};
      let data: any;
      const structureData: any = kind === "stage_03"
        ? parseJson(latestArtifact(runId, "stage_02", ["approved"])!.json_content, {})
        : {};
      const evidenceRequirements = kind === "stage_03"
        ? resolveEvidenceRequirementsFromStructure({
          units: structureData.judgment_units || [],
          evidence_requirements: structureData.evidence_requirements,
          counter_evidence_directions: structureData.counter_evidence_directions,
        })
        : [];
      const cutoffMs = kind === "stage_03"
        ? (() => {
          const normalized = normalizeBusinessCutoff(taskContext?.time_scope?.as_of);
          if (!normalized) return undefined;
          const parsed = Date.parse(normalized);
          return Number.isFinite(parsed) ? parsed : undefined;
        })()
        : undefined;
      const compactSupplementContextForUnits = (unitIds: string[]) => {
        const target = new Set(unitIds.map(String));
        const numericRepairIssues = findStage03NumericGroundingIssues(data || {})
          .filter((issue) => issue.judgment_unit_ids.some((id) => target.has(String(id))));
        return {
          question: run.question,
          domain: run.domain,
          judgmentTypes: judgmentTypesForKnowledge,
          acceptance_repair_issues: numericRepairIssues.map((issue) => ({
            evidence_id: issue.evidence_id,
            judgment_unit_ids: issue.judgment_unit_ids,
            issue: "numeric_ungrounded",
            tokens: issue.tokens,
            instruction: "仅保留可由绑定 source_quote 逐字核对的数字；否则补取匹配原文、拆分陈述或降为显式 gap",
          })),
          upstream: upstream.map((item: any) => {
            if (item.kind !== "stage_02") return item;
            const json = item.json || {};
            return {
              kind: item.kind,
              json: {
                research_scope: json.research_scope,
                judgment_spine: json.judgment_spine,
                judgment_units: (json.judgment_units || []).filter((unit: any) =>
                  target.has(String(unit?.id || "")),
                ),
                variables: (json.variables || []).filter((variable: any) =>
                  !variable?.judgment_unit_ids
                  || variable.judgment_unit_ids.some((id: string) => target.has(String(id))),
                ),
                method_applications: (json.method_applications || []).filter((application: any) =>
                  (application.target_judgment_unit_refs || []).some((id: string) => target.has(String(id))),
                ),
                competing_explanations: json.competing_explanations || [],
                counter_evidence_directions: json.counter_evidence_directions || [],
              },
            };
          }),
        };
      };

      if (kind === "stage_03" && stage03Mode === "evidence_supplement") {
        const resumedCheckpoint = readStage03BatchCheckpoint(resumedStage03Data);
        if (resumedCheckpoint && resumedCheckpoint.mode !== "evidence_supplement") {
          throw new Error("STAGE03_RESUME_MODE_MISMATCH: 检查点不是定向补证模式");
        }
        const checkpointBaseArtifact = resumedCheckpoint?.base_artifact_id
          ? getArtifact(resumedCheckpoint.base_artifact_id)
          : undefined;
        const baseArtifact = checkpointBaseArtifact
          || latestArtifact(runId, "stage_03", ["needs_review", "approved"]);
        if (!baseArtifact) throw new Error("尚无证据稿件可补充，请先生成全量证据");
        inheritFromArtifactId = baseArtifact.id;
        initialBaseData = parseJson(baseArtifact.json_content, {});
        data = repairEvidencePreparationDraft(resumedStage03Data || initialBaseData);
        // 补证前回填 source_ids，避免已抓取来源因未链接被误判为缺口（否则会反复把整批送进补证批次）。
        // 草稿证据以 source_keys 引用来源，草稿 sources 维护 source_key → source_id(Registry id) 映射；
        // 据此重建 evidence.source_ids，与 source_coverage 用 source_ids 查 usableSourceById 的口径一致。
        // 仅补全映射，不触发重新抓取。与 evidence_snapshot_apply 的回填逻辑同口径。
        {
          const registryIds = new Set(listSources(runId).map((s) => s.id));
          const keyToId = new Map<string, string>();
          for (const s of (data.sources || []) as Array<{ source_key?: string; source_id?: string }>) {
            if (s.source_key && s.source_id) keyToId.set(s.source_key, s.source_id);
          }
          for (const ev of (data.evidence_drafts || []) as Array<{ source_keys?: string[]; source_ids?: string[] }>) {
            if (!Array.isArray(ev.source_keys) || !ev.source_keys.length) continue;
            const mapped = ev.source_keys
              .map((k: string) => keyToId.get(k))
              .filter((id): id is string => Boolean(id))
              .filter((id) => registryIds.has(id));
            const kept = (ev.source_ids || []).filter((id) => registryIds.has(id));
            ev.source_ids = Array.from(new Set([...kept, ...mapped]));
          }
        }
        const currentCoverage = computeSourceCoverage({
          sources: listSources(runId),
          evidence: data.evidence_drafts || [],
          requirements: evidenceRequirements,
          cutoffMs,
        });
        const currentQuality = evaluateEvidenceQuality({
          evidenceDrafts: data.evidence_drafts || [],
          sources: listSources(runId),
          judgmentUnits: structureData.judgment_units || [],
          evidenceRequirements,
        });
        const blockingQualityTargets = new Set(
          currentQuality.gapDetails
            .filter((detail) => detail.isBlocking)
            .map((detail) => String(detail.judgmentUnitId)),
        );
        const numericQualityTargets = new Set(
          findStage03NumericGroundingIssues(data)
            .flatMap((issue) => issue.judgment_unit_ids.map(String)),
        );
        const coverageTargets = new Set(
          currentCoverage.unit_coverage
            .filter((unit) => (
              !unit.has_support_evidence
              || !unit.meets_independence
              || blockingQualityTargets.has(String(unit.unit_id))
              || numericQualityTargets.has(String(unit.unit_id))
            ))
            .map((unit) => String(unit.unit_id)),
        );
        const allStructureUnitIds = (structureData.judgment_units || [])
          .map((unit: any) => String(unit?.id || ""))
          .filter(Boolean);
        const targetUnitIds = allStructureUnitIds.filter((id: string) => coverageTargets.has(id));
        const batches = resumedCheckpoint
          ? resumedCheckpoint.batches.map((entry) => ({
            batch_id: entry.batch_id,
            unit_ids: entry.target_unit_ids,
            requirements: evidenceRequirements.filter((requirement) =>
              requirement.judgment_unit_ids.some((id) => entry.target_unit_ids.includes(String(id))),
            ),
          }))
          : targetUnitIds.length
            ? partitionStage03EvidenceBatches({
              judgmentUnitIds: targetUnitIds,
              requirements: evidenceRequirements,
              ...stage03EvidenceBatchConfig(),
            })
            : [];
        const checkpoint = initializeStage03BatchCheckpoint({
          mode: "evidence_supplement",
          batches,
          baseArtifactId: baseArtifact.id,
          prior: resumedCheckpoint,
        });
        const batchRun = await runStage03BatchSequence({
          mode: "evidence_supplement",
          batches,
          checkpoint,
          data,
          cumulativeUsage,
          lastHeartbeatJson,
          artifactId: artifact.id,
          runId,
          client,
          startedAt,
          assertRunning,
          compactSupplementContextForUnits,
          structure: structureData,
          writeCoverageHeartbeat,
          allRequirements: evidenceRequirements,
          cutoffMs,
          maxSourceCount: options?.maxSourceCount,
        });
        data = batchRun.data;
        cumulativeUsage = batchRun.cumulativeUsage;
        lastHeartbeatJson = batchRun.lastHeartbeatJson;
      } else if (kind === "stage_03") {
        // 03 默认走可恢复批次：确定性 gap 底稿保证所有判断单元都有位置，
        // 每批只研究 1–2 个单元，patch 再合并回全局。单批失败不抹掉已成功批次。
        const resumedCheckpoint = readStage03BatchCheckpoint(resumedStage03Data);
        if (resumedCheckpoint && resumedCheckpoint.mode !== "regenerate") {
          throw new Error("STAGE03_RESUME_MODE_MISMATCH: 检查点不是全量取证模式");
        }
        data = resumedStage03Data || buildEvidenceGapFallback(
            structureData,
            "Runtime 已建立完整证据缺口底稿，正在按判断单元分批取得并冻结真实来源",
          );
        data = repairEvidencePreparationDraft(data);
        ensureStage03DocumentFields(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
        });
        const batches = resumedCheckpoint
          ? resumedCheckpoint.batches.map((entry) => ({
            batch_id: entry.batch_id,
            unit_ids: entry.target_unit_ids,
            requirements: evidenceRequirements.filter((requirement) =>
              requirement.judgment_unit_ids.some((id) => entry.target_unit_ids.includes(String(id))),
            ),
          }))
          : partitionStage03EvidenceBatches({
            judgmentUnitIds: (structureData.judgment_units || [])
              .map((unit: any) => String(unit?.id || ""))
              .filter(Boolean),
            requirements: evidenceRequirements,
            ...stage03EvidenceBatchConfig(),
          });
        const checkpoint = initializeStage03BatchCheckpoint({
          mode: "regenerate",
          batches,
          prior: resumedCheckpoint,
        });
        const batchRun = await runStage03BatchSequence({
          mode: "regenerate",
          batches,
          checkpoint,
          data,
          cumulativeUsage,
          lastHeartbeatJson,
          artifactId: artifact.id,
          runId,
          client,
          startedAt,
          assertRunning,
          compactSupplementContextForUnits,
          structure: structureData,
          writeCoverageHeartbeat,
          allRequirements: evidenceRequirements,
          cutoffMs,
          maxSourceCount: options?.maxSourceCount,
        });
        data = batchRun.data;
        cumulativeUsage = batchRun.cumulativeUsage;
        lastHeartbeatJson = batchRun.lastHeartbeatJson;
      } else if (kind === "stage_04") {
        // 全 gap 上游：跳过模型，直接确定性 J0，避免无事实输入生成方向性判断。
        const evidenceApproved: any = stage03UpstreamJson
          || parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {});
        const drafts = Array.isArray(evidenceApproved?.evidence_drafts) ? evidenceApproved.evidence_drafts : [];
        const allGap = drafts.length > 0 && drafts.every((item: any) => String(item?.kind) === "gap");
        const noUsableFacts = drafts.length === 0
          || allGap
          || String(evidenceApproved?.allowed_05_output || "") === "gap_report_only";
        if (noUsableFacts && drafts.every((item: any) => !item || String(item.kind) === "gap")) {
          const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
          data = buildJudgmentGapFallback(
            structure,
            evidenceApproved,
            "Stage03 无有效事实（全 gap / gap_report_only）；Runtime 自动走确定性 J0，不调用模型生成方向判断",
          );
          data.fallback_reason = "stage03_all_gap_auto_j0";
          data.stage04_generation_mode = "deterministic_j0_gap_fallback";
          applyDeterministicRuleEvaluations(data, drafts, listSources(runId), structure);
          ensureStage04DocumentFields(data, { question: run.question, taskId: run.id });
          // 全缺口时表达许可必须收紧：05 只能写缺口报告。
          if (!data.expression_permission) data.expression_permission = {};
          data.expression_permission.max_expression_level = "J0";
          data.expression_permission.prohibited_claims = [
            ...new Set([
              ...(Array.isArray(data.expression_permission.prohibited_claims)
                ? data.expression_permission.prohibited_claims.map(String)
                : []),
              "方向性行业结论",
              "价格预测",
              "买卖建议",
            ]),
          ];
          data.expression_permission.notes = [
            String(data.expression_permission.notes || ""),
            "上游无事实；仅允许缺口说明与补证建议，不得恢复洞见。",
          ].filter(Boolean).join(" ");
          syncStage04ReadableMarkdown(data, { question: run.question, taskId: run.id });
          schemas.stage_04.parse(data);
        } else {
          result = await client.generate(kind as SchemaKind, systemPrompt, inputContext, {
            webSearch: false,
            ontologyTools: false,
            maxToolRounds: 6,
            runId,
            validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
            repairOutput: (draft) => {
              const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
              const repaired = repairJudgmentPreparationDraft(draft, {
                judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
                scopeRef: structure.research_scope?.id || null,
              });
              ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id });
              return repaired;
            },
            onProgress: (event) => {
              assertRunning();
              const heartbeat = buildGenerationProgressHeartbeat(event, startedAt);
              lastHeartbeatJson = JSON.stringify(heartbeat);
              updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
            },
          });
          cumulativeUsage = accumulateTokenUsage(cumulativeUsage, result.usage);
          data = result.data;
          assertRunning();
        }
      } else {
        // Stage02/05 等：开放 ontologyTools 仅 Stage02；Stage04 已在上方分支处理。
        const useOntologyTools = kind === "stage_02";
        result = await client.generate(kind as SchemaKind, systemPrompt, inputContext, {
          webSearch: false,
          ontologyTools: useOntologyTools,
          maxToolRounds: undefined,
          runId,
          validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
          repairOutput: kind === "stage_02"
            ? (draft) => repairStage02GenerationDraft(draft, { question: run.question, taskId: run.id })
            : kind === "stage_05"
              ? (draft) => {
                const stage04: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {});
                return ensureStage05DocumentFields(draft, { question: run.question, taskId: run.id, stage04 });
              }
              : undefined,
          onProgress: (event) => {
            assertRunning();
            const heartbeat = buildGenerationProgressHeartbeat(event, startedAt);
            lastHeartbeatJson = JSON.stringify(heartbeat);
            updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
          },
        });
        cumulativeUsage = accumulateTokenUsage(cumulativeUsage, result.usage);
        data = result.data;
        assertRunning();
      }

      assertRunning();
      if (kind === "independent_review") {
        const reviewed = latestArtifact(runId, "stage_04", ["approved"])!;
        data.reviewed_stage04_artifact_id = reviewed.id;
        data.reviewed_stage04_artifact_hash = createHash("sha256").update(reviewed.json_content).digest("hex");
        const producerModel = reviewed.model_name || "unknown";
        data.reviewer_model = client.model;
        data.producer_model = producerModel;
        data.reviewer_type = "model";
        data.reviewer_attestation = null;
        data.independence_level = producerModel !== "unknown" && producerModel !== client.model ? "independent_model" : "same_model_separate_call";
      }
      if (kind === "stage_01") {
        normalizeStage01Projection(data, run.question);
        schemas.stage_01.parse(data);
      }
      if (kind === "stage_02") {
        ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
        if (!String(data.research_logic_markdown || "").trim() && String(data.document_markdown || "").trim()) {
          data.research_logic_markdown = data.document_markdown;
        }
        if (String(data.research_logic_markdown || "").trim()) {
          data.document_markdown = data.research_logic_markdown;
        }
        ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
        schemas.stage_02.parse(data);
      }
      if (kind === "baseline") {
        data.frozen_stage03_artifact_id = frozenEvidenceArtifact!.id;
        data.frozen_stage03_artifact_hash = createHash("sha256").update(frozenEvidenceArtifact!.json_content).digest("hex");
        const frozenUrls = new Set(frozenSources.map((source) => source.normalized_url));
        for (const source of data.sources || []) {
          let normalized = "";
          try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
          if (!frozenUrls.has(normalized)) {
            throw new Error(`同证据基线引用了冻结证据包外的来源: ${source.url}`);
          }
        }
      }
      if (kind === "stage_04") {
        const evidence: any = parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {});
        const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
        applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
        syncStage04ReadableMarkdown(data, { question: run.question, taskId: run.id });
        schemas.stage_04.parse(data);
      }
      if (kind === "stage_03") {
        // 完整生成与“补充取证”共用同一闭环：每一轮先跑覆盖/质量门，
        // 再只对仍薄弱的 JU 分批补证。旧实现因 stage03_batch_execution 已存在
        // 而完全跳过这里，手动模式也被硬编码为单轮。
        const supplementRounds: Array<Record<string, any>> = Array.isArray(data?.stage03_supplement_rounds)
          ? structuredClone(data.stage03_supplement_rounds)
          : [];
        for (const round of supplementRounds) {
          for (const batch of Array.isArray(round?.batches) ? round.batches : []) {
            if (batch?.status !== "in_progress") continue;
            batch.status = "interrupted";
            batch.finished_at = new Date().toISOString();
            batch.error = batch.paid_model_started_at
              ? "上一 worker 在付费模型提交前中断；为避免重复付费，本轮不重放"
              : "上一 worker 在补证批次完成前中断；本轮记为中断并由后续轮次重新评估";
          }
        }
        let autoRound = Math.max(
          1,
          ...supplementRounds.map((round) => Number(round?.round || 1)).filter(Number.isFinite),
        );
        const persistAutoSupplementState = () => {
          data.stage03_supplement_rounds = supplementRounds;
          const saved = updateArtifactIfStatus(artifact.id, "running", {
            json_content: JSON.stringify(data, null, 2),
            token_usage: JSON.stringify(cumulativeUsage),
            tool_usage: lastHeartbeatJson,
          });
          if (!saved) throw new Error("GENERATION_LEASE_LOST: Stage03 自动补证检查点写入失败");
        };
        persistAutoSupplementState();
        while (autoRound < maxAutoRounds) {
          const coverage = computeSourceCoverage({
            sources: listSources(runId),
            evidence: data.evidence_drafts || [],
            requirements: evidenceRequirements,
            cutoffMs,
          });
          const interimQuality = evaluateEvidenceQuality({
            evidenceDrafts: data.evidence_drafts || [],
            sources: listSources(runId),
            judgmentUnits: structureData.judgment_units || [],
            evidenceRequirements,
          });
          writeCoverageHeartbeat(
            autoRound,
            maxAutoRounds,
            coverage,
            `第 ${autoRound}/${maxAutoRounds} 轮后评估：${interimQuality.qualityStatus}，覆盖率 ${(coverage.coverage_rate * 100).toFixed(0)}%，核验率 ${(coverage.verification_rate * 100).toFixed(0)}%`,
          );
          if (interimQuality.qualityStatus === "high_quality_pass") break;
          // 非阻断 gap（尤其已执行检索但未找到的 counter gap）必须作为限制带入
          // Stage04，而不是每轮重复取证。只有阻断项和 HQ 数字落引问题进入补证队列。
          const qualityTargets = new Set(
            interimQuality.gapDetails
              .filter((item) => item.isBlocking)
              .map((item) => String(item.judgmentUnitId)),
          );
          const numericTargets = new Set(
            findStage03NumericGroundingIssues(data)
              .flatMap((issue) => issue.judgment_unit_ids.map(String)),
          );
          let targetUnitIds = coverage.unit_coverage
            .filter((unit) => (
              !unit.has_support_evidence
              || !unit.meets_independence
              || qualityTargets.has(String(unit.unit_id))
              || numericTargets.has(String(unit.unit_id))
            ))
            .map((unit) => String(unit.unit_id));
          // 逐 JU 都过最低门但全局仍未到 HQ（例如总证据或来源组不足）时，
          // 继续把全体 JU 作为补强候选，直到 HQ 或轮次预算耗尽。
          if (!targetUnitIds.length) {
            // 补证模式：无缺口即止，不退化为全量单元重抓（覆盖已良好时补证本应无操作）。
            if (stage03Mode === "evidence_supplement") break;
            targetUnitIds = (structureData.judgment_units || [])
              .map((unit: any) => String(unit?.id || ""))
              .filter(Boolean);
          }
          if (!targetUnitIds.length) break;
          autoRound += 1;
          const batches = partitionStage03EvidenceBatches({
            judgmentUnitIds: targetUnitIds,
            requirements: evidenceRequirements,
            ...stage03EvidenceBatchConfig(),
          });
          const roundRecord: Record<string, any> = {
            round: autoRound,
            trigger_quality_status: interimQuality.qualityStatus,
            trigger_gap_count: coverage.coverage_gap_count,
            target_unit_ids: targetUnitIds,
            batches: [],
            started_at: new Date().toISOString(),
          };
          supplementRounds.push(roundRecord);
          persistAutoSupplementState();
          for (const [batchIndex, batch] of batches.entries()) {
            const batchRecord: Record<string, unknown> = {
              batch_id: batch.batch_id,
              target_unit_ids: batch.unit_ids,
              status: "in_progress",
              started_at: new Date().toISOString(),
            };
            roundRecord.batches.push(batchRecord);
            persistAutoSupplementState();
            try {
              const supplement = await runEvidenceSupplementRound({
                client,
                runId,
                baseData: data,
                supplementContext: compactSupplementContextForUnits(batch.unit_ids),
                assertRunning,
                onProgress: (event) => {
                  if (
                    event.message.includes("针对缺口与失败来源生成补证 patch")
                    && !batchRecord.paid_model_started_at
                  ) {
                    batchRecord.paid_model_started_at = new Date().toISOString();
                    persistAutoSupplementState();
                  }
                  const heartbeat = buildGenerationProgressHeartbeat({
                    phase: "model_round",
                    round: event.round,
                    max_rounds: maxAutoRounds,
                    tool_names: [],
                    message: `自动补证 R${autoRound}/${batch.batch_id}：${event.message}`,
                  }, startedAt);
                  lastHeartbeatJson = JSON.stringify({
                    ...heartbeat,
                    auto_round: autoRound,
                    max_auto_rounds: maxAutoRounds,
                    evidence_batch_index: batchIndex + 1,
                    evidence_batch_count: batches.length,
                    target_unit_ids: batch.unit_ids,
                  });
                  updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
                },
                existingSources: listSources(runId),
                maxSourceCount: options?.maxSourceCount,
                requirements: batch.requirements,
                targetUnitIds: batch.unit_ids,
                cutoffMs,
                maxToolRounds: Number(process.env.STAGE03_SUPPLEMENT_MAX_TOOL_ROUNDS || 4),
                idNamespace: `R${autoRound}-${batch.batch_id}`,
                structure: structureData,
                round: autoRound,
              });
              data = supplement.data;
              cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
              Object.assign(batchRecord, {
                status: "complete",
                finished_at: new Date().toISOString(),
                tool_usage: supplement.toolUsage,
                unchanged_evidence_ids: [...supplement.unchangedEvidenceIds],
              });
              // supplement.data 来自模型 patch，不含 Runtime 外层检查点；重新挂回。
              data.stage03_supplement_rounds = supplementRounds;
              persistAutoSupplementState();
            } catch (error) {
              if (shouldAbortStage03Batching(error)) throw error;
              const message = formatRuntimeFailureMessage(error);
              data.unresolved_gaps = [
                ...new Set([
                  ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
                  `自动补证 R${autoRound}/${batch.batch_id} 失败（${batch.unit_ids.join(", ")}）：${message}`,
                ]),
              ];
              Object.assign(batchRecord, {
                status: "failed",
                finished_at: new Date().toISOString(),
                error: message,
              });
              persistAutoSupplementState();
            }
          }
          roundRecord.finished_at = new Date().toISOString();
          persistAutoSupplementState();
        }
        data.stage03_supplement_rounds = supplementRounds;
      }
      if (kind === "stage_03") {
        data = repairEvidencePreparationDraft(data);
        syncStage03ReadableMarkdown(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
        });
        schemas.stage_03.parse(data);

        // A3: 证据最低质量门 - 强制执行（含 Stage02 逐 JU 独立性/反证需求）
        const stage03Requirements = Array.isArray(structureData?.evidence_requirements) && structureData.evidence_requirements.length
          ? structureData.evidence_requirements
          : projectEvidenceRequirementsFromStructure({
            units: structureData?.judgment_units || [],
            counter_evidence_directions: structureData?.counter_evidence_directions,
          });
        const evidenceQuality = evaluateEvidenceQuality({
          evidenceDrafts: data.evidence_drafts || [],
          sources: listSources(runId),
          judgmentUnits: structureData?.judgment_units || [],
          evidenceRequirements: stage03Requirements,
        });
        data.evidence_quality_gate = {
          passed: evidenceQuality.passed,
          quality_status: evidenceQuality.qualityStatus,
          total_evidence: evidenceQuality.totalEvidence,
          source_groups: evidenceQuality.sourceGroups,
          direct_facts: evidenceQuality.directFacts,
          gap_details: evidenceQuality.gapDetails,
          evaluated_at: new Date().toISOString(),
        };
        data.evidence_quality_summary = evidenceQuality.summary;

        if (!evidenceQuality.passed || evidenceQuality.qualityStatus === "return_required") {
          logger.warn("EVIDENCE:GATE", `Stage 03 未通过: ${evidenceQuality.summary}`);
          data.quality_status = "return_required";
          data.return_required = true;
          data.deterministic_check_status = "not_checked";
          data.status_reason = evidenceQuality.summary;
          data.evidence_readiness = "not_ready";
          data.delivery_readiness = "not_ready";
          data.allowed_05_output = evidenceQuality.totalEvidence > 0 ? "bounded_report" : "gap_report_only";
          data.evidence_gap_report = {
            generated_at: new Date().toISOString(),
            reason: "evidence_quality_floor_not_met",
            details: evidenceQuality.gapDetails.filter((d) => d.isBlocking),
            recommendation: "建议手动补证或缩小研究范围后重试",
          };
        } else if (evidenceQuality.qualityStatus === "minimum_pass") {
          // 证据仅达最低流转：不得自称 HQ；确认门禁仍要求 HQ，故标为需补强
          data.evidence_readiness = "partial";
          data.delivery_readiness = "partial";
          data.allowed_05_output = "bounded_report";
          if (String(data.quality_status || "") === "high_quality_pass") {
            data.quality_status = "minimum_pass";
            data.deterministic_check_status = "not_checked";
          }
        } else {
          data.evidence_readiness = "ready";
          data.delivery_readiness = "ready";
          data.allowed_05_output = "full_report";
        }

        // 获取通道只做留痕，不决定来源权威性。公司 IR、监管/政府官网等
        // 经正文抓取与逐字核验后可以是一手来源；MCP 只是获取通道，不能
        // 被当作证据等级或 high_quality 的代理变量。
        const batchToolUsage = (data?.stage03_batch_execution?.batches || [])
          .map((batch: any) => batch?.tool_usage)
          .filter((usage: unknown) => usage && typeof usage === "object") as Array<Record<string, unknown>>;
        batchToolUsage.push(
          ...(data?.stage03_supplement_rounds || [])
            .flatMap((round: any) => Array.isArray(round?.batches) ? round.batches : [])
            .map((batch: any) => batch?.tool_usage)
            .filter((usage: unknown) => usage && typeof usage === "object") as Array<Record<string, unknown>>,
        );
        const toolUsage = (result?.toolUsage && typeof result.toolUsage === "object")
          ? result.toolUsage as Record<string, unknown>
          : batchToolUsage.length
            ? {
              tool_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.tool_calls || 0), 0),
              web_search_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.web_search_calls || 0), 0),
              public_page_fetch_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.public_page_fetch_calls || 0), 0),
              mcp_evidence_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.mcp_evidence_calls || 0), 0),
              tools: batchToolUsage.flatMap((item) => Array.isArray(item.tools) ? item.tools : []),
            }
            : {};
        const mcpCalls = Number(toolUsage.mcp_evidence_calls || 0);
        const webCalls = Number(toolUsage.web_search_calls || 0);
        const nonGapCount = (Array.isArray(data.evidence_drafts) ? data.evidence_drafts : [])
          .filter((item: any) => String(item?.kind) !== "gap").length;
        data.mcp_channel_usage = {
          mcp_evidence_calls: mcpCalls,
          web_search_calls: webCalls,
          public_page_fetch_calls: Number(toolUsage.public_page_fetch_calls || 0),
          tools: Array.isArray(toolUsage.tools) ? toolUsage.tools : [],
          evaluated_at: new Date().toISOString(),
          quality_semantics: "acquisition_telemetry_only",
        };
        if (nonGapCount > 0 && mcpCalls <= 0) {
          data.mcp_channel_usage = {
            ...data.mcp_channel_usage,
            note: "本次非 gap 证据来自公开原文抓取或既有 Source Registry；质量由来源生产者、正文 hash、逐字引用和证据门判定",
          };
        }
        // 证据门会改变 readiness / 05 输出上限；强制重建 03 的人类可读压缩层与实例清单，
        // 避免保留 gap 底稿或上一补证轮次的旧摘要。
        syncStage03ReadableMarkdown(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
          forceProjection: true,
        });
        schemas.stage_03.parse(data);
      }
      if (kind === "stage_05") {
        const stage05Review = await runStage05ResearchValueReview({
          data,
          result,
          cumulativeUsage,
          lastHeartbeatJson,
          runId,
          run,
          deliveryArchetype,
          taskContext,
          client,
          systemPrompt,
          inputContext,
          artifact,
          startedAt,
          assertRunning,
        });
        data = stage05Review.data;
        result = stage05Review.result;
        cumulativeUsage = stage05Review.cumulativeUsage;
        lastHeartbeatJson = stage05Review.lastHeartbeatJson;
      }
      const hqRetry = await runGenerationHighQualityRetry({
        kind,
        data,
        result,
        cumulativeUsage,
        lastHeartbeatJson,
        stage03Mode,
        structureData,
        client,
        systemPrompt,
        inputContext,
        runId,
        run,
        artifact,
        startedAt,
        assertRunning,
      });
      data = hqRetry.data;
      result = hqRetry.result;
      cumulativeUsage = hqRetry.cumulativeUsage;
      lastHeartbeatJson = hqRetry.lastHeartbeatJson;
      assertRunning();
      if (data && typeof data === "object") {
        if (STAGES.includes(kind as StageKind)) {
          data.semantic_context = buildStageSemanticContext({
            stage: kind,
            data,
            upstream: upstream.map((item) => item.json),
          });
        }
        data.context_injected_assets = injectedAssets;
      }
      const completed = updateArtifactIfStatus(artifact.id, "running", {
        status: "needs_review",
        json_content: JSON.stringify(data, null, 2),
        markdown_content: data.document_markdown || "",
        model_name: client.model,
        raw_model_output: result?.raw || JSON.stringify(data),
        response_id: result?.responseId || null,
        token_usage: JSON.stringify(cumulativeUsage),
        tool_usage: result?.toolUsage
          ? JSON.stringify(result.toolUsage)
          : data?.stage03_batch_execution
            ? JSON.stringify({
              evidence_batch_execution: data.stage03_batch_execution,
              mcp_channel_usage: data.mcp_channel_usage,
            })
            : lastHeartbeatJson,
        error_message: null,
      });
      if (!completed) throw new Error("GENERATION_LEASE_LOST: 生成完成前租约已失效，旧请求不得恢复为可审阅产物");
      syncReviewWorkItems(completed, data, inheritFromArtifactId && initialBaseData ? {
        inheritFromArtifactId,
        unchangedEvidenceIds: findUnchangedEvidenceIds(initialBaseData.evidence_drafts || [], data.evidence_drafts || []),
      } : undefined);
      return completed;
    } catch (error) {
      const failureCategory = classifyRuntimeFailure(error);
      const lastProgress = parseGenerationProgress(lastHeartbeatJson);
      const message = formatRuntimeFailureMessage(error);
      const failureStep =
        /Zod|schema|structured_schema|optional\(\) without/i.test(message) ? "structured_submit_validation"
        : /tool.?round|maxToolRounds|工具调用/i.test(message) ? "tool_round_limit"
        : /cancel|取消|GENERATION_LEASE_LOST|租约/i.test(message) ? "cancelled_or_lease_lost"
        : /timeout|超时|AbortError/i.test(message) ? "timeout"
        : kind === "stage_03" ? "evidence_acquisition_or_structure"
        : "model_generation";
      updateArtifactIfStatus(artifact.id, "running", {
        status: "failed",
        error_message: `[${failureCategory}] ${message}`,
        tool_usage: JSON.stringify({
          failure_category: failureCategory,
          failure_step: failureStep,
          research_complete: false,
          system_failure_not_research_conclusion: true,
          ...(lastProgress ? {
            last_progress: {
              phase: lastProgress.phase,
              round: lastProgress.round,
              max_rounds: lastProgress.max_rounds,
              tool_names: lastProgress.tool_names,
              last_tool: lastProgress.last_tool,
              heartbeat_at: lastProgress.heartbeat_at,
              elapsed_ms: lastProgress.elapsed_ms,
              message: lastProgress.message,
            },
          } : {}),
        }),
      });
      throw error;
    }
  };

  return runModelJob();
}
