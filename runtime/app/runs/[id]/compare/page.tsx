import Link from "next/link";
import { latestArtifactPayload, listSourcesForReview } from "@/adapters/db_read_models";
import { CompareWorkspaceLazy } from "@/app/components/compare-workspace-lazy";
import { artifactForWorkspace } from "@/app/lib/client-rows";
import { comparisonMetrics } from "@/engine/metrics";

export const dynamic = "force-dynamic";

export default async function Compare({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baselineRow = latestArtifactPayload(id, "baseline", ["needs_review", "approved"]);
  const runtimeRow = latestArtifactPayload(id, "stage_05", ["needs_review", "approved"]);
  const evaluationRow = latestArtifactPayload(id, "evaluation", ["approved"]);
  const metrics = baselineRow && runtimeRow
    ? comparisonMetrics(
      baselineRow as any,
      runtimeRow as any,
      latestArtifactPayload(id, "stage_03", ["approved"]) as any,
      latestArtifactPayload(id, "stage_04", ["approved"]) as any,
      listSourcesForReview(id) as any,
    )
    : {};
  const baseline = baselineRow ? artifactForWorkspace(baselineRow) : undefined;
  const runtime = runtimeRow ? artifactForWorkspace(runtimeRow) : undefined;
  const evaluation = evaluationRow ? artifactForWorkspace(evaluationRow) : undefined;

  return <>
    <div className="pagehead"><div><div className="eyebrow">对照实验</div><h1>同证据直接生成 vs 本体约束研究</h1><Link className="backlink" href={`/runs/${id}`}>← 返回研究总览</Link></div></div>
    {baseline && runtime ? <CompareWorkspaceLazy runId={id} baseline={baseline} runtime={runtime} evaluation={evaluation} metrics={metrics} canEvaluate={baseline.status === "approved" && runtime.status === "approved"} /> : <div className="card empty-state"><h2>对照材料尚未齐全</h2><p className="muted">需要同证据对照基线和报告表达后才能开始盲评。</p></div>}
  </>;
}
