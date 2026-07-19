import { createHash } from "node:crypto";
import { createArtifact, latestArtifact, listSources, supersedeOtherArtifactAttempts } from "@/adapters/db";
import { comparisonMetrics } from "@/engine/metrics";
import { EVALUATION_CRITERIA, evaluationSchema, evaluationSubmissionSchema } from "@/engine/schemas";
import { parseJson } from "@/engine/types";

export const runtime = "nodejs";

function blindedSideA(runId: string) {
  let value = 0;
  for (const character of runId) value = (value + character.charCodeAt(0)) % 997;
  return value % 2 === 0 ? "baseline" as const : "runtime" as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const runId = (await params).id;
    const submission = evaluationSubmissionSchema.parse(await request.json());
    const expectedKeys = new Set(EVALUATION_CRITERIA.flatMap((criterion) => [`A:${criterion}`, `B:${criterion}`]));
    const actualKeys = Object.keys(submission.scores);
    if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
      throw new Error("评分项必须完整且与冻结的 A/B 评估准则一致");
    }
    const baseline = latestArtifact(runId, "baseline", ["approved"]);
    const report = latestArtifact(runId, "stage_05", ["approved"]);
    const stage03 = latestArtifact(runId, "stage_03", ["approved"]);
    const stage04 = latestArtifact(runId, "stage_04", ["approved"]);
    if (!baseline || !report || !stage03 || !stage04) throw new Error("基线、stage_03、stage_04 和 stage_05 必须先确认");
    if (latestArtifact(runId, "evaluation", ["approved"])) {
      throw new Error("盲评身份已揭示，当前输入组合不得重评；若产物改变，请重新生成并确认上游阶段");
    }
    const stage03Hash = createHash("sha256").update(stage03.json_content).digest("hex");
    const baselineData = parseJson<any>(baseline.json_content, {});
    if (baselineData.frozen_stage03_artifact_id !== stage03.id || baselineData.frozen_stage03_artifact_hash !== stage03Hash) {
      throw new Error("基线已过期，必须基于当前冻结证据重新生成");
    }
    const value = evaluationSchema.parse({
      ...submission,
      metrics: comparisonMetrics(baseline, report, stage03, stage04, listSources(runId)),
      revealed: true,
      side_a: blindedSideA(runId),
      evaluated_at: new Date().toISOString(),
      baseline_artifact_id: baseline.id,
      runtime_report_artifact_id: report.id,
      frozen_stage03_artifact_id: stage03.id,
      frozen_stage03_artifact_hash: stage03Hash,
    });
    const artifact = createArtifact(runId, "evaluation", {
      status: "approved",
      json_content: JSON.stringify(value, null, 2),
      markdown_content: `# A/B 评价\n\n${Object.entries(value.scores).map(([key, score]) => `- ${key}: ${score}/5`).join("\n")}\n\n${value.notes}`,
      approved_at: new Date().toISOString(),
    });
    supersedeOtherArtifactAttempts(runId, "evaluation", artifact.id);
    return Response.json(artifact);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
