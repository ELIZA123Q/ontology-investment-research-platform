import type { BusinessInstanceGraph, GraphObject, GraphRelation } from "./instance_graph/types";

export type RelationAuditStatus = "complete" | "limited" | "broken";
export type RelationRepairStage = "structure" | "evidence" | "judgments";

export type RelationAuditIssue = {
  code: string;
  severity: "limitation" | "error";
  title: string;
  impact: string;
  targetId: string;
  repairStage: RelationRepairStage;
};

export type JudgmentRelationAudit = {
  id: string;
  label: string;
  strength: string;
  decisionStatus: string;
  status: RelationAuditStatus;
  unit?: GraphObject;
  scopes: GraphObject[];
  stateVariables: GraphObject[];
  requirements: Array<{ object: GraphObject; role: string; fulfillment: "met" | "partial" | "unmet" }>;
  sources: GraphObject[];
  claims: GraphObject[];
  facts: GraphObject[];
  signals: GraphObject[];
  hypotheses: GraphObject[];
  competingExplanations: GraphObject[];
  rules: GraphObject[];
  methods: GraphObject[];
  traces: GraphObject[];
  invalidationConditions: string[];
  issues: RelationAuditIssue[];
};

function label(object: GraphObject | undefined) {
  if (!object) return "";
  const props = object.properties || {};
  return String(props.statement || props.conclusion || props.requirement || props.title || props.name || props.label || object.id);
}

function uniqueObjects(values: Array<GraphObject | undefined>): GraphObject[] {
  const found = new Map<string, GraphObject>();
  for (const value of values) if (value) found.set(value.id, value);
  return [...found.values()];
}

export function objectDisplayLabel(object: GraphObject | undefined) {
  return label(object) || "未命名对象";
}

export function relationRepairHref(runId: string, issue: RelationAuditIssue) {
  const path = issue.repairStage === "structure" ? "structure" : issue.repairStage === "evidence" ? "evidence" : "judgments";
  return `/runs/${runId}/${path}?focus=${encodeURIComponent(issue.targetId)}&from=audit`;
}

export function buildJudgmentRelationAudits(graph: BusinessInstanceGraph): JudgmentRelationAudit[] {
  const objects = new Map(graph.objects.map((object) => [object.id, object]));
  const outgoing = (id: string, type: string) => graph.relations.filter((relation) => relation.sourceId === id && relation.type === type);
  const incoming = (id: string, type: string) => graph.relations.filter((relation) => relation.targetId === id && relation.type === type);
  const targets = (relations: GraphRelation[]) => uniqueObjects(relations.map((relation) => objects.get(relation.targetId)));
  const sources = (relations: GraphRelation[]) => uniqueObjects(relations.map((relation) => objects.get(relation.sourceId)));

  return graph.objects.filter((object) => object.type === "Judgment").map((judgment) => {
    const unit = targets(outgoing(judgment.id, "judgmentResolvesUnit"))[0];
    const scopes = unit ? targets(outgoing(unit.id, "unitUsesScope")) : [];
    const stateVariables = unit ? targets(outgoing(unit.id, "unitEvaluatesStateVariable")) : [];
    const hypotheses = targets(outgoing(judgment.id, "judgmentBasedOnHypothesis"));
    const signals = uniqueObjects(hypotheses.flatMap((hypothesis) => sources(incoming(hypothesis.id, "signalEvaluatesHypothesis"))));
    const facts = uniqueObjects(signals.flatMap((signal) => targets(outgoing(signal.id, "signalGroundedByFact"))));
    const claims = uniqueObjects(facts.flatMap((fact) => targets(outgoing(fact.id, "factDerivedFromClaim"))));
    const sourceDocuments = uniqueObjects(claims.flatMap((claim) => targets(outgoing(claim.id, "claimCitesSource"))));
    const competingExplanations = unit ? sources(incoming(unit.id, "competingExplanationForUnit")) : [];
    const rules = targets(outgoing(judgment.id, "judgmentHasRuleEvaluation"));
    const methods = targets(outgoing(judgment.id, "runtimeJudgmentUsesMethodApplication"));
    const traces = sources(incoming(judgment.id, "reasoningTraceForJudgment"));
    const requirementObjects = unit ? sources(incoming(unit.id, "requirementForJudgmentUnit")) : [];
    const requirements = requirementObjects.map((requirement) => {
      const fulfillments = incoming(requirement.id, "basketFulfillsRequirement").map((relation) => String(relation.properties?.fulfillment || "unmet"));
      const fulfillment = fulfillments.includes("met") ? "met" as const
        : fulfillments.includes("partially_met") ? "partial" as const
          : "unmet" as const;
      return { object: requirement, role: String(requirement.properties?.evidence_role || "support"), fulfillment };
    });
    const strength = String(judgment.properties?.strength || judgment.properties?.level || "J0");
    const decisionStatus = String(judgment.properties?.decision_status || judgment.properties?.status || "");
    const notJudgeableReason = String(judgment.properties?.not_judgeable_reason || "").trim();
    const issues: RelationAuditIssue[] = [];
    const addError = (code: string, title: string, impact: string, targetId: string, repairStage: RelationRepairStage) =>
      issues.push({ code, severity: "error", title, impact, targetId, repairStage });
    const addLimit = (code: string, title: string, impact: string, targetId: string, repairStage: RelationRepairStage) =>
      issues.push({ code, severity: "limitation", title, impact, targetId, repairStage });

    if (!unit) addError("missing_unit", "判断没有对应关键判断单元", "无法确认这项结论裁决了哪个研究问题。", judgment.id, "structure");
    if (unit && !scopes.length) addError("missing_scope", "关键判断未绑定研究范围", "结论的对象、时间或口径边界无法追溯。", unit.id, "structure");
    if (unit && !stateVariables.length) addError("missing_state_variable", "尚未绑定状态变量", "无法明确这项判断实际观察和比较了什么。", unit.id, "structure");
    if (!hypotheses.length) addError("missing_hypothesis", "判断缺少假设中介", "证据不能通过可检验假设进入最终判断。", judgment.id, "judgments");
    if (!rules.length) addError("missing_rule", "判断缺少规则评估", "无法解释当前结论强度为何没有越过证据上限。", judgment.id, "judgments");
    if (!methods.length) addError("missing_method", "判断缺少方法追溯", "无法复核本轮使用了哪种裁决方法。", judgment.id, "judgments");
    if (!traces.length) addError("missing_trace", "判断缺少推理留痕", "无法逐步复核参与判断的正式对象。", judgment.id, "judgments");
    if (strength !== "J0" && (!signals.length || !facts.length || !sourceDocuments.length)) {
      addError("missing_fact_path", "方向判断缺少完整事实链", "非 J0 判断必须能追溯到来源、事实、信号与假设。", judgment.id, "evidence");
    }
    if (strength === "J0") {
      addLimit("indeterminate", "当前停在暂不可判断", notJudgeableReason || "正式关系可成立，但现有证据不足以形成方向判断。", judgment.id, "judgments");
    }
    for (const requirement of requirements.filter((item) => item.fulfillment !== "met")) {
      addLimit(
        `requirement_${requirement.fulfillment}`,
        requirement.fulfillment === "partial" ? "必要证据仅部分满足" : "必要证据尚未满足",
        label(requirement.object),
        requirement.object.id,
        "evidence",
      );
    }
    const blockingFactors = unit ? sources(incoming(unit.id, "blockingFactorForUnit")) : [];
    for (const factor of blockingFactors) {
      addLimit("blocking_factor", "存在明确阻断项", label(factor), factor.id, "evidence");
    }

    const status: RelationAuditStatus = issues.some((issue) => issue.severity === "error")
      ? "broken"
      : issues.length ? "limited" : "complete";
    return {
      id: judgment.id,
      label: label(judgment),
      strength,
      decisionStatus,
      status,
      unit,
      scopes,
      stateVariables,
      requirements,
      sources: sourceDocuments,
      claims,
      facts,
      signals,
      hypotheses,
      competingExplanations,
      rules,
      methods,
      traces,
      invalidationConditions: Array.isArray(judgment.properties?.invalidation_conditions)
        ? judgment.properties!.invalidation_conditions.map(String)
        : [],
      issues,
    };
  }).sort((left, right) => {
    const rank = { broken: 0, limited: 1, complete: 2 };
    return rank[left.status] - rank[right.status] || left.id.localeCompare(right.id);
  });
}
