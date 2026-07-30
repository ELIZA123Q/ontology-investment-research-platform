import { enqueueArtifactGeneration, runResearchJobUntilSettled } from "@/engine/research_job_runner";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const job = enqueueArtifactGeneration({ runId: (await params).id, kind: "baseline" });
    after(() => { void runResearchJobUntilSettled(job.id, { workerId: `next-after-${process.pid}` }).catch(() => undefined); });
    return Response.json(job, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
