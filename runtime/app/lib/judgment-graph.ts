import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import type { ResearchWorkItem } from "@/engine/types";

export type JudgmentGraphBuildResult = {
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
  emptyReason: string | null;
};

type ReviewIssue = {
  judgment_id?: string;
  issue_type?: string;
  description?: string;
  required_action?: string;
  return_stage?: string;
  evidence_refs?: string[];
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function ruleResultTone(result: string): ResearchGraphNode["tone"] {
  if (result === "pass") return "support";
  if (result === "blocked") return "danger";
  if (result === "contested") return "weaken";
  if (result === "fail") return "danger";
  return "unknown";
}

function judgmentTone(strength: string, decisionStatus: string, hasIssues: boolean): ResearchGraphNode["tone"] {
  if (hasIssues || decisionStatus === "blocked" || decisionStatus === "invalidated") return "danger";
  if (strength === "J0" || decisionStatus === "indeterminate" || decisionStatus === "contested") return "unknown";
  if (strength === "J1" || decisionStatus === "draft") return "weaken";
  return "support";
}

function signalMeta(role: string): string {
  if (role === "block") return "阻断信号";
  return "信号";
}

function resolveNodeLabel(nodeId: string, labelById: Map<string, string>): string {
  return labelById.get(nodeId) || nodeId;
}

function ensureTraceEdge(
  edges: ResearchGraphEdge[],
  edgeIds: Set<string>,
  source: string,
  target: string,
  tone: ResearchGraphEdge["tone"] = "inherited",
  label?: string,
) {
  if (!source || !target || source === target) return;
  const id = `trace-${source}-${target}`;
  if (edgeIds.has(id)) return;
  edgeIds.add(id);
  edges.push({ id, source, target, tone, label });
}

export function buildJudgmentReviewGraph(input: {
  stage04: Record<string, unknown>;
  evidenceDrafts?: unknown[];
  reviewIssues?: ReviewIssue[];
  workItems?: ResearchWorkItem[];
}): JudgmentGraphBuildResult {
  const nodes: ResearchGraphNode[] = [];
  const edges: ResearchGraphEdge[] = [];
  const edgeIds = new Set<string>();
  const labelById = new Map<string, string>();
  const workItems = input.workItems || [];
  const reviewIssues = input.reviewIssues || [];
  const data = input.stage04;

  const evidence = (input.evidenceDrafts || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.evidence_id || `EV-${index + 1}`),
  }));
  evidence.forEach((item: any, index: number) => {
    labelById.set(item._id, String(item.statement || item._id));
    nodes.push({
      id: item._id,
      label: item.statement,
      meta: item.kind === "counter" ? "反证" : item.kind === "gap" ? "尚缺" : "证据",
      tone: item.kind === "counter" || item.direction === "weaken" ? "weaken" : item.kind === "conflict" ? "danger" : item.kind === "gap" ? "unknown" : "support",
      x: 0,
      y: index * 105,
      details: {
        方向: item.direction,
        来源: item.source_ids || [],
        局限: item.limitations || [],
        审阅状态: workItems.find((work) => work.target_id === item._id)?.status || "未创建工作项",
      },
    });
  });

  const signals = (data.signals as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.signal_id || `SIG-${index + 1}`),
  }));
  signals.forEach((item: any, index: number) => {
    labelById.set(item._id, String(item.statement || item._id));
    const role = String(item.role || "context");
    nodes.push({
      id: item._id,
      label: item.statement,
      meta: signalMeta(role),
      tone: role === "support" ? "support" : role === "block" ? "danger" : role === "weaken" ? "weaken" : "neutral",
      x: 330,
      y: index * 125,
      details: {
        角色: role,
        对应判断单元: item.judgment_unit_ids || [],
        证据引用: item.evidence_draft_ids || item.evidence_refs || [],
      },
    });
    for (const ref of asStringArray(item.evidence_draft_ids || item.evidence_refs)) {
      if (!nodes.some((node) => node.id === ref)) continue;
      edges.push({
        id: `${ref}-${item._id}`,
        source: ref,
        target: item._id,
        tone: role === "block" ? "danger" : role === "weaken" ? "weaken" : "support",
      });
      edgeIds.add(`${ref}-${item._id}`);
    }
  });

  const hypotheses = (data.hypotheses as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.hypothesis_id || `H-${index + 1}`),
  }));
  hypotheses.forEach((item: any, index: number) => {
    labelById.set(item._id, String(item.statement || item._id));
    nodes.push({
      id: item._id,
      label: item.statement,
      meta: "可证伪假设",
      tone: "inherited",
      x: 650,
      y: index * 155,
      details: {
        时间范围: item.time_horizon,
        证伪条件: item.falsification_conditions || [],
        信号: item.signal_ids || item.signal_refs || [],
      },
    });
    const refs = asStringArray(item.signal_ids || item.signal_refs).length
      ? asStringArray(item.signal_ids || item.signal_refs)
      : signals
        .filter((signal: any) => (signal.target_hypothesis_ids || []).includes(item._id) || signal.target_hypothesis_ref === item._id)
        .map((signal: any) => signal._id);
    for (const ref of refs) {
      if (!signals.some((signal: any) => signal._id === ref)) continue;
      const edgeId = `${ref}-${item._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: ref, target: item._id, tone: "inherited" });
      }
    }
  });

  const competitors = (data.competing_explanations as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.explanation_id || `CE-${index + 1}`),
  }));
  competitors.forEach((item: any, index: number) => {
    labelById.set(item._id, String(item.statement || item._id));
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
    for (const ref of asStringArray(item.signal_ids || item.signal_refs)) {
      if (!signals.some((signal: any) => signal._id === ref)) continue;
      const edgeId = `${ref}-${item._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: ref, target: item._id, tone: "weaken" });
      }
    }
  });

  const ruleEvaluations = (data.rule_evaluations as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.rule_evaluation_id || `RE-${index + 1}`),
  }));
  ruleEvaluations.forEach((item: any, index: number) => {
    const result = String(item.result || "unknown");
    labelById.set(item._id, String(item.rule_ref || item._id));
    nodes.push({
      id: item._id,
      label: String(item.rule_ref || item._id),
      meta: `规则评估 · ${result}`,
      tone: ruleResultTone(result),
      x: 820,
      y: index * 150,
      details: {
        规则引用: item.rule_ref,
        评估结果: result,
        输入引用: item.input_refs || [],
        条件结果: item.condition_results || [],
        确定性引擎: item.deterministic_result || "—",
      },
    });
    for (const ref of asStringArray(item.input_refs)) {
      if (!nodes.some((node) => node.id === ref)) continue;
      const edgeId = `${ref}-${item._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: ref, target: item._id, tone: ruleResultTone(result) });
      }
    }
  });

  const judgments = (data.judgments as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.judgment_id || `C-${index + 1}`),
  }));
  judgments.forEach((item: any, index: number) => {
    const issues = reviewIssues.filter((issue) => !issue.judgment_id || issue.judgment_id === item._id);
    const strength = String(item.strength || item.level || "J0");
    const decisionStatus = String(item.decision_status || "draft");
    const conclusion = String(item.conclusion || item.statement || item.title || "");
    labelById.set(item._id, conclusion);
    nodes.push({
      id: item._id,
      label: conclusion,
      meta: `判断 · ${strength} · ${decisionStatus}`,
      tone: judgmentTone(strength, decisionStatus, issues.length > 0),
      x: 980,
      y: index * 190,
      details: {
        判断标题: item.title,
        结论强度: strength,
        判断状态: decisionStatus,
        冲突状态: item.conflict_status || "—",
        不可判断原因: item.not_judgeable_reason || "—",
        规则评估: item.rule_evaluation_ids || [],
        为什么: item.rationale,
        不确定性: item.uncertainties || [],
        失效条件: item.invalidation_conditions || [],
        跟踪信号: item.tracking_signals || [],
        独立审阅问题: issues.map((issue) => issue.description),
        审阅状态: workItems.find((work) => work.target_id === item._id)?.status || "未创建工作项",
      },
    });

    const hypothesisRefs = asStringArray(item.hypothesis_ids || item.hypothesis_refs);
    if (hypothesisRefs.length) {
      for (const ref of hypothesisRefs) {
        if (!hypotheses.some((hypothesis: any) => hypothesis._id === ref)) continue;
        const edgeId = `${ref}-${item._id}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          edges.push({ id: edgeId, source: ref, target: item._id, tone: "inherited" });
        }
      }
    } else {
      const unitId = item.judgment_unit_id || item.judgment_unit_ref;
      const matchedSignals = signals.filter((signal: any) => !unitId || (signal.judgment_unit_ids || []).includes(unitId));
      for (const signal of matchedSignals) {
        const edgeId = `${signal._id}-${item._id}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          edges.push({
            id: edgeId,
            source: signal._id,
            target: item._id,
            tone: signal.role === "block" ? "danger" : signal.role === "weaken" ? "weaken" : "support",
          });
        }
      }
    }

    for (const ref of asStringArray(item.rule_evaluation_ids)) {
      if (!ruleEvaluations.some((rule: any) => rule._id === ref)) continue;
      const edgeId = `${ref}-${item._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: ref, target: item._id, tone: "support", label: "规则评估" });
      }
    }

    const unitId = String(item.judgment_unit_id || item.judgment_unit_ref || "");
    for (const competitor of competitors) {
      const boundUnits = Array.isArray(competitor.judgment_unit_ids) ? competitor.judgment_unit_ids.map(String) : [];
      const matchesUnit = boundUnits.length ? boundUnits.includes(unitId) : !unitId;
      if (!matchesUnit) continue;
      const edgeId = `${competitor._id}-${item._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: competitor._id, target: item._id, tone: "weaken", label: "竞争解释" });
      }
    }
  });

  const reasoningTraces = (data.reasoning_traces as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.reasoning_trace_id || `RT-${index + 1}`),
  }));
  reasoningTraces.forEach((trace: any, index: number) => {
    const judgmentId = String(trace.judgment_id || "");
    const judgmentIndex = judgments.findIndex((item: any) => item._id === judgmentId);
    const nodeIds = asStringArray(trace.node_ids);
    const orderedLabels = nodeIds.map((nodeId) => `${nodeId}: ${resolveNodeLabel(nodeId, labelById)}`);
    labelById.set(trace._id, `留痕 ${judgmentId || trace._id}`);
    nodes.push({
      id: trace._id,
      label: judgmentId ? `判断 ${judgmentId} 的推理留痕` : trace._id,
      meta: "推理留痕",
      tone: "inherited",
      x: 1290,
      y: Math.max(0, judgmentIndex) * 190 + index * 72,
      details: {
        对应判断: judgmentId || "—",
        创建时间: trace.created_at || "—",
        追溯顺序: orderedLabels,
        节点标识: nodeIds,
      },
    });
    if (judgmentId && judgments.some((item: any) => item._id === judgmentId)) {
      const edgeId = `${judgmentId}-${trace._id}`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        edges.push({ id: edgeId, source: judgmentId, target: trace._id, tone: "inherited", label: "留痕" });
      }
    }
    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      ensureTraceEdge(edges, edgeIds, nodeIds[i], nodeIds[i + 1], "inherited");
    }
  });

  reviewIssues
    .filter((issue) => !issue.judgment_id || !judgments.some((judgment: any) => judgment._id === issue.judgment_id))
    .forEach((issue, index) => {
      const issueId = `review-issue-${index + 1}`;
      nodes.push({
        id: issueId,
        label: issue.required_action || issue.description || "独立审阅问题",
        meta: `独立审阅 · 退回 ${issue.return_stage || "—"}`,
        tone: "danger",
        x: 1520,
        y: index * 150,
        details: {
          问题类型: issue.issue_type,
          问题描述: issue.description,
          需要动作: issue.required_action,
          退回位置: issue.return_stage,
          证据引用: issue.evidence_refs || [],
        },
      });
    });

  let emptyReason: string | null = null;
  if (!judgments.length) {
    emptyReason = "阶段 04 尚未形成可视化判断。";
  } else if (!signals.length && !hypotheses.length && !ruleEvaluations.length) {
    emptyReason = "阶段 04 已有判断，但尚未形成信号、假设或规则评估链。";
  }

  return { nodes, edges, emptyReason };
}
