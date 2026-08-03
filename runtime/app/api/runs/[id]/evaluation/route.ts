import { createHash } from "node:crypto";
import { createArtifact, latestArtifact, listSources, supersedeOtherArtifactAttempts } from "@/adapters/db";
import { isExperienceCohortRun } from "@/adapters/experience_cohort";
import { COMPARISON_METRICS_VERSION, comparisonMetrics } from "@/engine/metrics";
import { EVALUATION_CRITERIA, evaluationSchema, evaluationSubmissionSchema } from "@/engine/schemas";
import { parseJson } from "@/engine/types";
import { loadApprovedSemanticSnapshot } from "@/engine/semantic_reads";

export const runtime = "nodejs";

function blindedSideA(runId: string) {
  let value = 0;
  for (const character of runId) value = (value + character.charCodeAt(0)) % 997;
  return value % 2 === 0 ? "baseline" as const : "runtime" as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const runId = (await params).id;
    const priorEvaluation = latestArtifact(runId, "evaluation", ["approved"]);
    if (!priorEvaluation && !isExperienceCohortRun(runId)) {
      throw new Error("任务级同证据盲评已移出研究主链；请先在独立评测中心登记任务");
    }
    const submission = evaluationSubmissionSchema.parse(await request.json());
    const expectedKeys = new Set(EVALUATION_CRITERIA.flatMap((criterion) => [`A:${criterion}`, `B:${criterion}`]));
    const actualKeys = Object.keys(submission.scores);
    if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
      throw new Error("评分项必须完整且与冻结的 A/B 评估准则一致");
    }
    const baseline = latestArtifact(runId, "baseline", ["approved"]);
    const report = latestArtifact(runId, "stage_05", ["approved"]);
    const stage03 = loadApprovedSemanticSnapshot(runId, "stage_03").artifact;
    const stage04 = loadApprovedSemanticSnapshot(runId, "stage_04").artifact;
    if (!baseline || !report) throw new Error("基线、证据、判断与报告都必须先确认");
    if (priorEvaluation) {
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
      metrics_version: COMPARISON_METRICS_VERSION,
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
