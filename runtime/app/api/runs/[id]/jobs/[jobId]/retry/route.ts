import { retryResearchJobNow, getResearchJobStore } from "@/adapters/research_jobs";
import { runResearchJobUntilSettled } from "@/engine/research_job_runner";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(_: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const { id, jobId } = await params;
    const existing = getResearchJobStore().get(jobId);
    if (!existing || existing.run_id !== id) {
      return Response.json({ error: "任务不存在" }, { status: 404 });
    }
    if (existing.status !== "retrying") {
      return Response.json({
        error: existing.status === "running"
          ? "任务已经开始重试"
          : "当前任务不在等待重试状态",
      }, { status: 409 });
    }
    const retried = retryResearchJobNow(jobId);
    if (!retried) {
      return Response.json({ error: "任务状态已变化，请刷新页面" }, { status: 409 });
    }
    after(() => {
      void runResearchJobUntilSettled(jobId, {
        workerId: `retry-after-${process.pid}`,
      }).catch(() => undefined);
    });
    return Response.json(retried, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
