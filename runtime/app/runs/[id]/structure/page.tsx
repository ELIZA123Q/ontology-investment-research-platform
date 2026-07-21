import { notFound, redirect } from "next/navigation";
import { getRun, latestArtifact } from "@/adapters/db";
import { RunNav } from "@/app/components/run-nav";
import { ResearchGraph, type ResearchGraphEdge, type ResearchGraphNode } from "@/app/components/research-graph";
import { normalizeCompetingExplanations } from "@/engine/structure_candidates";
import { parseJson } from "@/engine/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const artifact = latestArtifact(id, "stage_02", ["approved", "needs_review"]);
  // 尚无待审/已确认版本时，审阅页没有生成入口；默认进入阶段编辑页。
  if (!artifact) redirect(`/runs/${id}/stages/2`);
  const data: any = parseJson(artifact.json_content || "{}", {});
  const units = data.judgment_units || [];
  const unitIds = units.map((unit: any, index: number) => String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`));
  const nodes: ResearchGraphNode[] = [{ id: "research-question", label: run.question, meta: "研究问题", tone: run.parent_run_id ? "inherited" : "neutral", x: 0, y: Math.max(40, units.length * 85), details: { 范围状态: run.parent_run_id ? "从父运行继承" : "本轮定义", 运行状态: run.status } }];
  const edges: ResearchGraphEdge[] = [];
  units.forEach((unit: any, index: number) => {
    const unitId = unitIds[index];
    nodes.push({ id: unitId, label: unit.title || unit.statement || unit.question, meta: `${unitId} · ${unit.judgment_type || "关键判断"}`, tone: run.parent_run_id ? "inherited" : "support", x: 330, y: index * 190, details: { 判断问题: unit.question || unit.statement, 判断类型: unit.judgment_type, 证据要求: unit.evidence_requirements || unit.evidence_requirement_refs || [], 本体对象: unit.ontology_node_ids || unit.target_ontology_object_refs || [] } });
    edges.push({ id: `question-${unitId}`, source: "research-question", target: unitId, tone: run.parent_run_id ? "inherited" : "neutral" });
    const requirements = unit.evidence_requirements || unit.evidence_requirement_refs || [];
    requirements.forEach((requirement: unknown, reqIndex: number) => {
      const requirementId = `${unitId}-ER-${reqIndex + 1}`;
      nodes.push({ id: requirementId, label: String(requirement), meta: "必要证据", tone: "unknown", x: 680, y: index * 190 + reqIndex * 72, details: { 对应判断: unitId, 要求: requirement } });
      edges.push({ id: `${unitId}-${requirementId}`, source: unitId, target: requirementId, tone: "unknown" });
    });
  });
  const unitIndex = new Map(unitIds.map((unitId: string, index: number) => [unitId, index]));
  const competing = normalizeCompetingExplanations(data.competing_explanations, { unitIds });
  let unboundIndex = 0;
  competing.forEach((explanation, index) => {
    const boundUnits = explanation.judgment_unit_ids.filter((unitId) => unitIndex.has(unitId));
    const unbound = !boundUnits.length;
    const anchorIndex = boundUnits.length
      ? Math.min(...boundUnits.map((unitId) => Number(unitIndex.get(unitId) ?? 0)))
      : Number(units.length || 0);
    const y = unbound
      ? units.length * 190 + unboundIndex * 110
      : anchorIndex * 190 + 40 + (index % 3) * 36;
    if (unbound) unboundIndex += 1;
    const details: Record<string, unknown> = {
      竞争解释: explanation.statement,
      归属状态: unbound ? "待归属" : `挂接 ${boundUnits.join("、")}`,
      挂接判断单元: boundUnits.length ? boundUnits : "—",
    };
    nodes.push({
      id: explanation.explanation_id,
      label: explanation.statement,
      meta: unbound ? "竞争解释 · 待归属" : "竞争解释",
      tone: "weaken",
      x: unbound ? 0 : 1000,
      y,
      details,
    });
    if (unbound) {
      edges.push({ id: `question-${explanation.explanation_id}`, source: "research-question", target: explanation.explanation_id, tone: "weaken", label: "待归属" });
    } else {
      for (const unitId of boundUnits) {
        edges.push({ id: `${explanation.explanation_id}-${unitId}`, source: explanation.explanation_id, target: unitId, tone: "weaken", label: "竞争解释" });
      }
    }
  });
  return <>
    <RunNav runId={id} active="structure" />
    <div className="pagehead scene-head"><div><div className="eyebrow">研究结构</div><h1>{run.question}</h1><p className="muted">本页用研究员语言展示「要判断什么」；可执行对象与操作见 <Link href={`/runs/${id}/object-set`}>关系图</Link>。</p></div><div className="actions"><span className={`badge ${artifact.status === "approved" ? "" : "warn"}`}>{artifact.status === "approved" ? "已确认" : "待确认"}</span><Link className="button-secondary" href={`/runs/${id}/stages/2`}>高级编辑</Link></div></div>
    <ResearchGraph nodes={nodes} edges={edges} emptyMessage="完成阶段 02 后，问题树会在这里生成。" />
  </>;
}
