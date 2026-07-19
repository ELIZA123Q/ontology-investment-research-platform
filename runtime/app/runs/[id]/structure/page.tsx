import { notFound } from "next/navigation";
import { getRun, latestArtifact } from "@/adapters/db";
import { RunNav } from "@/app/components/run-nav";
import { ResearchGraph, type ResearchGraphEdge, type ResearchGraphNode } from "@/app/components/research-graph";
import { parseJson } from "@/engine/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const artifact = latestArtifact(id, "stage_02", ["approved", "needs_review"]);
  const data: any = parseJson(artifact?.json_content || "{}", {});
  const units = data.judgment_units || [];
  const nodes: ResearchGraphNode[] = [{ id: "research-question", label: run.question, meta: "研究问题", tone: run.parent_run_id ? "inherited" : "neutral", x: 0, y: Math.max(40, units.length * 85), details: { 范围状态: run.parent_run_id ? "从父运行继承" : "本轮定义", 运行状态: run.status } }];
  const edges: ResearchGraphEdge[] = [];
  units.forEach((unit: any, index: number) => {
    const unitId = String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`);
    nodes.push({ id: unitId, label: unit.title || unit.statement || unit.question, meta: `${unitId} · ${unit.judgment_type || "关键判断"}`, tone: run.parent_run_id ? "inherited" : "support", x: 330, y: index * 190, details: { 判断问题: unit.question || unit.statement, 判断类型: unit.judgment_type, 证据要求: unit.evidence_requirements || unit.evidence_requirement_refs || [], 本体对象: unit.ontology_node_ids || unit.target_ontology_object_refs || [] } });
    edges.push({ id: `question-${unitId}`, source: "research-question", target: unitId, tone: run.parent_run_id ? "inherited" : "neutral" });
    const requirements = unit.evidence_requirements || unit.evidence_requirement_refs || [];
    requirements.forEach((requirement: unknown, reqIndex: number) => {
      const requirementId = `${unitId}-ER-${reqIndex + 1}`;
      nodes.push({ id: requirementId, label: String(requirement), meta: "必要证据", tone: "unknown", x: 680, y: index * 190 + reqIndex * 72, details: { 对应判断: unitId, 要求: requirement } });
      edges.push({ id: `${unitId}-${requirementId}`, source: unitId, target: requirementId, tone: "unknown" });
    });
  });
  (data.competing_explanations || []).forEach((explanation: any, index: number) => {
    const nodeId = String(explanation.id || explanation.explanation_id || `CE-${index + 1}`);
    nodes.push({ id: nodeId, label: explanation.statement || String(explanation), meta: "竞争解释", tone: "weaken", x: 680, y: units.length * 190 + index * 110, details: explanation });
    edges.push({ id: `question-${nodeId}`, source: "research-question", target: nodeId, tone: "weaken", label: "必须排除" });
  });
  return <>
    <RunNav runId={id} active="structure" />
    <div className="pagehead scene-head"><div><div className="eyebrow">阶段产物视图 · 02</div><h1>这个问题，真正需要判断什么？</h1><p className="muted">本页展示阶段 02 产物投影，不是实例图。判断单元、必要证据与竞争解释以研究员语言呈现；可执行对象与 Action 见 <Link href={`/runs/${id}/object-set`}>实例图</Link>。</p></div><div className="actions"><span className={`badge ${artifact?.status === "approved" ? "" : "warn"}`}>{artifact?.status || "not started"}</span><Link className="button-secondary" href={`/runs/${id}/stages/2`}>{artifact ? "高级编辑" : "生成研究结构"}</Link></div></div>
    <ResearchGraph nodes={nodes} edges={edges} emptyMessage="完成阶段 02 后，问题树会在这里生成。" />
  </>;
}
