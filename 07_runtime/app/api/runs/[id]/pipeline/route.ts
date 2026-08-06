import { after } from "next/server";
import { getRun } from "@/storage/db";
import { runResearchPipeline, type PipelineConfig } from "@/workflow/controller";
import { listResearchJobsForRun } from "@/runner/research_jobs";

export const runtime = "nodejs";
export const maxDuration = 3600;

/**
 * POST /api/runs/[id]/pipeline
 *
 * 自动执行 01→05 全链路段生成与确认。
 *
 * 请求体（可选）：
 * {
 *   "maxRetriesPerStage": 1,     // 每阶段最大重试次数，默认 1
 *   "autoApprove": true,          // HQ 通过后是否自动确认，默认 true
 *   "stage03Mode": "auto",        // Stage03 模式: auto|regenerate|evidence_supplement
 *   "startFrom": 1,               // 从第几阶段开始（1-5），默认自动检测
 *   "stopAt": 5                   // 到第几阶段停止（1-5），默认 5
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = getRun(id);
    if (!run) {
      return Response.json({ error: "研究任务不存在" }, { status: 404 });
    }

    // 检查是否有正在运行的 pipeline（简单去重：有 queued/running/retrying 任务则拒绝）
    const activeJobs = listResearchJobsForRun(id);
    const hasRunningPipeline = activeJobs.some((job) =>
      ["running", "retrying"].includes(job.status),
    );
    if (hasRunningPipeline) {
      return Response.json(
        {
          error: "已有后台任务正在执行，请等待完成或取消后再启动全链路",
          active_jobs: activeJobs
            .filter((j) => ["queued", "running", "retrying"].includes(j.status))
            .map((j) => ({ id: j.id, stage: j.stage, status: j.status })),
        },
        { status: 409 },
      );
    }

    // 解析配置
    const body = await request.json().catch(() => ({}));
    const config: Partial<PipelineConfig> = {};
    if (typeof body.maxRetriesPerStage === "number") config.maxRetriesPerStage = body.maxRetriesPerStage;
    if (typeof body.autoApprove === "boolean") config.autoApprove = body.autoApprove;
    if (body.stage03Mode) config.stage03Mode = body.stage03Mode;
    if (typeof body.startFrom === "number") config.startFrom = body.startFrom;
    if (typeof body.stopAt === "number") config.stopAt = body.stopAt;

    // 后台执行 pipeline，与现有 stage generate API 模式一致
    after(() => {
      void runResearchPipeline(id, config).catch((error) => {
        console.error("PIPELINE:ERROR", error instanceof Error ? error.message : String(error));
      });
    });

    return Response.json(
      {
        run_id: id,
        status: "started",
        message: `全链路已启动，从阶段 ${config.startFrom || "自动检测"} 到 ${config.stopAt || 5}`,
        config,
      },
      { status: 202 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/runs/[id]/pipeline
 *
 * 查询当前链路的进度（基于现有 run progress + artifacts）。
 * 控制器不在数据库中单独记录"pipeline 状态"，而是复用已有的产物和任务状态。
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = getRun(id);
    if (!run) {
      return Response.json({ error: "研究任务不存在" }, { status: 404 });
    }

    const { latestArtifact, getRunProgress } = await import("@/storage/db");
    const { STAGES } = await import("@/schemas/types");
    const progress = getRunProgress(id);

    // 每个阶段的当前状态
    const stageStates = STAGES.map((kind) => {
      const approved = latestArtifact(id, kind, ["approved"]);
      const pending = latestArtifact(id, kind, ["needs_review"]);
      const running = latestArtifact(id, kind, ["running"]);
      const failed = latestArtifact(id, kind, ["failed"]);
      return {
        stage: kind,
        status: approved
          ? "approved"
          : pending
            ? "needs_review"
            : running
              ? "running"
              : failed
                ? "failed"
                : "pending",
        artifactId:
          approved?.id || pending?.id || running?.id || failed?.id || null,
      };
    });

    return Response.json({
      run_id: id,
      current_stage: progress.current_stage,
      completed_stage_count: progress.completed_stage_count,
      is_contiguous: progress.is_contiguous,
      stages: stageStates,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
