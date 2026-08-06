import "server-only";

import {
  listSources,
  updateArtifactIfStatus,
} from "../storage/db";
import { accumulateTokenUsage } from "../skills/model_client/deepseek_client";
import {
  runEvidenceSupplementRound,
  type Stage03EvidenceBatch,
} from "../skills/gap_detection/gap_analyzer";
import { buildGenerationProgressHeartbeat } from "../runner/generation_progress";
import {
  terminalStage03BatchIds,
  updateStage03BatchCheckpoint,
  type Stage03BatchCheckpoint,
} from "../agents/03_evidence/batch_checkpoint";
import { computeSourceCoverage } from "../skills/evidence_evaluation/source_coverage";
import { parseJson } from "../schemas/types";
import {
  formatRuntimeFailureMessage,
  shouldAbortStage03Batching,
} from "./support";

type EvidenceSupplementClient = Parameters<typeof runEvidenceSupplementRound>[0]["client"];

type BatchCoverage = {
  coverage_rate: number;
  verification_rate: number;
  coverage_gap_count: number;
};

export type Stage03BatchRunResult = {
  data: any;
  checkpoint: Stage03BatchCheckpoint;
  cumulativeUsage: unknown;
  lastHeartbeatJson: string;
};

export async function runStage03BatchSequence(input: {
  mode: Stage03BatchCheckpoint["mode"];
  batches: Stage03EvidenceBatch[];
  checkpoint: Stage03BatchCheckpoint;
  data: any;
  cumulativeUsage: unknown;
  lastHeartbeatJson: string;
  artifactId: string;
  runId: string;
  client: EvidenceSupplementClient;
  startedAt: string;
  assertRunning: () => void;
  compactSupplementContextForUnits: (unitIds: string[]) => Record<string, unknown>;
  structure: any;
  writeCoverageHeartbeat: (
    round: number,
    maxRounds: number,
    coverage: BatchCoverage,
    message: string,
  ) => void;
  allRequirements: Stage03EvidenceBatch["requirements"];
  cutoffMs?: number;
  maxSourceCount?: number;
}): Promise<Stage03BatchRunResult> {
  let {
    checkpoint,
    cumulativeUsage,
    data,
    lastHeartbeatJson,
  } = input;
  const isSupplement = input.mode === "evidence_supplement";

  const persistCheckpoint = () => {
    data.stage03_batch_checkpoint = checkpoint;
    const progress = parseJson<Record<string, unknown>>(lastHeartbeatJson, {});
    const saved = updateArtifactIfStatus(input.artifactId, "running", {
      json_content: JSON.stringify(data, null, 2),
      token_usage: JSON.stringify(cumulativeUsage),
      tool_usage: JSON.stringify({
        ...progress,
        in_progress: checkpoint.status !== "complete",
        evidence_batch_checkpoint: checkpoint,
      }),
    });
    if (!saved) {
      throw new Error("GENERATION_LEASE_LOST: Stage03 批次检查点写入失败，禁止继续付费取证");
    }
  };

  persistCheckpoint();
  for (const [batchIndex, batch] of input.batches.entries()) {
    input.assertRunning();
    const checkpointEntry = checkpoint.batches.find((entry) => entry.batch_id === batch.batch_id);
    if (terminalStage03BatchIds(checkpoint).has(batch.batch_id)) continue;

    if (checkpointEntry?.status === "in_progress" && checkpointEntry.paid_model_started_at) {
      const interruption = `${batch.batch_id} 上一 worker 在批次提交前中断；为避免可能已付费的调用被重复执行，本次自动恢复跳过该批次`;
      data.unresolved_gaps = [
        ...new Set([
          ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
          interruption,
        ]),
      ];
      checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
        status: "interrupted",
        finished_at: new Date().toISOString(),
        error: interruption,
      });
      persistCheckpoint();
      continue;
    }

    if (checkpointEntry?.status === "in_progress") {
      checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
        status: "pending",
        error: "上一 worker 在付费模型调用前中断，允许从确定性来源预取阶段安全恢复",
      });
      persistCheckpoint();
    }

    input.writeCoverageHeartbeat(
      batchIndex + 1,
      Math.max(input.batches.length, 1),
      computeSourceCoverage({
        sources: listSources(input.runId),
        evidence: data.evidence_drafts || [],
        requirements: input.allRequirements,
        cutoffMs: input.cutoffMs,
      }),
      `Stage03 ${isSupplement ? "定向补证" : "分批取证"} ${batch.batch_id}：${batch.unit_ids.join(", ")}`,
    );
    checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
      status: "in_progress",
      started_at: new Date().toISOString(),
    });
    persistCheckpoint();

    try {
      const supplement = await runEvidenceSupplementRound({
        client: input.client,
        runId: input.runId,
        baseData: data,
        supplementContext: input.compactSupplementContextForUnits(batch.unit_ids),
        assertRunning: input.assertRunning,
        onProgress: (event) => {
          if (
            event.message.includes("针对缺口与失败来源生成补证 patch")
            && !checkpoint.batches.find((entry) => entry.batch_id === batch.batch_id)?.paid_model_started_at
          ) {
            checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
              paid_model_started_at: new Date().toISOString(),
            });
            persistCheckpoint();
          }
          const heartbeat = buildGenerationProgressHeartbeat({
            phase: "model_round",
            round: event.round,
            max_rounds: 8,
            tool_names: [],
            message: `${batch.batch_id}：${event.message}`,
          }, input.startedAt);
          lastHeartbeatJson = JSON.stringify({
            ...heartbeat,
            evidence_batch: batch.batch_id,
            evidence_batch_index: batchIndex + 1,
            evidence_batch_count: input.batches.length,
            target_unit_ids: batch.unit_ids,
            ...(isSupplement ? { mode: "evidence_supplement" } : {}),
          });
          updateArtifactIfStatus(input.artifactId, "running", {
            tool_usage: lastHeartbeatJson,
          });
        },
        existingSources: listSources(input.runId),
        maxSourceCount: input.maxSourceCount,
        requirements: batch.requirements,
        targetUnitIds: batch.unit_ids,
        cutoffMs: input.cutoffMs,
        // 补证批次必须传 round，否则 evidence_candidate_acquisition 的跨轮差异化修饰词
        // （年报/研报/最新动态政策）永不触发，补证与全量取证用同一组查询，返回的全是
        // 已收录 URL 被 priorUrls 去重 → 净新增恒为 0（这正是“点了补证却补不上”的根因）。
        // 补证模式强制从 round>=2 起，确保每批带差异化修饰词、能挖到新来源。
        round: isSupplement ? batchIndex + 2 : batchIndex + 1,
        maxToolRounds: input.mode === "evidence_supplement"
          ? Number(process.env.STAGE03_SUPPLEMENT_MAX_TOOL_ROUNDS || 4)
          : Number(process.env.STAGE03_REGEN_MAX_TOOL_ROUNDS || 8),
        idNamespace: isSupplement ? `SUP-${batch.batch_id}` : batch.batch_id,
        structure: input.structure,
      });
      data = supplement.data;
      cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
      checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
        status: "complete",
        finished_at: new Date().toISOString(),
        tool_usage: supplement.toolUsage,
        ...(isSupplement
          ? { unchanged_evidence_ids: [...supplement.unchangedEvidenceIds] }
          : {}),
      });
      persistCheckpoint();
    } catch (error) {
      if (shouldAbortStage03Batching(error)) throw error;
      const message = formatRuntimeFailureMessage(error);
      const failureLabel = isSupplement ? "定向补证失败" : "批次失败";
      data.unresolved_gaps = [
        ...new Set([
          ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
          `${batch.batch_id} ${failureLabel}（${batch.unit_ids.join(", ")}）：${message}`,
        ]),
      ];
      checkpoint = updateStage03BatchCheckpoint(checkpoint, batch.batch_id, {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: message,
      });
      persistCheckpoint();
    }
  }

  data.stage03_batch_execution = {
    mode: isSupplement ? "evidence_supplement_batches" : "judgment_unit_batches",
    batch_count: input.batches.length,
    batches: checkpoint.batches,
    pipeline_steps: [
      isSupplement ? "coverage_gap_queue" : "gap_scaffold",
      "batched_acquisition",
      "source_snapshot",
      "evidence_structure",
      "method_execution",
      "quality_gate",
    ],
  };
  checkpoint = {
    ...checkpoint,
    status: "complete",
    updated_at: new Date().toISOString(),
  };
  persistCheckpoint();

  return {
    data,
    checkpoint,
    cumulativeUsage,
    lastHeartbeatJson,
  };
}
