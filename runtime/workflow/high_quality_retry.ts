import { getRun, latestArtifact, listSources, updateArtifactIfStatus } from "../storage/db";
import { accumulateTokenUsage, type ResearchModelClient } from "../skills/model_client/deepseek_client";
import { evaluateEvidenceQuality } from "../skills/evidence_evaluation/quality_gate";
import { buildGenerationProgressHeartbeat } from "../runner/generation_progress";
import { repairJudgmentPreparationDraft } from "../agents/04_judgment/draft_normalize";
import { syncStage03ReadableMarkdown } from "../skills/expression_audit/readable_markdown";
import { schemas, type SchemaKind } from "../schemas/schemas";
import { ensureStage02DocumentFields, repairStage02GenerationDraft } from "../agents/02_structure/input_contract";
import { ensureStage03DocumentFields } from "../agents/03_evidence/input_contract";
import { ensureStage04DocumentFields, manifestContextFromRun } from "../agents/04_judgment/input_contract";
import { ensureStage05DocumentFields } from "../agents/05_delivery/input_contract";
import {
  applyUpstreamQualityFailure,
  buildQualityRetryNotes,
  collectStageHighQualityErrors,
  forceHighQualityTarget,
  HQ_RETRY_KEY,
  markGenerationBelowHighQuality,
  meetsHighQualityForReview,
  shouldPreserveUpstreamQualityFailure,
} from "../agents/shared/hq_retry";
import { projectEvidenceRequirementsFromStructure } from "../agents/02_structure/structure_candidates";
import { parseJson, type ArtifactKind } from "../schemas/types";
import {
  normalizeStage01Projection,
  normalizeStage05Projection,
  repairEvidencePreparationDraft,
} from "./projections";
import { validateGeneratedSemanticDraft } from "./shared";

function stage05PaidAutoRetryEnabled() {
  return ["1", "true", "yes"].includes(
    String(process.env.STAGE05_PAID_AUTO_RETRY || "").trim().toLowerCase(),
  );
}

export async function runGenerationHighQualityRetry(input: {
  kind: ArtifactKind;
  data: any;
  result: any;
  cumulativeUsage: any;
  lastHeartbeatJson: string;
  stage03Mode?: "regenerate" | "evidence_supplement";
  structureData: any;
  client: ResearchModelClient;
  systemPrompt: string;
  inputContext: string;
  runId: string;
  run: { id: string; question: string };
  artifact: { id: string };
  startedAt: string;
  assertRunning: () => void;
}) {
  let { data, result, cumulativeUsage, lastHeartbeatJson } = input;
  const {
    kind,
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
  } = input;

  // 01–05：生成后静默 HQ 门禁；失败则注入失败项再生成一次，仍失败则标为不可确认。
  // 上游硬失败（00A 研究价值 / 证据质量门）禁止 forceHQ + checked 盖章冲掉。
  const stageKindsForHq = new Set(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
  if (
    stageKindsForHq.has(kind)
    && data
    && typeof data === "object"
    && String(data.task_disposition || "") !== "needs_clarification"
  ) {
    const upstreamLock = shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind);
    if (upstreamLock.preserve) {
      applyUpstreamQualityFailure(data, upstreamLock.reason);
    } else {
      forceHighQualityTarget(data);
      // 仅在形态检查期间临时假定 checked；通过后才保留，失败由 markGeneration 清回。
      data.deterministic_check_status = "checked";
      let hqErrors = collectStageHighQualityErrors(kind, data);
      if (
        hqErrors.length
        && stage03Mode !== "evidence_supplement"
        && (kind !== "stage_05" || stage05PaidAutoRetryEnabled())
      ) {
        assertRunning();
        const retryNotes = buildQualityRetryNotes(hqErrors);
        const retryHeartbeat = buildGenerationProgressHeartbeat({
          phase: "model_round",
          round: 1,
          max_rounds: 2,
          tool_names: [],
          message: "正在按可交接密度标准补强本稿",
        }, startedAt);
        lastHeartbeatJson = JSON.stringify(retryHeartbeat);
        updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
        const retryInput = JSON.stringify({
          ...JSON.parse(inputContext),
          [HQ_RETRY_KEY]: retryNotes,
        }, null, 2);
        const useOntologyTools = kind === "stage_02" || kind === "stage_03";
        const retryResult = await client.generate(kind as SchemaKind, systemPrompt, retryInput, {
          webSearch: kind === "stage_03",
          ontologyTools: useOntologyTools,
          maxToolRounds: kind === "stage_04" ? 6 : undefined,
          runId,
          validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
          repairOutput: kind === "stage_03"
            ? (draft) => {
              const repaired = repairEvidencePreparationDraft(draft);
              ensureStage03DocumentFields(repaired, {
                question: run.question,
                taskId: run.id,
                structure: structureData,
              });
              return repaired;
            }
            : kind === "stage_04"
              ? (draft) => {
                const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
                const repaired = repairJudgmentPreparationDraft(draft, {
                  judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
                  scopeRef: structure.research_scope?.id || null,
                });
                ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id, manifestCtx: manifestContextFromRun(getRun(runId)) });
                return repaired;
              }
              : kind === "stage_02"
                ? (draft) => repairStage02GenerationDraft(draft, { question: run.question, taskId: run.id })
                : kind === "stage_05"
                  ? (draft) => {
                    const stage04: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {});
                    return ensureStage05DocumentFields(draft, { question: run.question, taskId: run.id, stage04 });
                  }
                  : kind === "stage_01"
                    ? (draft) => {
                      normalizeStage01Projection(draft, run.question);
                      return draft;
                    }
                    : undefined,
          onProgress: (event) => {
            assertRunning();
            const heartbeat = buildGenerationProgressHeartbeat({
              ...event,
              message: `密度补强：${event.message || ""}`,
            }, startedAt);
            lastHeartbeatJson = JSON.stringify(heartbeat);
            updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
          },
        });
        cumulativeUsage = accumulateTokenUsage(cumulativeUsage, retryResult.usage);
        data = retryResult.data;
        result = retryResult;
        assertRunning();
        if (kind === "stage_01") {
          normalizeStage01Projection(data, run.question);
          schemas.stage_01.parse(data);
        } else if (kind === "stage_02") {
          ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
          if (!String(data.research_logic_markdown || "").trim() && String(data.document_markdown || "").trim()) {
            data.research_logic_markdown = data.document_markdown;
          }
          if (String(data.research_logic_markdown || "").trim()) {
            data.document_markdown = data.research_logic_markdown;
          }
          ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
          schemas.stage_02.parse(data);
        } else if (kind === "stage_03") {
          data = repairEvidencePreparationDraft(data);
          syncStage03ReadableMarkdown(data, {
            question: run.question,
            taskId: run.id,
            structure: structureData,
          });
          ensureStage03DocumentFields(data, {
            question: run.question,
            taskId: run.id,
            structure: structureData,
          });
          // HQ 重试后重新执法证据门，避免补强稿冲掉先前失败态
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
            data.quality_status = "return_required";
            data.return_required = true;
            data.deterministic_check_status = "not_checked";
            data.status_reason = evidenceQuality.summary;
            data.evidence_readiness = "not_ready";
            data.delivery_readiness = "not_ready";
            data.allowed_05_output = evidenceQuality.totalEvidence > 0 ? "bounded_report" : "gap_report_only";
          } else if (evidenceQuality.qualityStatus === "minimum_pass") {
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
          syncStage03ReadableMarkdown(data, {
            question: run.question,
            taskId: run.id,
            structure: structureData,
            forceProjection: true,
          });
          schemas.stage_03.parse(data);
        } else if (kind === "stage_04") {
          const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
          const repaired = repairJudgmentPreparationDraft(data, {
            judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
            scopeRef: structure.research_scope?.id || null,
          });
          ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id, manifestCtx: manifestContextFromRun(getRun(runId)) });
          data = repaired;
          schemas.stage_04.parse(data);
        } else if (kind === "stage_05") {
          const judgmentJson: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])!.json_content, {});
          normalizeStage05Projection(data, judgmentJson, run.question, listSources(runId));
          ensureStage05DocumentFields(data, {
            question: run.question,
            taskId: run.id,
            stage04: judgmentJson,
          });
          schemas.stage_05.parse(data);
        }
        const retryLock = shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind);
        if (retryLock.preserve) {
          applyUpstreamQualityFailure(data, retryLock.reason);
          hqErrors = [];
        } else {
          forceHighQualityTarget(data);
          data.deterministic_check_status = "checked";
          hqErrors = collectStageHighQualityErrors(kind, data);
        }
      }
      if (
        !shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind).preserve
        && !meetsHighQualityForReview(kind, data)
      ) {
        markGenerationBelowHighQuality(data, hqErrors.length ? hqErrors : collectStageHighQualityErrors(kind, data));
      }
    }
  }

  return { data, result, cumulativeUsage, lastHeartbeatJson };
}
