import Link from "next/link";
import { redirect } from "next/navigation";
import { latestArtifact, listWorkItems } from "@/adapters/db";
import { IndependentReviewButton } from "@/app/components/independent-review-button";
import { ResearchGraph, type ResearchGraphEdge, type ResearchGraphNode } from "@/app/components/research-graph";
import { RunChrome } from "@/app/components/run-chrome";
import { ControlledJudgmentProjectionForm } from "@/app/components/controlled-projection-forms";
import { normalizeCompetingExplanations } from "@/engine/structure_candidates";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function Judgments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifact(id, "stage_04", ["approved", "needs_review"]);
  // 尚无待审/已确认版本时，审阅页没有生成入口；默认进入阶段编辑页。
  if (!artifact) redirect(`/runs/${id}/stages/4`);
  const evidenceData: any = parseJson(latestArtifact(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}", {});
  const structureData: any = parseJson(latestArtifact(id, "stage_02", ["approved"])?.json_content || "{}", {});
  const reviewArtifact = latestArtifact(id, "independent_review", ["needs_review", "approved"]);
  const review: any = parseJson(reviewArtifact?.json_content || "{}", {});
  const data: any = parseJson(artifact.json_content || "{}", {});
  const workItems = listWorkItems(id);
  const nodes: ResearchGraphNode[] = [];
  const edges: ResearchGraphEdge[] = [];
  const structureUnitIds = (structureData.judgment_units || []).map((unit: any, index: number) => String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`));
  const structureCompetingExplanations = normalizeCompetingExplanations(structureData.competing_explanations, { unitIds: structureUnitIds });

  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({ ...item, _id: String(item.id || item.evidence_id || `EV-${index + 1}`) }));
  evidence.forEach((item: any, index: number) => nodes.push({ id: item._id, label: item.statement, meta: item.kind === "counter" ? "反证" : item.kind === "gap" ? "缺口" : "证据", tone: item.kind === "counter" || item.direction === "weaken" ? "weaken" : item.kind === "conflict" ? "danger" : item.kind === "gap" ? "unknown" : "support", x: 0, y: index * 105, details: { 方向: item.direction, 来源: item.source_ids || [], 局限: item.limitations || [], 审阅状态: workItems.find((work) => work.target_id === item._id)?.status || "未创建工作项" } }));

  const signals = (data.signals || []).map((item: any, index: number) => ({ ...item, _id: String(item.id || item.signal_id || `SIG-${index + 1}`) }));
  signals.forEach((item: any, index: number) => {
    nodes.push({ id: item._id, label: item.statement, meta: "信号", tone: item.role === "support" ? "support" : item.role === "block" ? "danger" : item.role === "weaken" ? "weaken" : "neutral", x: 330, y: index * 125, details: { 角色: item.role, 对应判断单元: item.judgment_unit_ids || [], 证据引用: item.evidence_draft_ids || item.evidence_refs || [] } });
    for (const ref of item.evidence_draft_ids || item.evidence_refs || []) if (nodes.some((node) => node.id === ref)) edges.push({ id: `${ref}-${item._id}`, source: ref, target: item._id, tone: item.role === "block" ? "danger" : item.role === "weaken" ? "weaken" : "support" });
  });

  const hypotheses = (data.hypotheses || []).map((item: any, index: number) => ({ ...item, _id: String(item.id || item.hypothesis_id || `H-${index + 1}`) }));
  hypotheses.forEach((item: any, index: number) => {
    nodes.push({ id: item._id, label: item.statement, meta: "可证伪假设", tone: "inherited", x: 650, y: index * 155, details: { 时间范围: item.time_horizon, 证伪条件: item.falsification_conditions || [], 信号: item.signal_ids || item.signal_refs || [] } });
    const refs = item.signal_ids || item.signal_refs || signals.filter((signal: any) => (signal.target_hypothesis_ids || []).includes(item._id) || signal.target_hypothesis_ref === item._id).map((signal: any) => signal._id);
    for (const ref of refs) if (signals.some((signal: any) => signal._id === ref)) edges.push({ id: `${ref}-${item._id}`, source: ref, target: item._id, tone: "inherited" });
  });

  const competitors = (data.competing_explanations || []).map((item: any, index: number) => ({ ...item, _id: String(item.id || item.explanation_id || `CE-${index + 1}`) }));
  competitors.forEach((item: any, index: number) => {
    nodes.push({
      id: item._id,
      label: item.statement,
      meta: "竞争解释",
      tone: item.status === "eliminated" ? "unknown" : "weaken",
      x: 650,
      y: Math.max(220, hypotheses.length * 155) + index * 130,
      details: {
        状态: item.status || "未排除",
        信号: item.signal_ids || item.signal_refs || [],
        排除理由: item.elimination_rationale || "",
        Stage02溯源: item.source_explanation_id || "—",
        挂接判断单元: item.judgment_unit_ids || [],
      },
    });
    for (const ref of item.signal_ids || item.signal_refs || []) if (signals.some((signal: any) => signal._id === ref)) edges.push({ id: `${ref}-${item._id}`, source: ref, target: item._id, tone: "weaken" });
  });

  const judgments = (data.judgments || []).map((item: any, index: number) => ({ ...item, _id: String(item.id || item.judgment_id || `C-${index + 1}`) }));
  judgments.forEach((item: any, index: number) => {
    const issues = (review.issues || []).filter((issue: any) => !issue.judgment_id || issue.judgment_id === item._id);
    const strength = String(item.strength || item.level || "J0");
    nodes.push({ id: item._id, label: item.conclusion || item.statement || item.title, meta: `判断 · ${strength}`, tone: issues.length ? "danger" : strength === "J0" ? "unknown" : strength === "J1" ? "weaken" : "support", x: 980, y: index * 190, details: { 判断标题: item.title, 结论强度: strength, 为什么: item.rationale, 不确定性: item.uncertainties || [], 失效条件: item.invalidation_conditions || [], 跟踪信号: item.tracking_signals || [], 独立审阅问题: issues.map((issue: any) => issue.description), 审阅状态: workItems.find((work) => work.target_id === item._id)?.status || "未创建工作项" } });
    const hypothesisRefs = item.hypothesis_ids || item.hypothesis_refs || [];
    if (hypothesisRefs.length) for (const ref of hypothesisRefs) if (hypotheses.some((hypothesis: any) => hypothesis._id === ref)) edges.push({ id: `${ref}-${item._id}`, source: ref, target: item._id, tone: "inherited" });
    else {
      const unitId = item.judgment_unit_id || item.judgment_unit_ref;
      const matchedSignals = signals.filter((signal: any) => !unitId || (signal.judgment_unit_ids || []).includes(unitId));
      for (const signal of matchedSignals) edges.push({ id: `${signal._id}-${item._id}`, source: signal._id, target: item._id, tone: signal.role === "block" ? "danger" : signal.role === "weaken" ? "weaken" : "support" });
      if (!matchedSignals.length) for (const ref of [...(item.supporting_evidence_draft_ids || []), ...(item.counter_evidence_draft_ids || [])]) if (evidence.some((ev: any) => ev._id === ref)) edges.push({ id: `${ref}-${item._id}`, source: ref, target: item._id, tone: (item.counter_evidence_draft_ids || []).includes(ref) ? "weaken" : "support" });
    }
    const unitId = String(item.judgment_unit_id || item.judgment_unit_ref || "");
    for (const competitor of competitors) {
      const boundUnits = Array.isArray(competitor.judgment_unit_ids) ? competitor.judgment_unit_ids.map(String) : [];
      const matchesUnit = boundUnits.length ? boundUnits.includes(unitId) : !unitId;
      if (matchesUnit) edges.push({ id: `${competitor._id}-${item._id}`, source: competitor._id, target: item._id, tone: "weaken", label: "竞争解释" });
    }
  });

  (review.issues || []).filter((issue: any) => !issue.judgment_id || !judgments.some((judgment: any) => judgment._id === issue.judgment_id)).forEach((issue: any, index: number) => {
    const issueId = `review-issue-${index + 1}`;
    nodes.push({ id: issueId, label: issue.required_action || issue.description, meta: `独立审阅 · 退回 ${issue.return_stage}`, tone: "danger", x: 1290, y: index * 150, details: { 问题类型: issue.issue_type, 问题描述: issue.description, 需要动作: issue.required_action, 退回位置: issue.return_stage, 证据引用: issue.evidence_refs || [] } });
  });

  return <>
    <RunChrome runId={id} active="judgment" />
    <div className="pagehead scene-head"><div><div className="eyebrow">判断审阅</div><h1>现有证据，允许说到多强？</h1><p className="muted">从证据、信号和竞争解释逐层检查判断；对象操作请到 <Link href={`/runs/${id}/object-set`}>关系图</Link>。</p></div><div className="actions">{artifact?.status === "approved" ? <IndependentReviewButton runId={id} completed={Boolean(reviewArtifact)} /> : null}<Link className="button-secondary" href={`/runs/${id}/stages/4`}>高级编辑</Link></div></div>
    <ControlledJudgmentProjectionForm
      runId={id}
      units={(structureData.judgment_units || []).map((unit: any, index: number) => ({ id: String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`), title: String(unit.title || unit.statement || unit.question), ontology_node_ids: Array.isArray(unit.ontology_node_ids) ? unit.ontology_node_ids.map(String) : [] }))}
      evidence={evidence.filter((item: any) => item.kind !== "gap").map((item: any) => ({ id: item._id, statement: String(item.statement || ""), judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids.map(String) : [], direction: String(item.direction || "") }))}
      methodApplications={(evidenceData.method_applications || []).map((application: any) => ({ application_id: String(application.application_id || ""), method_id: String(application.method_id || ""), capability_type: String(application.capability_type || ""), target_judgment_unit_refs: Array.isArray(application.target_judgment_unit_refs) ? application.target_judgment_unit_refs.map(String) : [], precondition_checks: Array.isArray(application.precondition_checks) ? application.precondition_checks.map((check: any) => ({ precondition_id: String(check.precondition_id || ""), reason: String(check.reason || "") })) : [] }))}
      structureCompetingExplanations={structureCompetingExplanations}
    />
    {artifact ? <ResearchGraph nodes={nodes} edges={edges} runId={id} workItems={workItems} emptyMessage="阶段 04 尚未形成可视化判断。" /> : <div className="card empty-state"><h2>判断尚未形成</h2><p>先完成证据准备，再运行判断裁决。</p><Link className="button" href={`/runs/${id}/stages/4`}>进入判断生成</Link></div>}
    {reviewArtifact ? <section className={`review-strip ${review.verdict === "rework" ? "review-rework" : "review-pass"}`}><div><span>独立审阅 · {review.verdict === "pass" ? "通过" : review.verdict === "rework" ? "需返工" : review.verdict}</span><strong>{review.overall_assessment}</strong></div><small>{(review.issues || []).length ? `${review.issues.length} 项问题已标记到推理图` : "未发现需要返工的实质问题"}</small></section> : null}
  </>;
}
