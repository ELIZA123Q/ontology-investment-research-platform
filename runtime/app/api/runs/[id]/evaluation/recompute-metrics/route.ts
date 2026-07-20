import { createHash } from "node:crypto";
import { createArtifact, latestArtifact, listSources, supersedeOtherArtifactAttempts } from "@/adapters/db";
import { COMPARISON_METRICS_VERSION, comparisonMetrics } from "@/engine/metrics";
import { evaluationSchema } from "@/engine/schemas";
import { parseJson } from "@/engine/types";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const runId = (await params).id;
    const prior = latestArtifact(runId, "evaluation", ["approved"]);
    const baseline = latestArtifact(runId, "baseline", ["approved"]);
    const report = latestArtifact(runId, "stage_05", ["approved"]);
    const stage03 = latestArtifact(runId, "stage_03", ["approved"]);
    const stage04 = latestArtifact(runId, "stage_04", ["approved"]);
    if (!prior || !baseline || !report || !stage03 || !stage04) throw new Error("缺少已批准的评价或冻结输入，不能重算指标");
    const priorData = evaluationSchema.parse(parseJson(prior.json_content, {}));
    const stage03Hash = createHash("sha256").update(stage03.json_content).digest("hex");
    if (priorData.baseline_artifact_id !== baseline.id
      || priorData.runtime_report_artifact_id !== report.id
      || priorData.frozen_stage03_artifact_id !== stage03.id
      || priorData.frozen_stage03_artifact_hash !== stage03Hash) {
      throw new Error("当前冻结输入与原盲评不一致；禁止借指标重算改变已揭示的 A/B 组合");
    }
    const recomputedAt = new Date().toISOString();
    const value = evaluationSchema.parse({
      ...priorData,
      metrics: comparisonMetrics(baseline, report, stage03, stage04, listSources(runId)),
      metrics_version: COMPARISON_METRICS_VERSION,
      metrics_recomputed_at: recomputedAt,
      supersedes_evaluation_artifact_id: prior.id,
    });
    const artifact = createArtifact(runId, "evaluation", {
      status: "approved",
      json_content: JSON.stringify(value, null, 2),
      markdown_content: `${prior.markdown_content}\n\n> 确定性指标于 ${recomputedAt} 使用 ${COMPARISON_METRICS_VERSION} 重算；A/B 评分、评价人、备注和揭示身份未改变。`,
      approved_at: recomputedAt,
      prompt_version: COMPARISON_METRICS_VERSION,
      input_context: JSON.stringify({
        prior_evaluation_artifact_id: prior.id,
        baseline_artifact_id: baseline.id,
        runtime_report_artifact_id: report.id,
        frozen_stage03_artifact_id: stage03.id,
        frozen_stage03_artifact_hash: stage03Hash,
        stage04_artifact_id: stage04.id,
      }, null, 2),
      tool_usage: JSON.stringify({ deterministic_metrics_recompute: true }),
    });
    supersedeOtherArtifactAttempts(runId, "evaluation", artifact.id);
    return Response.json(artifact);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
