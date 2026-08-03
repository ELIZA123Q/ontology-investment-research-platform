export type EvidenceImpactInput = {
  evidence: { id: string; label: string };
  impacted_judgments: Array<{ id: string; label: string; strength: string }>;
  impacted_object_count: number;
};

export type VariableUsageInput = {
  semantic_ref: string;
  label: string;
  source?: "formal" | "task_local";
  run_count: number;
  occurrence_count: number;
  occurrences: Array<{ run_id: string; question: string; name: string }>;
};

export type RequirementImpactInput = {
  id: string;
  label: string;
  role: string;
  fulfillment: "met" | "partial" | "unmet";
  blocking: boolean;
  affected_judgments: Array<{ id: string; label: string; strength: string }>;
};

export type AdvancedFinding = {
  kind: "decision_limit" | "single_point" | "unused_evidence" | "shared_dependency" | "cross_run_reuse";
  priority: "high" | "medium" | "opportunity";
  title: string;
  detail: string;
  implication: string;
  target_id?: string;
};

export type ResearchAdvancedAnalysis = {
  quality: {
    status: "pass" | "limited" | "not_ready";
    label: string;
    evidence_fact_count: number;
    source_group_count: number;
    gap_count: number;
    judgment_count: number;
    directional_judgment_count: number;
    indeterminate_judgment_count: number;
    process_label: string;
    decision_label: string;
  };
  findings: AdvancedFinding[];
  impact_queries: EvidenceImpactInput[];
  reusable_variables: VariableUsageInput[];
};

function text(value: unknown): string {
  return String(value || "").trim();
}

export function buildResearchAdvancedAnalysis(input: {
  runId: string;
  evidence: Record<string, any>;
  judgment: Record<string, any>;
  impactQueries: EvidenceImpactInput[];
  variableUsages: VariableUsageInput[];
  requirementImpacts?: RequirementImpactInput[];
  graphAuthority?: string;
}): ResearchAdvancedAnalysis {
  const drafts = Array.isArray(input.evidence.evidence_drafts) ? input.evidence.evidence_drafts : [];
  const gate = input.evidence.evidence_quality_gate || {};
  const judgments = Array.isArray(input.judgment.judgments) ? input.judgment.judgments : [];
  const gaps = drafts.filter((item: any) => ["gap", "conflict"].includes(text(item?.kind)));
  const indeterminate = judgments.filter((item: any) =>
    text(item?.strength || item?.level || "J0") === "J0" || text(item?.decision_status) === "indeterminate",
  );
  const findings: AdvancedFinding[] = [];

  const unmetRequirements = (input.requirementImpacts || []).filter((item) => item.fulfillment !== "met");
  if (unmetRequirements.length) {
    for (const requirement of unmetRequirements) {
      const impacted = requirement.affected_judgments;
      findings.push({
        kind: "decision_limit",
        priority: requirement.blocking || impacted.some((item) => item.strength === "J0") ? "high" : "medium",
        title: requirement.label,
        detail: impacted.length
          ? `影响 ${impacted.length} 个判断：${impacted.map((item) => item.label).join("；")}`
          : "这项正式证据要求尚未进入任何最终判断。",
        implication: requirement.fulfillment === "partial"
          ? "已有部分材料，但尚不足以解除当前结论边界。"
          : "补齐并核验这项证据后，才能重新评估相关判断是否可以形成方向。",
        target_id: requirement.id,
      });
    }
  } else {
    const groupedLimits = new Map<string, { label: string; judgments: string[]; targetId: string }>();
    for (const judgment of indeterminate) {
      const uncertainties = (Array.isArray(judgment.uncertainties) ? judgment.uncertainties : []).map(text).filter(Boolean);
      const labels = uncertainties.length ? uncertainties : ["当前材料尚不足以形成方向判断"];
      for (const limit of labels.slice(0, 2)) {
        const key = limit.replace(/\s+/g, " ").trim();
        const current: { label: string; judgments: string[]; targetId: string } = groupedLimits.get(key)
          || { label: limit, judgments: [], targetId: text(judgment.id) };
        current.judgments.push(text(judgment.conclusion || judgment.statement) || text(judgment.id));
        groupedLimits.set(key, current);
      }
    }
    for (const limit of groupedLimits.values()) findings.push({
      kind: "decision_limit",
      priority: "high",
      title: limit.label,
      detail: `影响 ${limit.judgments.length} 个判断：${limit.judgments.join("；")}`,
      implication: "需要优先补证或收窄表达，不能把多个不可判断项平均成高置信结论。",
      target_id: limit.targetId,
    });
  }

  const judgmentDependencies = new Map<string, Set<string>>();
  for (const query of input.impactQueries) {
    for (const judgment of query.impacted_judgments) {
      const dependencies = judgmentDependencies.get(judgment.id) || new Set<string>();
      dependencies.add(query.evidence.id);
      judgmentDependencies.set(judgment.id, dependencies);
    }
  }
  for (const judgment of judgments) {
    const id = text(judgment.id);
    const dependencies = judgmentDependencies.get(id) || new Set<string>();
    const strength = text(judgment.strength || judgment.level || "J0");
    if (strength !== "J0" && dependencies.size === 1) {
      findings.push({
        kind: "single_point",
        priority: "medium",
        title: `${text(judgment.conclusion || judgment.statement).slice(0, 54)}${text(judgment.conclusion || judgment.statement).length > 54 ? "…" : ""}`,
        detail: `当前正式影响链只落到 1 条证据事实（${[...dependencies][0]}）。`,
        implication: "一旦该事实失效，结论缺少独立支撑；它应进入持续跟踪清单。",
        target_id: id,
      });
    }
  }

  for (const query of input.impactQueries.filter((item) => item.impacted_judgments.length === 0)) {
    findings.push({
      kind: "unused_evidence",
      priority: "medium",
      title: `证据尚未进入任何判断：${query.evidence.label}`,
      detail: `${query.evidence.id} 虽已成为正式事实，但只影响 ${query.impacted_object_count} 个中间对象。`,
      implication: "需要决定是补齐影响关系，还是从有效证据集中移出，避免“有材料但没参与判断”。",
      target_id: query.evidence.id,
    });
  }

  for (const query of input.impactQueries.filter((item) => item.impacted_judgments.length > 1)) {
    findings.push({
      kind: "shared_dependency",
      priority: "high",
      title: `一条事实同时支撑 ${query.impacted_judgments.length} 个判断`,
      detail: `${query.evidence.label} → ${query.impacted_judgments.map((item) => item.id).join("、")}`,
      implication: "这是改判的集中触发点；来源更新或失效时应联动复核这些判断。",
      target_id: query.evidence.id,
    });
  }

  const reusableVariables = input.variableUsages
    .filter((usage) => usage.source !== "task_local")
    .filter((usage) => usage.occurrences.some((item) => item.run_id === input.runId))
    .filter((usage) => usage.occurrences.some((item) => item.run_id !== input.runId))
    .sort((left, right) => right.run_count - left.run_count || right.occurrence_count - left.occurrence_count);
  if (reusableVariables.length) {
    findings.push({
      kind: "cross_run_reuse",
      priority: "opportunity",
      title: `${reusableVariables.length} 个变量可与历史研究复用或对照`,
      detail: reusableVariables.slice(0, 5).map((item) => `${item.label}（${item.run_count} 个研究）`).join("；"),
      implication: "可复用的是正式变量口径，不代表数值天然可比；比较前仍需检查单位、期间与对象。",
    });
  }

  const evidenceFactCount = Number(gate.total_evidence || input.impactQueries.length || 0);
  const gatePassed = gate.passed === true || text(input.evidence.quality_status) === "high_quality_pass";
  const qualityStatus = !evidenceFactCount || !judgments.length ? "not_ready" : gatePassed && !gaps.length ? "pass" : "limited";
  return {
    quality: {
      status: qualityStatus,
      label: qualityStatus === "pass" ? "质量检查通过" : qualityStatus === "limited" ? "质量检查通过，但结论仍受缺口限制" : "尚未形成可验证结果",
      evidence_fact_count: evidenceFactCount,
      source_group_count: Number(gate.source_groups || 0),
      gap_count: gaps.length,
      judgment_count: judgments.length,
      directional_judgment_count: judgments.length - indeterminate.length,
      indeterminate_judgment_count: indeterminate.length,
      process_label: gatePassed ? "流程与表达检查通过" : "流程完整性仍需处理",
      decision_label: !judgments.length ? "尚未形成研究判断"
        : indeterminate.length === judgments.length ? "全部判断仍受证据限制"
          : indeterminate.length ? `${indeterminate.length} 项判断仍受证据限制`
            : "现有判断均已形成方向",
    },
    findings: findings.sort((left, right) => {
      const rank = { high: 0, medium: 1, opportunity: 2 };
      return rank[left.priority] - rank[right.priority];
    }),
    impact_queries: input.impactQueries,
    reusable_variables: reusableVariables,
  };
}
