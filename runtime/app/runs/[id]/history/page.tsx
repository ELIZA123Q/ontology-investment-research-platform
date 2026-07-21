import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun, latestArtifact, listArtifacts, listRuns, listSources } from "@/adapters/db";
import { RunChrome } from "@/app/components/run-chrome";
import { runDifferenceAttribution } from "@/engine/metrics";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { parseJson, type Artifact } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const parent = run.parent_run_id ? getRun(run.parent_run_id) : undefined;
  const children = listRuns().filter((candidate) => candidate.parent_run_id === id);
  const artifacts = listArtifacts(id);
  const pairs = parent ? [{ previous: parent, current: run }] : children.map((child) => ({ previous: run, current: child }));
  const comparisons = pairs.map(({ previous, current }) => ({
    previous,
    current,
    attribution: runDifferenceAttribution(
      { stage03: latestArtifact(previous.id, "stage_03", ["approved"]), stage04: latestArtifact(previous.id, "stage_04", ["approved"]), sources: boundSources(previous.id, latestArtifact(previous.id, "stage_03", ["approved"])) },
      { stage03: latestArtifact(current.id, "stage_03", ["approved"]), stage04: latestArtifact(current.id, "stage_04", ["approved"]), sources: boundSources(current.id, latestArtifact(current.id, "stage_03", ["approved"])) },
    ),
  }));
  return <>
    <RunChrome runId={id} active="history" />
    <div className="pagehead scene-head"><div><div className="eyebrow">研究历史</div><h1>这次判断是怎样变化的？</h1><p className="muted">父子研究、触发事件和阶段版本均保留，不覆盖历史结论。</p></div></div>
    <div className="history-grid">
      <section className="card"><div className="panel-title"><div><span>研究关系</span></div></div>{parent ? <Link className="history-run parent" href={`/runs/${parent.id}`}><span>上一轮</span><strong>{parent.question}</strong><small>{parent.created_at}</small></Link> : <div className="history-run root"><span>起点</span><strong>这是该研究链的起点</strong></div>}{children.map((child) => <Link className="history-run child" href={`/runs/${child.id}`} key={child.id}><span>增量研究</span><strong>{child.question}</strong><small>{child.created_at}</small></Link>)}</section>
      <section className="card"><div className="panel-title"><div><span>阶段版本</span><strong>{artifacts.length}</strong></div></div><div className="artifact-ledger">{artifacts.map((artifact) => <div key={artifact.id}><span>{({ stage_01: "研究范围", stage_02: "研究结构", stage_03: "证据", stage_04: "判断", stage_05: "报告表达", baseline: "同证据对照基线", evaluation: "A/B 盲评", independent_review: "独立审阅", change_set: "增量变更", action_audit: "操作记录", instance_graph: "关系图" } as Record<string, string>)[artifact.kind] || artifact.kind}</span><strong>第 {artifact.version} 版 · {({ draft: "草稿", running: "生成中", needs_review: "待确认", approved: "已确认", failed: "失败", cancelled: "已取消", superseded: "已被新版取代" } as Record<string, string>)[artifact.status] || artifact.status}</strong><small>{artifact.created_at}</small></div>)}</div></section>
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
  return evidenceBoundSources(listSources(runId), parseJson(stage03?.json_content || "{}", {}));
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
