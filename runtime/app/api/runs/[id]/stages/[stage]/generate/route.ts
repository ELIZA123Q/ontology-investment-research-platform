import {
  createControlledEvidenceProjection,
  createControlledJudgmentProjection,
  createControlledStructureProjection,
  createEvidenceGapFallback,
  createJudgmentGapFallback,
  createStage01DeterministicProjection,
  createStage05DeterministicProjection,
} from "@/engine/workflow";
import { enqueueArtifactGeneration, runNextResearchJob } from "@/engine/research_job_runner";
import { STAGES } from "@/engine/types";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  try {
    const { id, stage } = await params;
    const kind = `stage_${stage.padStart(2, "0")}`;
    if (!STAGES.includes(kind as any)) return Response.json({ error: "阶段不存在" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (kind === "stage_01" && body.mode === "deterministic_projection") {
      return Response.json(createStage01DeterministicProjection(id, body.scope || {}));
    }
    if (kind === "stage_02" && body.mode === "controlled_structure_projection") {
      return Response.json(createControlledStructureProjection(id, body.structure || {}));
    }
    if (kind === "stage_03" && body.mode === "evidence_supplement") {
      const job = enqueueArtifactGeneration({ runId: id, kind: kind as any, mode: "evidence_supplement" });
      after(() => { void runNextResearchJob({ workerId: `next-after-${process.pid}` }).catch(() => undefined); });
      return Response.json(job, { status: 202 });
    }
    if (kind === "stage_03" && body.mode === "controlled_evidence_projection") {
      return Response.json(createControlledEvidenceProjection(id, body.bindings || []));
    }
    if (kind === "stage_03" && body.mode === "explicit_gap_fallback") {
      return Response.json(createEvidenceGapFallback(id, String(body.reason || "公开来源取得或模型结构化提交失败")));
    }
    if (kind === "stage_04" && body.mode === "controlled_judgment_projection") {
      return Response.json(createControlledJudgmentProjection(id, body.judgments || []));
    }
    if (kind === "stage_04" && body.mode === "explicit_j0_fallback") {
      return Response.json(createJudgmentGapFallback(id, String(body.reason || "上游只有经人工接受的证据缺口，且模型裁决未在硬时限内完成")));
    }
    if (kind === "stage_05" && body.mode === "deterministic_projection") {
      return Response.json(createStage05DeterministicProjection(id));
    }
    const job = enqueueArtifactGeneration({ runId: id, kind: kind as any });
    after(() => { void runNextResearchJob({ workerId: `next-after-${process.pid}` }).catch(() => undefined); });
    return Response.json(job, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
