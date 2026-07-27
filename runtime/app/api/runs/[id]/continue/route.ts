import { after } from "next/server";
import { getRun, latestArtifact, listWorkItems } from "@/adapters/db";
import { listResearchJobsForRun } from "@/adapters/research_jobs";
import { enqueueArtifactGeneration, runNextResearchJob } from "@/engine/research_job_runner";
import { STAGES } from "@/engine/types";
import { workItemHref } from "@/engine/research_overview";
import { latestJobForStage } from "@/app/lib/ui-labels";

export const runtime = "nodejs";
export const maxDuration = 3600;

function stageHref(runId: string, stage: number) {
  if (stage === 1) return `/runs/${runId}/scope`;
  if (stage === 2) return `/runs/${runId}/structure`;
  if (stage === 3) return `/runs/${runId}/evidence`;
  if (stage === 4) return `/runs/${runId}/judgments`;
  return `/runs/${runId}/report`;
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = getRun(id);
    if (!run) return Response.json({ error: "研究任务不存在" }, { status: 404 });
    if (run.current_stage >= 5) {
      return Response.json({ error: "五个研究阶段均已确认，请到交付页检查结果", next_href: stageHref(id, 5) }, { status: 409 });
    }

    const unresolved = listWorkItems(id).filter((item) => item.status === "pending" || item.status === "rework");
    if (unresolved.length) {
      return Response.json({ error: `仍有 ${unresolved.length} 项需要人工处理，不能自动跨越`, next_href: workItemHref(unresolved[0].stage, id) }, { status: 409 });
    }

    const nextStage = run.current_stage + 1;
    const kind = STAGES[nextStage - 1];
    const href = stageHref(id, nextStage);
    const awaitingReview = latestArtifact(id, kind, ["needs_review"]);
    if (awaitingReview) {
      return Response.json({ error: "当前阶段已有待确认产物，请先人工确认", next_href: href }, { status: 409 });
    }

    const latestStageJob = latestJobForStage(listResearchJobsForRun(id), kind);
    const activeJob = latestStageJob && ["queued", "running", "retrying", "waiting_for_input", "blocked"].includes(latestStageJob.status)
      ? latestStageJob
      : undefined;
    if (activeJob) {
      const needsAttention = activeJob.status === "waiting_for_input" || activeJob.status === "blocked";
      return Response.json({
        ...(needsAttention ? { error: "后台任务需要人工处理后才能继续" } : {}),
        job: activeJob,
        next_href: href,
      }, { status: needsAttention ? 409 : 202 });
    }

    const job = enqueueArtifactGeneration({ runId: id, kind });
    after(() => { void runNextResearchJob({ workerId: `next-after-${process.pid}` }).catch(() => undefined); });
    return Response.json({ job, next_href: href, stop_at: "human_review" }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
