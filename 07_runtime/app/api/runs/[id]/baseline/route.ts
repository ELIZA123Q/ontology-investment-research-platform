import { enqueueArtifactGeneration, runResearchJobUntilSettled } from "@/runner/research_job_runner";
import { isExperienceCohortRun } from "@/runner/experience_cohort_adapter";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const runId = (await params).id;
    if (!isExperienceCohortRun(runId)) {
      throw new Error("任务级同证据盲评已移出研究主链；请先在独立评测中心登记任务");
    }
    const job = enqueueArtifactGeneration({ runId, kind: "baseline" });
    after(() => { void runResearchJobUntilSettled(job.id, { workerId: `next-after-${process.pid}` }).catch(() => undefined); });
    return Response.json(job, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
