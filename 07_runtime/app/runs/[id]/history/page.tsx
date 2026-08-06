import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/storage/db";
import {
  latestArtifactPayload,
  listArtifactLedger,
  listChildRuns,
  listSourcesForAttribution,
} from "@/storage/db_read_models";
import { RunArchivePanel } from "@/app/components/run-archive-panel";
import { artifactKindLabel, artifactStatusLabel, differenceCauseLabel } from "@/app/lib/ui-labels";
import { runDifferenceAttribution } from "@/metrics";
import { evidenceBoundSources } from "@/skills/evidence_evaluation/sources";
import { parseJson, type Artifact } from "@/schemas/types";
import { buildRunArchive } from "@/runner/run_archive";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const parent = run.parent_run_id ? getRun(run.parent_run_id) : undefined;
  const children = listChildRuns(id);
  const artifacts = listArtifactLedger(id);
  const archive = buildRunArchive(id);
  const stageKinds = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"];
  const currentStageArtifacts = stageKinds.map((kind) => ({
    kind,
    artifact: artifacts.find((item) => item.kind === kind),
  }));
  const pairs = parent ? [{ previous: parent, current: run }] : children.map((child) => ({ previous: run, current: child }));
  const comparisons = pairs.map(({ previous, current }) => ({
    previous,
    current,
    attribution: runDifferenceAttribution(
      { stage03: latestArtifactPayload(previous.id, "stage_03", ["approved"]) as any, stage04: latestArtifactPayload(previous.id, "stage_04", ["approved"]) as any, sources: boundSources(previous.id, latestArtifactPayload(previous.id, "stage_03", ["approved"]) as any) },
      { stage03: latestArtifactPayload(current.id, "stage_03", ["approved"]) as any, stage04: latestArtifactPayload(current.id, "stage_04", ["approved"]) as any, sources: boundSources(current.id, latestArtifactPayload(current.id, "stage_03", ["approved"]) as any) },
    ),
  }));
  const linkedRunCount = 1 + (parent ? 1 : 0) + children.length;
  return <>
    <ReferenceSceneChrome
      sceneId="history"
      banner={{
        title: linkedRunCount > 1 ? `${linkedRunCount} 轮相互关联的研究` : "本轮是这条研究链的起点",
        subtitle: run.question,
        note: "研究员用这里回答：哪一阶段改过、为什么重开、结论变化由证据还是方法导致。",
      }}
    />
    <div className="history-grid" style={{ marginTop: 16 }}>
      <section className="card"><div className="panel-title"><div><span>研究关系</span></div></div>{parent ? <Link className="history-run parent" href={`/runs/${parent.id}`}><span>上一轮</span><strong>{parent.question}</strong><small>{formatHistoryTime(parent.created_at)}</small></Link> : <div className="history-run root"><span>起点</span><strong>这是该研究链的起点</strong></div>}{children.map((child) => <Link className="history-run child" href={`/runs/${child.id}`} key={child.id}><span>增量研究</span><strong>{child.question}</strong><small>{formatHistoryTime(child.created_at)}</small></Link>)}</section>
      <section className="card"><div className="panel-title"><div><span>当前阶段产出</span><strong>{currentStageArtifacts.filter((item) => item.artifact?.status === "approved").length}/5 已确认</strong></div></div><div className="stage-history-summary">{currentStageArtifacts.map(({ kind, artifact }, index) => <div key={kind} className={artifact?.status === "approved" ? "complete" : ""}><b>{String(index + 1).padStart(2, "0")}</b><span>{artifactKindLabel(kind)}</span><strong>{artifact ? artifactStatusLabel(artifact.status) : "尚未开始"}</strong><small>{artifact ? `第 ${artifact.version} 版 · ${formatHistoryTime(artifact.created_at)}` : "—"}</small></div>)}</div></section>
      {comparisons.map(({ previous, current, attribution }) => <section className="card history-comparison" key={`${previous.id}-${current.id}`}>
        <div className="panel-title"><div><span>前后轮差异</span><strong>{classificationLabel(current.trigger_classification)}</strong></div>{current.id !== id ? <Link href={`/runs/${current.id}`}>查看后续研究 →</Link> : null}</div>
        <div className="comparison-head"><div><small>上一轮</small><strong>{runShortLabel(previous.question)}</strong></div><span>→</span><div><small>本轮</small><strong>{runShortLabel(current.question)}</strong></div></div>
        <div className="comparison-columns">
          <div><span>来源变化</span><strong>{attribution.evidence.added_sources.length + attribution.evidence.removed_sources.length + attribution.evidence.changed_sources.length}</strong>{groupSourceHosts(attribution.evidence.added_sources).slice(0, 3).map((source) => <small key={`add:${source.host}`}>新增 · {source.host}{source.count > 1 ? ` × ${source.count}` : ""}</small>)}{groupSourceHosts(attribution.evidence.removed_sources).slice(0, 3).map((source) => <small key={`remove:${source.host}`}>移除 · {source.host}{source.count > 1 ? ` × ${source.count}` : ""}</small>)}{groupSourceHosts(attribution.evidence.changed_sources.map((source) => source.url)).slice(0, 3).map((source) => <small key={`change:${source.host}`}>正文或质量变化 · {source.host}{source.count > 1 ? ` × ${source.count}` : ""}</small>)}</div>
          <div><span>研究方法变化</span><strong>{attribution.methods.changed.length}</strong>{attribution.methods.changed.slice(0, 5).map((item, index) => <small key={item.id}>方法 {index + 1} · {methodChangeLabel(item.previous, item.current)}</small>)}</div>
          <div><span>判断变化</span><strong>{attribution.judgments.changed.length}</strong>{attribution.judgments.changed.slice(0, 5).map((item, index) => <small key={item.id}>判断 {index + 1} · {item.change}</small>)}</div>
          <div className={attribution.unexplained_model_variation ? "risk" : ""}><span>未能归因的结果变化</span><strong>{attribution.unexplained_model_variation ? "有" : "无"}</strong><small>{attribution.causes.map(differenceCauseLabel).join("、")}</small></div>
        </div>
      </section>)}
    </div>
    <details className="advanced-tools stage-audit-details history-audit-details">
      <summary>
        <div>
          <div className="eyebrow">审计档案</div>
          <strong>原始文件、全部版本与系统校验记录</strong>
        </div>
        <span className="section-meta">{archive.summary.total_files} 个文件 · {artifacts.length} 个版本记录</span>
      </summary>
      <RunArchivePanel runId={id} archive={archive} />
      <section className="card history-full-ledger">
        <div className="panel-title"><div><span>全部版本记录</span><strong>{artifacts.length}</strong></div></div>
        <div className="artifact-ledger">{artifacts.map((artifact) => <div key={artifact.id}><span>{artifactKindLabel(artifact.kind)}</span><strong>第 {artifact.version} 版 · {artifactStatusLabel(artifact.status)}</strong><small>{formatHistoryTime(artifact.created_at)}</small></div>)}</div>
      </section>
    </details>
  </>;
}

function boundSources(runId: string, stage03?: Artifact) {
  return evidenceBoundSources(listSourcesForAttribution(runId) as any, parseJson(stage03?.json_content || "{}", {}));
}

function classificationLabel(value: string | null) {
  return ({ evidence_update: "证据更新", structure_revision: "结构变化", scope_revision: "范围变化" } as Record<string, string>)[value || ""] || "未分类";
}

function methodChangeLabel(previous: string | null, current: string | null) {
  if (!previous) return "新增";
  if (!current) return "移除";
  try {
    const before = JSON.parse(previous);
    const after = JSON.parse(current);
    const status = (value: string) => ({
      executed: "已执行",
      blocked: "受阻",
      rejected: "不适用",
      degraded: "降级执行",
      proposed: "待执行",
    } as Record<string, string>)[value] || "状态变化";
    return `${status(before.status)} → ${status(after.status)}；输入事实 ${before.input_evidence_refs?.length || 0} → ${after.input_evidence_refs?.length || 0}`;
  } catch {
    return "执行记录变化";
  }
}

function runShortLabel(question: string) {
  const value = question.trim();
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "来源记录";
  }
}

function groupSourceHosts(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const host = sourceHost(value);
    counts.set(host, (counts.get(host) || 0) + 1);
  });
  return Array.from(counts, ([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
}

function formatHistoryTime(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}
