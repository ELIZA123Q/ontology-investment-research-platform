import { notFound } from "next/navigation";
import { getRun, latestArtifact, listSources, listWorkItems } from "@/adapters/db";
import { RunNav } from "@/app/components/run-nav";
import { EvidenceBoard } from "@/app/components/evidence-board";
import { parseJson } from "@/engine/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const structure: any = parseJson(latestArtifact(id, "stage_02", ["approved", "needs_review"])?.json_content || "{}", {});
  const evidenceData: any = parseJson(latestArtifact(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}", {});
  const sources = listSources(id);
  const candidates = sources.filter((source) => source.usability_status === "candidate" || source.source_type === "market_event_candidate");
  const units = (structure.judgment_units || []).map((unit: any, index: number) => ({ id: String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`), title: String(unit.title || unit.statement || unit.question), question: String(unit.question || unit.statement || "") }));
  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({ id: String(item.id || item.evidence_id || `EV-${index + 1}`), statement: String(item.statement || ""), kind: String(item.kind || "fact_draft"), direction: String(item.direction || "unknown"), source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String) : [], judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids.map(String) : Array.isArray(item.target_judgment_unit_refs) ? item.target_judgment_unit_refs.map(String) : [], limitations: Array.isArray(item.limitations) ? item.limitations.map(String) : [] }));
  const pending = listWorkItems(id).filter((item) => item.status === "pending");
  return <>
    <RunNav runId={id} active="evidence" />
    <div className="pagehead scene-head"><div><div className="eyebrow">阶段产物视图 · 03</div><h1>证据够不够，缺口在哪里？</h1><p className="muted">本页展示阶段 03 产物与待核验候选，不是实例图。按判断单元审阅支持、反证、冲突和缺口；图操作见 <Link href={`/runs/${id}/object-set`}>实例图</Link>。</p></div><div className="run-meta"><span>待处理 {pending.length}</span><span>证据 {evidence.length}</span><span>来源 {sources.length}</span></div></div>
    {candidates.length ? <section className="card" style={{ marginBottom: 16 }}><div className="panel-title"><div><span>待核验来源候选</span><strong>{candidates.length}</strong></div></div><ul className="source-list">{candidates.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"} · {source.locator || source.url} · 尚未成为 EvidenceFact</small></li>)}</ul></section> : null}
    {units.length ? <EvidenceBoard runId={id} units={units} evidence={evidence} sources={sources.map((source) => ({ ...source }))} workItems={listWorkItems(id).map((item) => ({ ...item }))} /> : <div className="card empty-state"><h2>先建立研究结构</h2><p className="muted">证据台必须按判断单元组织；请先确认问题树、竞争解释与必要证据。</p><Link className="button" href={`/runs/${id}/stages/2`}>进入结构生成</Link></div>}
  </>;
}
