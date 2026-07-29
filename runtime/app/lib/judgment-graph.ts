import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import type { ResearchWorkItem } from "@/engine/types";
import {
  judgmentDecisionStatusLabel,
  judgmentStrengthLabel,
  researcherLanguage,
} from "@/app/lib/researcher-stage-output";

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

function ruleResultLabel(result: string): string {
  return ({
    pass: "通过",
    fail: "未通过",
    blocked: "受阻",
    contested: "存在争议",
    unknown: "未判断",
  } as Record<string, string>)[result] || researcherLanguage(result);
}

function evidenceDirectionLabel(value: unknown): string {
  return ({
    support: "支持",
    weaken: "削弱",
    neutral: "中性",
    unknown: "未标注",
    block: "阻断",
    context: "背景",
  } as Record<string, string>)[String(value || "unknown")] || researcherLanguage(value);
}

function reviewStatusLabel(value: unknown): string {
  return ({
    pending: "待确认",
    rework: "退回修改",
    approved: "已确认",
    rejected: "已驳回",
    superseded: "已由新版替代",
  } as Record<string, string>)[String(value || "")] || researcherLanguage(value) || "未创建审阅任务";
}

function returnStageLabel(value: unknown): string {
  return ({
    stage_01: "范围阶段",
    stage_02: "结构阶段",
    stage_03: "证据阶段",
    stage_04: "判断阶段",
    stage_05: "交付阶段",
  } as Record<string, string>)[String(value || "")] || researcherLanguage(value) || "待判断";
}

function competingExplanationStatusLabel(value: unknown): string {
  return ({
    active: "尚未排除",
    eliminated: "已排除",
    supported: "证据支持",
    unresolved: "有待核验",
  } as Record<string, string>)[String(value || "active")] || researcherLanguage(value);
}

function conflictStatusLabel(value: unknown): string {
  return ({
    none: "无明确冲突",
    minor: "存在轻微冲突",
    material: "存在实质冲突",
    decisive: "存在决定性冲突",
    unresolved: "冲突有待核验",
    resolved: "冲突已解决",
  } as Record<string, string>)[String(value || "none")] || researcherLanguage(value);
}

function ruleNameLabel(value: unknown): string {
  return ({
    evidence_scope_time_alignment: "证据范围与时间一致性",
    evidence_independence: "证据独立性",
    counter_evidence_coverage: "反证覆盖度",
    competing_explanation_resolution: "竞争解释排除情况",
    source_quality: "来源质量",
  } as Record<string, string>)[String(value || "")] || researcherLanguage(value);
}

function conditionResultLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return researcherLanguage(item);
    const condition = item as Record<string, unknown>;
    const rationale = researcherLanguage(condition.rationale);
    const outcome = ruleResultLabel(String(condition.outcome || "unknown"));
    return rationale ? `${rationale}（${outcome}）` : outcome;
  }).filter(Boolean);
}

function referenceCountLabel(value: unknown, noun: string): string {
  const count = asStringArray(value).length;
  return count ? `已关联 ${count} 项${noun}` : `未关联${noun}`;
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
    const label = researcherLanguage(item.statement || item._id);
    labelById.set(item._id, label);
    nodes.push({
      id: item._id,
      label,
      meta: item.kind === "counter" ? "反证" : item.kind === "gap" ? "尚缺" : "证据",
      tone: item.kind === "counter" || item.direction === "weaken" ? "weaken" : item.kind === "conflict" ? "danger" : item.kind === "gap" ? "unknown" : "support",
      x: 0,
      y: index * 105,
      details: {
        方向: evidenceDirectionLabel(item.direction),
        来源: referenceCountLabel(item.source_ids, "来源"),
        局限: item.limitations || [],
        审阅状态: reviewStatusLabel(workItems.find((work) => work.target_id === item._id)?.status),
      },
    });
  });

  const signals = (data.signals as any[] || []).map((item: any, index: number) => ({
    ...item,
    _id: String(item.id || item.signal_id || `SIG-${index + 1}`),
  }));
  signals.forEach((item: any, index: number) => {
    const label = researcherLanguage(item.statement || item._id);
    labelById.set(item._id, label);
    const role = String(item.role || "context");
    nodes.push({
      id: item._id,
      label,
      meta: signalMeta(role),
      tone: role === "support" ? "support" : role === "block" ? "danger" : role === "weaken" ? "weaken" : "neutral",
      x: 330,
      y: index * 125,
      details: {
        角色: evidenceDirectionLabel(role),
        对应关键判断: referenceCountLabel(item.judgment_unit_ids, "关键判断"),
        证据引用: referenceCountLabel(item.evidence_draft_ids || item.evidence_refs, "证据"),
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
    const label = researcherLanguage(item.statement || item._id);
    labelById.set(item._id, label);
    nodes.push({
      id: item._id,
      label,
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
    const label = researcherLanguage(item.statement || item._id);
    labelById.set(item._id, label);
    nodes.push({
      id: item._id,
      label,
      meta: "竞争解释",
      tone: item.status === "eliminated" ? "unknown" : "weaken",
      x: 650,
      y: Math.max(220, hypotheses.length * 155) + index * 130,
      details: {
        状态: competingExplanationStatusLabel(item.status),
        信号: referenceCountLabel(item.signal_ids || item.signal_refs, "信号"),
        排除理由: item.elimination_rationale || "",
        结构阶段来源: item.source_explanation_id ? "已从结构阶段承接" : "本阶段补充",
        对应关键判断: referenceCountLabel(item.judgment_unit_ids, "关键判断"),
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
    const ruleLabel = ruleNameLabel(item.rule_ref || item._id);
    labelById.set(item._id, ruleLabel);
    nodes.push({
      id: item._id,
      label: ruleLabel,
      meta: `规则评估 · ${ruleResultLabel(result)}`,
      tone: ruleResultTone(result),
      x: 820,
      y: index * 150,
      details: {
        核验规则: ruleLabel,
        评估结果: ruleResultLabel(result),
        输入引用: referenceCountLabel(item.input_refs, "输入"),
        条件结果: conditionResultLabels(item.condition_results),
        自动核验补充: researcherLanguage(item.deterministic_result) || "—",
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
      meta: `判断 · ${judgmentStrengthLabel(strength)} · ${judgmentDecisionStatusLabel(decisionStatus)}`,
      tone: judgmentTone(strength, decisionStatus, issues.length > 0),
      x: 980,
      y: index * 190,
      details: {
        判断标题: item.title,
        结论强度: judgmentStrengthLabel(strength),
        判断状态: judgmentDecisionStatusLabel(decisionStatus),
        冲突状态: conflictStatusLabel(item.conflict_status),
        不可判断原因: item.not_judgeable_reason || "—",
        规则评估: item.rule_evaluation_ids || [],
        为什么: item.rationale,
        不确定性: item.uncertainties || [],
        失效条件: item.invalidation_conditions || [],
        跟踪信号: item.tracking_signals || [],
        独立审阅问题: issues.map((issue) => issue.description),
        审阅状态: reviewStatusLabel(workItems.find((work) => work.target_id === item._id)?.status),
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
    const orderedLabels = nodeIds.map((nodeId) => resolveNodeLabel(nodeId, labelById));
    const judgmentLabel = resolveNodeLabel(judgmentId, labelById);
    labelById.set(trace._id, judgmentId ? `关于该判断的推理留痕` : "推理留痕");
    nodes.push({
      id: trace._id,
      label: judgmentId ? `关于「${judgmentLabel}」的推理留痕` : "推理留痕",
      meta: "推理留痕",
      tone: "inherited",
      x: 1290,
      y: Math.max(0, judgmentIndex) * 190 + index * 72,
      details: {
        对应判断: judgmentId ? judgmentLabel : "—",
        创建时间: trace.created_at || "—",
        追溯顺序: orderedLabels,
        链路节点: `${nodeIds.length} 项`,
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
        meta: `独立审阅 · 退回${returnStageLabel(issue.return_stage)}`,
        tone: "danger",
        x: 1520,
        y: index * 150,
        details: {
          问题类型: issue.issue_type,
          问题描述: issue.description,
          需要动作: issue.required_action,
          退回位置: returnStageLabel(issue.return_stage),
          证据引用: issue.evidence_refs || [],
        },
      });
    });

  let emptyReason: string | null = null;
  if (!judgments.length) {
    emptyReason = "判断阶段尚未形成可视化判断。";
  } else if (!signals.length && !hypotheses.length && !ruleEvaluations.length) {
    emptyReason = "判断阶段已有结论，但尚未形成信号、假设或规则评估链。";
  }

  return { nodes, edges, emptyReason };
}
