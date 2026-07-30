import { createControlledIndependentReview } from "@/engine/workflow";
import { enqueueArtifactGeneration, runResearchJobUntilSettled } from "@/engine/research_job_runner";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    if (body.mode === "human_controlled") {
      return Response.json(createControlledIndependentReview(id, body.review || {}));
    }
    const job = enqueueArtifactGeneration({ runId: id, kind: "independent_review" });
    after(() => { void runResearchJobUntilSettled(job.id, { workerId: `next-after-${process.pid}` }).catch(() => undefined); });
    return Response.json(job, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
