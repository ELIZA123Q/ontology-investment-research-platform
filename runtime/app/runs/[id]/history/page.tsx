import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import {
  latestArtifactPayload,
  listArtifactLedger,
  listChildRuns,
  listSourcesForAttribution,
} from "@/adapters/db_read_models";
import { RunArchivePanel } from "@/app/components/run-archive-panel";
import { runDifferenceAttribution } from "@/engine/metrics";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { parseJson, type Artifact } from "@/engine/types";
import { buildRunArchive } from "@/engine/run_archive";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const parent = run.parent_run_id ? getRun(run.parent_run_id) : undefined;
  const children = listChildRuns(id);
  const artifacts = listArtifactLedger(id);
  const archive = buildRunArchive(id);
  const pairs = parent ? [{ previous: parent, current: run }] : children.map((child) => ({ previous: run, current: child }));
  const comparisons = pairs.map(({ previous, current }) => ({
    previous,
    current,
    attribution: runDifferenceAttribution(
      { stage03: latestArtifactPayload(previous.id, "stage_03", ["approved"]) as any, stage04: latestArtifactPayload(previous.id, "stage_04", ["approved"]) as any, sources: boundSources(previous.id, latestArtifactPayload(previous.id, "stage_03", ["approved"]) as any) },
      { stage03: latestArtifactPayload(current.id, "stage_03", ["approved"]) as any, stage04: latestArtifactPayload(current.id, "stage_04", ["approved"]) as any, sources: boundSources(current.id, latestArtifactPayload(current.id, "stage_03", ["approved"]) as any) },
    ),
  }));
  return <>
    <div className="pagehead scene-head"><div><div className="eyebrow">研究历史档案</div><h1>本轮产出文件包</h1><p className="muted">按阶段保留可复盘产出，可直接下载整包或逐项预览。</p></div></div>
    <RunArchivePanel runId={id} archive={archive} />
    <div className="history-grid" style={{ marginTop: 16 }}>
      <section className="card"><div className="panel-title"><div><span>研究关系</span></div></div>{parent ? <Link className="history-run parent" href={`/runs/${parent.id}`}><span>上一轮</span><strong>{parent.question}</strong><small>{parent.created_at}</small></Link> : <div className="history-run root"><span>起点</span><strong>这是该研究链的起点</strong></div>}{children.map((child) => <Link className="history-run child" href={`/runs/${child.id}`} key={child.id}><span>增量研究</span><strong>{child.question}</strong><small>{child.created_at}</small></Link>)}</section>
      <section className="card"><div className="panel-title"><div><span>阶段版本</span><strong>{artifacts.length}</strong></div></div><div className="artifact-ledger">{artifacts.map((artifact) => <div key={artifact.id}><span>{artifact.kind}</span><strong>第 {artifact.version} 版 · {artifact.status}</strong><small>{artifact.created_at}</small></div>)}</div></section>
      {comparisons.map(({ previous, current, attribution }) => <section className="card history-comparison" key={`${previous.id}-${current.id}`}>
        <div className="panel-title"><div><span>前后轮差异</span><strong>{classificationLabel(current.trigger_classification)}</strong></div><Link href={`/runs/${current.id}`}>查看后续研究 →</Link></div>
        <div className="comparison-head"><div><small>上一轮</small><strong>{previous.id.slice(0, 8)}</strong></div><span>→</span><div><small>本轮</small><strong>{current.id.slice(0, 8)}</strong></div></div>
        <div className="comparison-columns">
          <div><span>来源变化</span><strong>{attribution.evidence.added_sources.length + attribution.evidence.removed_sources.length + attribution.evidence.changed_sources.length}</strong>{attribution.evidence.added_sources.slice(0, 3).map((source) => <small key={`add:${source}`}>新增 · {source}</small>)}{attribution.evidence.removed_sources.slice(0, 3).map((source) => <small key={`remove:${source}`}>移除 · {source}</small>)}{attribution.evidence.changed_sources.slice(0, 3).map((source) => <small key={`change:${source.url}`}>正文/质量变化 · {source.url}</small>)}</div>
          <div><span>方法变化</span><strong>{attribution.methods.changed.length}</strong>{attribution.methods.changed.slice(0, 5).map((item) => <small key={item.id}>{item.id}: {methodLabel(item.previous)} → {methodLabel(item.current)}</small>)}</div>
          <div><span>判断变化</span><strong>{attribution.judgments.changed.length}</strong>{attribution.judgments.changed.slice(0, 5).map((item) => <small key={item.id}>{item.id} · {item.change}</small>)}</div>
          <div className={attribution.unexplained_model_variation ? "risk" : ""}><span>无法解释的模型波动</span><strong>{attribution.unexplained_model_variation ? "有" : "无"}</strong><small>{attribution.causes.join("、")}</small></div>
        </div>
      </section>)}
    </div>
  </>;
}

function boundSources(runId: string, stage03?: Artifact) {
  return evidenceBoundSources(listSourcesForAttribution(runId) as any, parseJson(stage03?.json_content || "{}", {}));
}

function classificationLabel(value: string | null) {
  return ({ evidence_update: "证据更新", structure_revision: "结构变化", scope_revision: "范围变化" } as Record<string, string>)[value || ""] || "未分类";
}

function methodLabel(value: string | null) {
  if (!value) return "无";
  try {
    const item = JSON.parse(value);
    return `${item.method_id || "?"}@${item.method_version || "?"} · ${item.status || "?"} · 证据${item.input_evidence_refs?.length || 0}`;
  } catch {
    return value;
  }
}
