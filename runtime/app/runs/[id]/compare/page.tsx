import Link from "next/link";
import { latestArtifact, listSources } from "@/adapters/db";
import { CompareWorkspace } from "@/app/components/compare-workspace";
import { comparisonMetrics } from "@/engine/metrics";

export const dynamic = "force-dynamic";

export default async function Compare({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baselineRow = latestArtifact(id, "baseline", ["needs_review", "approved"]);
  const runtimeRow = latestArtifact(id, "stage_05", ["needs_review", "approved"]);
  const evaluationRow = latestArtifact(id, "evaluation");
  const metrics = baselineRow && runtimeRow ? comparisonMetrics(baselineRow, runtimeRow, latestArtifact(id, "stage_03", ["approved"]), latestArtifact(id, "stage_04", ["approved"]), listSources(id)) : {};
  const baseline = baselineRow ? { ...baselineRow } : undefined;
  const runtime = runtimeRow ? { ...runtimeRow } : undefined;
  const evaluation = evaluationRow ? { ...evaluationRow } : undefined;

  return <>
    <div className="pagehead"><div><div className="eyebrow">Baseline experiment</div><h1>普通 GPT vs 本体 Runtime</h1><Link className="backlink" href={`/runs/${id}`}>← 返回运行总览</Link></div></div>
    {baseline && runtime ? <CompareWorkspace runId={id} baseline={baseline} runtime={runtime} evaluation={evaluation} metrics={metrics} /> : <div className="card empty-state"><h2>对照材料尚未齐全</h2><p className="muted">需要普通 GPT 基线和阶段 05 报告后才能开始盲评。</p></div>}
  </>;
}
