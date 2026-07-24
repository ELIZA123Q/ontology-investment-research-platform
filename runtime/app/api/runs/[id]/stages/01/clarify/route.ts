import { clarifyStage01 } from "@/engine/workflow";
import { enqueueArtifactGeneration, runNextResearchJob } from "@/engine/research_job_runner";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const batchAnswers = Array.isArray(body.answers)
    ? body.answers.map((item: any) => ({
      question_id: item?.question_id ? String(item.question_id) : undefined,
      answer: String(item?.answer || "").trim(),
    }))
    : null;
  const singleAnswer = String(body.answer || "").trim();
  if ((!batchAnswers || !batchAnswers.length) && !singleAnswer) {
    return Response.json({ error: "澄清回答不能为空" }, { status: 400 });
  }
  try {
    const artifact = clarifyStage01(
      id,
      batchAnswers && batchAnswers.length
        ? batchAnswers
        : singleAnswer,
      {
        question_id: body.question_id ? String(body.question_id) : undefined,
      },
    );
    const regenerate = body.regenerate !== false;
    if (regenerate) {
      const job = enqueueArtifactGeneration({ runId: id, kind: "stage_01" });
      after(() => { void runNextResearchJob({ workerId: `next-after-${process.pid}` }).catch(() => undefined); });
      return Response.json({ artifact, job, regenerating: true }, { status: 202 });
    }
    return Response.json({ artifact, regenerating: false });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
