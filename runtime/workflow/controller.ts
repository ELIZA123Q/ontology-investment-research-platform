import "server-only";
import {
  getArtifact,
  getRun,
  latestArtifact,
} from "../storage/db";
import {
  enqueueArtifactGeneration,
  runResearchJobUntilSettled,
} from "../runner/research_job_runner";
import { approve } from "./approval";
import { meetsHighQualityForReview } from "../agents/shared/hq_retry";
import { parseJson, STAGES, type StageKind } from "../schemas/types";
import { logger } from "../lib/logger";

// ============================================================
// Types
// ============================================================

/** 单阶段执行结果 */
export type StagePipelineResult = {
  stage: StageKind;
  /** 本次对该阶段的处置结果 */
  outcome:
    | "already_approved"     // 已确认，跳过
    | "generated_approved"   // 新生成 + 自动确认
    | "generated_pending"    // 新生成，需要人工确认（HQ 未通过）
    | "failed"               // 重试耗尽，失败
    | "blocked";             // 上游未就绪，无法启动
  artifactId?: string;
  artifactVersion?: number;
  jobId?: string;
  /** 该阶段经过了几次生成尝试（含最终成功或失败的那次） */
  attemptCount: number;
  /** HQ 门禁是否通过（仅在 generated_* 时有意义） */
  hqPassed?: boolean;
  qualityStatus?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

/** 全链路编排结果 */
export type PipelineResult = {
  runId: string;
  stages: StagePipelineResult[];
  /** 是否所有目标阶段都走到了 approved */
  completed: boolean;
  /** 人类可读摘要 */
  summary: string;
  startedAt: string;
  finishedAt: string;
};

/** 编排配置 */
export type PipelineConfig = {
  /** 每阶段最大重试次数（默认 1，即首次失败后再试一次） */
  maxRetriesPerStage: number;
  /** 是否在 HQ 通过后自动确认（默认 true） */
  autoApprove: boolean;
  /**
   * Stage03 模式：
   * - "auto"（默认）：自动检测——若已有 approved 的 stage_03 则走补充取证；
   *   否则走全量生成。
   * - "regenerate"：强制全量重新生成
   * - "evidence_supplement"：强制补充取证
   */
  stage03Mode: "auto" | "regenerate" | "evidence_supplement";
  /** 从第几阶段开始（1-5，默认自动检测为第一个未确认阶段） */
  startFrom?: number;
  /** 到第几阶段停止（1-5，默认 5） */
  stopAt: number;
};

// ============================================================
// 默认配置
// ============================================================

function defaultConfig(): PipelineConfig {
  return {
    maxRetriesPerStage: Number(process.env.PIPELINE_MAX_RETRIES_PER_STAGE || "1"),
    autoApprove: !["0", "false", "no"].includes(
      String(process.env.PIPELINE_AUTO_APPROVE || "true").trim().toLowerCase(),
    ),
    stage03Mode: (["regenerate", "evidence_supplement"].includes(
      String(process.env.PIPELINE_STAGE03_MODE || "").trim(),
    )
      ? String(process.env.PIPELINE_STAGE03_MODE || "").trim()
      : "auto") as PipelineConfig["stage03Mode"],
    stopAt: 5,
  };
}

// ============================================================
// 阶段依赖（与 research_job_runner 保持一致）
// ============================================================

const DEPENDENCIES: Record<StageKind, StageKind[]> = {
  stage_01: [],
  stage_02: ["stage_01"],
  stage_03: ["stage_01", "stage_02"],
  stage_04: ["stage_02", "stage_03"],
  stage_05: ["stage_01", "stage_03", "stage_04"],
};

// ============================================================
// 内部辅助
// ============================================================

function stageNumber(kind: StageKind): number {
  return Number(kind.slice(-2));
}

/** 休眠 ms */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取当前已确认的阶段集合 */
function approvedStages(runId: string): Set<StageKind> {
  const approved = new Set<StageKind>();
  for (const kind of STAGES) {
    const artifact = latestArtifact(runId, kind, ["approved"]);
    if (artifact) approved.add(kind);
  }
  return approved;
}

/** 检查上游依赖是否全部满足 */
function upstreamReady(runId: string, kind: StageKind): boolean {
  return DEPENDENCIES[kind].every((dep) => approvedStages(runId).has(dep));
}

/**
 * 确定 stage_03 的生成模式。
 * - 若已有 approved stage_03 → evidence_supplement（补证）
 * - 否则 → regenerate（全量）
 */
function resolveStage03Mode(
  runId: string,
  configured: PipelineConfig["stage03Mode"],
): "regenerate" | "evidence_supplement" {
  if (configured === "regenerate" || configured === "evidence_supplement") {
    return configured;
  }
  // auto: 已有 approved stage_03 则补证
  const existing = latestArtifact(runId, "stage_03", ["approved"]);
  return existing ? "evidence_supplement" : "regenerate";
}

// ============================================================
// 核心编排
// ============================================================

/**
 * 自动执行一条研究链路的全部阶段（01→05）。
 *
 * 行为：
 * - 跳过已确认的阶段
 * - 对未确认阶段：入队 → 等待完成 → 检查 HQ 门禁
 * - HQ 通过 + autoApprove → 自动确认
 * - HQ 失败 → 按 maxRetriesPerStage 重试；耗尽后标为 pending 并停止
 * - 任何阶段失败 → 整条链路中止
 */
export async function runResearchPipeline(
  runId: string,
  partialConfig: Partial<PipelineConfig> = {},
): Promise<PipelineResult> {
  const config: PipelineConfig = { ...defaultConfig(), ...partialConfig };
  const startedAt = new Date().toISOString();
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");

  const results: StagePipelineResult[] = [];
  const alreadyApproved = approvedStages(runId);

  // 确定起始阶段
  let startStage = config.startFrom;
  if (startStage == null) {
    // 自动检测：从第一个未确认阶段开始
    for (const kind of STAGES) {
      if (!alreadyApproved.has(kind)) {
        startStage = stageNumber(kind);
        break;
      }
    }
    // 全部已确认
    if (startStage == null) startStage = 6; // >5 表示无需执行
  }

  logger.info("PIPELINE:START", `run=${runId} start=${startStage} stop=${config.stopAt} autoApprove=${config.autoApprove}`);

  for (const kind of STAGES) {
    const n = stageNumber(kind);

    // 还没到起始阶段
    if (n < startStage!) {
      if (alreadyApproved.has(kind)) {
        results.push({
          stage: kind,
          outcome: "already_approved",
          artifactId: latestArtifact(runId, kind, ["approved"])?.id,
          attemptCount: 0,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // 已超过停止阶段
    if (n > config.stopAt) break;

    // 已确认 → 跳过
    if (alreadyApproved.has(kind)) {
      results.push({
        stage: kind,
        outcome: "already_approved",
        artifactId: latestArtifact(runId, kind, ["approved"])!.id,
        attemptCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      continue;
    }

    // 检查上游
    if (!upstreamReady(runId, kind)) {
      logger.warn("PIPELINE:BLOCKED", `${kind} 上游未就绪`);
      results.push({
        stage: kind,
        outcome: "blocked",
        attemptCount: 0,
        error: "上游阶段未确认",
      });
      break;
    }

    // 尝试执行
    const stageStart = new Date().toISOString();
    let lastError = "";
    let succeeded = false;

    for (let attempt = 0; attempt <= config.maxRetriesPerStage; attempt++) {
      try {
        logger.info("PIPELINE:STAGE", `${kind} attempt=${attempt + 1}/${config.maxRetriesPerStage + 1}`);

        // 确定 mode
        const mode =
          kind === "stage_03"
            ? resolveStage03Mode(runId, config.stage03Mode)
            : "regenerate";

        // 入队
        const job = enqueueArtifactGeneration({
          runId,
          kind,
          mode,
        });

        // 等待任务完成
        const settled = await runResearchJobUntilSettled(job.id, {
          workerId: `pipeline-${process.pid}`,
        });

        if (!settled) {
          lastError = "任务未返回结果";
          continue;
        }

        // 分析终态
        if (settled.status === "waiting_for_review") {
          // 生成成功，检查 HQ
          const artifact = latestArtifact(runId, kind, ["needs_review"]);
          if (!artifact) {
            lastError = "生成完成但找不到产物";
            continue;
          }

          const data = parseJson<any>(artifact.json_content, {});
          const hqPassed = meetsHighQualityForReview(kind, data);
          const qualityStatus = String(data?.quality_status || "");

          if (hqPassed && config.autoApprove) {
            // 自动确认
            try {
              const approved = approve(artifact.id);
              logger.info("PIPELINE:APPROVED", `${kind} artifact=${approved.id}`);
              results.push({
                stage: kind,
                outcome: "generated_approved",
                artifactId: approved.id,
                artifactVersion: approved.version,
                jobId: settled.id,
                attemptCount: attempt + 1,
                hqPassed: true,
                qualityStatus,
                startedAt: stageStart,
                finishedAt: new Date().toISOString(),
              });
              succeeded = true;
              break;
            } catch (approveError) {
              // 确认失败（如校验不通过），视为需要人工介入
              logger.warn("PIPELINE:APPROVE_FAILED", `${kind} ${approveError instanceof Error ? approveError.message : String(approveError)}`);
              results.push({
                stage: kind,
                outcome: "generated_pending",
                artifactId: artifact.id,
                artifactVersion: artifact.version,
                jobId: settled.id,
                attemptCount: attempt + 1,
                hqPassed,
                qualityStatus,
                error: `自动确认失败: ${approveError instanceof Error ? approveError.message : String(approveError)}`,
                startedAt: stageStart,
                finishedAt: new Date().toISOString(),
              });
              succeeded = true;
              break;
            }
          } else if (hqPassed && !config.autoApprove) {
            // HQ 通过但人工确认模式
            results.push({
              stage: kind,
              outcome: "generated_pending",
              artifactId: artifact.id,
              artifactVersion: artifact.version,
              jobId: settled.id,
              attemptCount: attempt + 1,
              hqPassed: true,
              qualityStatus,
              startedAt: stageStart,
              finishedAt: new Date().toISOString(),
            });
            succeeded = true;
            break;
          } else {
            // HQ 未通过，还有重试次数则重试
            if (attempt < config.maxRetriesPerStage) {
              logger.warn("PIPELINE:HQ_RETRY", `${kind} HQ未通过 attempt=${attempt + 1} quality=${qualityStatus}`);
              lastError = `HQ 门禁未通过 (${qualityStatus})，准备重试`;
              // 短暂退避
              await sleep(5000 + attempt * 5000);
              continue;
            }
            // 重试耗尽，标为需人工确认
            results.push({
              stage: kind,
              outcome: "generated_pending",
              artifactId: artifact.id,
              artifactVersion: artifact.version,
              jobId: settled.id,
              attemptCount: attempt + 1,
              hqPassed: false,
              qualityStatus,
              error: `HQ 门禁未通过（已重试 ${config.maxRetriesPerStage} 次）: ${qualityStatus}`,
              startedAt: stageStart,
              finishedAt: new Date().toISOString(),
            });
            succeeded = true;
            break;
          }
        } else if (settled.status === "waiting_for_input") {
          // 不可恢复的失败
          let reason = "";
          try { reason = JSON.parse(settled.result_json || "{}").reason || ""; } catch { /* ignore */ }
          lastError = reason || settled.last_error || "任务因输入不足而终止";
          // waiting_for_input 通常不可重试
          break;
        } else if (settled.status === "blocked") {
          lastError = settled.last_error || "任务已达最大重试次数";
          break;
        } else if (settled.status === "cancelled") {
          lastError = "任务已被取消";
          break;
        } else {
          lastError = `未知任务状态: ${settled.status}`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.error("PIPELINE:STAGE_ERROR", `${kind} attempt=${attempt + 1} ${lastError}`);
        if (attempt < config.maxRetriesPerStage) {
          await sleep(5000 + attempt * 5000);
          continue;
        }
      }
    }

    if (!succeeded) {
      results.push({
        stage: kind,
        outcome: "failed",
        attemptCount: config.maxRetriesPerStage + 1,
        error: lastError,
        startedAt: stageStart,
        finishedAt: new Date().toISOString(),
      });
      // 下游依赖此阶段，终止链路
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  const completed = results.every(
    (r) => r.outcome === "already_approved" || r.outcome === "generated_approved",
  );

  // 构建摘要
  const approvedCount = results.filter(
    (r) => r.outcome === "already_approved" || r.outcome === "generated_approved",
  ).length;
  const pendingStages = results
    .filter((r) => r.outcome === "generated_pending")
    .map((r) => r.stage)
    .join(", ");
  const failedStages = results
    .filter((r) => r.outcome === "failed")
    .map((r) => r.stage)
    .join(", ");

  let summary = `已完成 ${approvedCount}/${config.stopAt} 阶段`;
  if (pendingStages) summary += `，${pendingStages} 需人工确认`;
  if (failedStages) summary += `，${failedStages} 失败`;

  logger.info("PIPELINE:DONE", `run=${runId} completed=${completed} ${summary}`);

  return {
    runId,
    stages: results,
    completed,
    summary,
    startedAt,
    finishedAt,
  };
}
