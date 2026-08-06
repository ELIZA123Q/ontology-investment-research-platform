import { cancelResearchJob, getResearchJobStore } from "@/runner/research_jobs";
import { getArtifact, updateArtifactIfStatus } from "@/storage/db";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const { id, jobId } = await params;
    const existing = getResearchJobStore().get(jobId);
    if (!existing || existing.run_id !== id) {
      return Response.json({ error: "任务不存在" }, { status: 404 });
    }
    const cancelled = cancelResearchJob(jobId, "研究员取消了后台任务");
    if (!cancelled) {
      return Response.json({ error: "任务不存在或状态已变化" }, { status: 409 });
    }
    if (cancelled.artifact_id) {
      const artifact = getArtifact(cancelled.artifact_id);
      if (artifact?.run_id === id) {
        updateArtifactIfStatus(artifact.id, "running", {
          status: "failed",
          error_message: "[model_output_error] GENERATION_CANCELLED: 研究员取消了后台任务",
        });
      }
    }
    return Response.json(cancelled);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
