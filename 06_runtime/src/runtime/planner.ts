import { randomUUID } from "node:crypto";
import type { AgentId, Budget, FrontierRef, ResearchIntent, ResearchProblemGraph, StopPredicate, TaskNode } from "@/src/contracts";
import { judgmentUnitRequirements } from "@/src/runtime/problem-graph";
import { getResearchNodeType } from "@/src/runtime/node-catalog";
import { isSkillExecutionAllowed, runtimeExecutionScope } from "@/src/capabilities/registry";

export interface PlannedNode {
  key: string;
  kind: string;
  title: string;
  agent: AgentId;
  dependsOn: string[];
  budget?: Partial<Budget>;
  frontierRef?: FrontierRef;
  iteration?: number;
}

export interface ResearchPlan {
  intent: ResearchIntent;
  rationale: string;
  nodes: PlannedNode[];
  parallelGroups: string[][];
  stopConditions: string[];
  stopPredicates?: StopPredicate[];
}

const includesAny = (value: string, words: string[]) => words.some((word) => value.includes(word));

export function classifyIntent(goal: string): ResearchIntent {
  const text = goal.trim().toLowerCase();
  if (text.length < 8 || includesAny(text, ["不知道研究什么", "帮我看看", "随便看看"])) return "clarify";
  if (includesAny(text, ["只取证", "只补", "补充来源", "一手来源", "核验来源", "证据包"])) return "evidence_only";
  if (includesAny(text, ["更新判断", "重新判断", "新材料", "新证据", "时间范围改", "把时间范围改"]) || /改判(?!条件)/.test(text)) return "update_judgment";
  if (includesAny(text, ["只写报告", "整理成报告", "润色报告", "生成报告", "导出报告"])) return "compose_only";
  return "full_research";
}

export function planResearch(goal: string): ResearchPlan {
  const intent = classifyIntent(goal);
  const complex = includesAny(goal, ["竞争解释", "情景", "传导", "产业链", "反事实", "因果", "压力测试"]);

  if (intent === "clarify") return {
    intent,
    rationale: "目标缺少会改变研究路径的必要边界，先做最小澄清。",
    nodes: [{ key: "clarify", kind: "clarify", title: "确认研究对象、期限与决策", agent: "research-lead", dependsOn: [] }],
    parallelGroups: [],
    stopConditions: ["用户尚未确认研究对象或时间范围"],
  };

  if (intent === "evidence_only") return {
    intent,
    rationale: "用户只要求补证，不重复生成判断和报告。",
    nodes: [
      { key: "context", kind: "semantic_context", title: "定位需要补强的证据缺口", agent: "research-lead", dependsOn: [] },
      { key: "discover", kind: "evidence_discovery", title: "发现候选一手来源", agent: "research-lead", dependsOn: ["context"] },
      { key: "capture", kind: "evidence_capture", title: "保存来源快照与定位", agent: "research-lead", dependsOn: ["discover"] },
      { key: "evaluate", kind: "evidence_evaluation", title: "评估证据覆盖与可靠性", agent: "research-lead", dependsOn: ["capture"] },
    ],
    parallelGroups: [],
    stopConditions: ["找不到满足最低等级的来源", "预算耗尽"],
  };

  if (intent === "compose_only") return {
    intent,
    rationale: "复用既有正式制品，仅做交付和独立审计。",
    nodes: [
      { key: "compose", kind: "compose", title: "组合已有正式制品", agent: "research-lead", dependsOn: [] },
      { key: "audit", kind: "audit", title: "确定性审计引用与表达", agent: "research-lead", dependsOn: ["compose"] },
    ],
    parallelGroups: [],
    stopConditions: ["没有可复用的已验证判断或证据"],
  };

  if (intent === "update_judgment") return {
    intent,
    rationale: "局部补证和影响分析，不重新运行不受影响的研究节点。",
    nodes: [
      { key: "impact", kind: "impact_analysis", title: "识别新材料影响范围", agent: "research-lead", dependsOn: [] },
      { key: "context", kind: "semantic_context", title: "装配受影响判断的上下文", agent: "research-lead", dependsOn: ["impact"] },
      { key: "discover", kind: "evidence_discovery", title: "定位新增材料或需刷新来源", agent: "research-lead", dependsOn: ["context"] },
      { key: "capture", kind: "evidence_capture", title: "保存新增来源快照与定位", agent: "research-lead", dependsOn: ["discover"] },
      { key: "evaluate", kind: "evidence_evaluation", title: "核验新增证据", agent: "research-lead", dependsOn: ["capture"] },
      { key: "adjudicate", kind: "judgment", title: "重裁受影响判断", agent: "research-lead", dependsOn: ["evaluate"] },
      { key: "audit", kind: "audit", title: "确定性检查改判边界", agent: "research-lead", dependsOn: ["adjudicate"] },
    ],
    parallelGroups: [],
    stopConditions: ["新增材料无法核验", "没有识别到受影响判断"],
  };

  const nodes: PlannedNode[] = [
    { key: "context", kind: "semantic_context", title: "装配语义与历史上下文", agent: "research-lead", dependsOn: [] },
    { key: "method", kind: "method_selection", title: "选择研究与证伪方法", agent: "research-lead", dependsOn: [] },
    { key: "discover", kind: "evidence_discovery", title: "发现候选一手来源", agent: "research-lead", dependsOn: ["context", "method"] },
    { key: "capture", kind: "evidence_capture", title: "保存来源快照与定位", agent: "research-lead", dependsOn: ["discover"] },
    { key: "evaluate", kind: "evidence_evaluation", title: "评估证据覆盖与可靠性", agent: "research-lead", dependsOn: ["capture"] },
  ];
  if (complex) nodes.push({ key: "hypotheses", kind: "hypothesis", title: "比较假设与竞争解释", agent: "research-lead", dependsOn: ["evaluate"] });
  nodes.push(
    { key: "adjudicate", kind: "judgment", title: "形成判断与改判条件", agent: "research-lead", dependsOn: [complex ? "hypotheses" : "evaluate"] },
    { key: "compose", kind: "compose", title: "生成可编辑研究制品", agent: "research-lead", dependsOn: ["adjudicate"] },
    { key: "audit", kind: "audit", title: "确定性审计引用与表达", agent: "research-lead", dependsOn: ["compose"] },
  );
  return {
    intent,
    rationale: complex ? "需要完整研究，并按需加入竞争解释专家。" : "采用最小完整研究路径；语义路由与方法选择并行。",
    nodes,
    parallelGroups: [["context", "method"]],
    stopConditions: ["关键判断没有达到最低证据门槛", "用户取消或要求调整方向", "预算耗尽"],
  };
}

/** Compile an execution graph from an already reviewed research problem graph.
 * The old keyword planner remains only as an explicit clarify/failure fallback. */
export function planFromProblemGraph(graph: ResearchProblemGraph, budget: Budget, requestedExecutionScope = runtimeExecutionScope()): ResearchPlan {
  const nodes: PlannedNode[] = [];
  const boundary = (key: string, kind: string, title: string, dependsOn: string[], compilerBoundary: NonNullable<FrontierRef["compilerBoundary"]>) =>
    nodes.push({ key, kind, title, agent: "research-lead", dependsOn, frontierRef: { problemGraphId: graph.id, compilerBoundary } });
  const isUpdate = graph.intentRefs[0] === "update_judgment";
  const evidenceOnly = graph.intentRefs[0] === "evidence_only";
  const composeOnly = graph.intentRefs[0] === "compose_only";
  const rootQuestions = graph.nodes.filter((node) => node.type === "root_question");
  const workflowPatternRef = String(rootQuestions[0]?.payload.workflowPatternRef || "");
  const workflowPrior = rootQuestions[0]?.payload.workflowPrior as {
    planningHints?: { allowParallelEvidence?: boolean; allowReplanning?: boolean };
    graphPrior?: { convergence?: string; replan_on?: string[]; replanOn?: string[] };
    humanGates?: string[];
  } | undefined;
  if (!workflowPatternRef || !workflowPrior) throw new Error("Research Problem Graph is missing its governed Workflow Pattern projection");
  const scenarioContracts = rootQuestions.flatMap((root) => Array.isArray(root.payload.scenarioContracts) ? root.payload.scenarioContracts as Array<{
    scenarioRef: string; entryConditions: string[]; completionConditions: string[]; invalidationConditions: string[]; updateTriggers: string[];
  }> : []);
  const scenarioStopConditions = [...new Set(scenarioContracts.flatMap((contract) => [
    ...contract.entryConditions.map((condition) => `scenario entry must hold: ${contract.scenarioRef}.${condition}`),
    ...contract.invalidationConditions.map((condition) => `replan when scenario invalidates: ${contract.scenarioRef}.${condition}`),
  ]))];
  const motifs = new Set(graph.taskMotifRefs);
  const lenses = new Set(graph.lensRefs || []);
  const requestedFundamental = lenses.has("fundamental") || lenses.has("growth") || lenses.has("quality") || motifs.has("company_coverage") || motifs.has("earnings_update");
  const requestedValuation = lenses.has("value_valuation") || motifs.has("company_coverage");
  const requestedThesis = requestedFundamental || lenses.has("risk_first") || lenses.has("expectation_gap") || motifs.has("thesis_review");
  const executionScope = requestedExecutionScope;
  const fundamental = requestedFundamental && isSkillExecutionAllowed("financial-modeling", executionScope);
  const needsValuation = fundamental && requestedValuation && isSkillExecutionAllowed("valuation-analysis", executionScope);
  const needsThesis = requestedThesis && isSkillExecutionAllowed("thesis-monitoring", executionScope);
  const needsReview = needsThesis && isSkillExecutionAllowed("independent-research-review", executionScope);
  const capabilityGaps = [
    ...(requestedFundamental && !fundamental ? ["financial-modeling 尚未发布到当前执行范围"] : []),
    ...(requestedValuation && !needsValuation ? ["valuation-analysis 尚未发布到当前执行范围"] : []),
    ...(requestedThesis && !needsThesis ? ["thesis-monitoring 尚未发布到当前执行范围"] : []),
  ];
  if (isUpdate) boundary("impact", "impact_analysis", "沿问题图与证据血缘识别受影响单元", [], "scope");
  boundary("context", "semantic_context", "装配研究范围与历史上下文", isUpdate ? ["impact"] : [], "scope");

  if (composeOnly) {
    boundary("compose", "compose", "投影已解决问题图为可编辑研究制品", ["context"], "compose");
    boundary("audit", "audit", "确定性审计引用与表达", ["compose"], "audit");
    return {
      intent: "compose_only",
      rationale: `由 02_scenario_task Workflow Pattern ${workflowPatternRef} 编译；仅投影已确认制品。`,
      nodes,
      parallelGroups: [],
      stopConditions: ["no reusable verified judgments or evidence", ...scenarioStopConditions],
      stopPredicates: [{ kind: "researcher_stop" }],
    };
  }

  const judgmentUnits = graph.nodes.filter((node) => node.type === "judgment_unit" && node.required);
  for (const unit of judgmentUnits) {
    const prefix = unit.key.replace(/[^a-zA-Z0-9_:-]/g, "_");
    const unitFrontier: FrontierRef = { problemGraphId: graph.id, problemNodeId: unit.id, judgmentUnitRef: unit.semanticRef || unit.id };
    const methodKey = `${prefix}:method`;
    const hypothesisKey = `${prefix}:hypothesis`;
    if (!evidenceOnly) {
      nodes.push({ key: methodKey, kind: "method_selection", title: `选择证伪方法：${unit.title}`, agent: "research-lead", dependsOn: ["context"], frontierRef: unitFrontier });
      nodes.push({ key: hypothesisKey, kind: "hypothesis", title: `主假设与竞争解释：${unit.title}`, agent: "research-lead", dependsOn: [methodKey], frontierRef: unitFrontier });
    }
    const evaluations: string[] = [];
    for (const requirement of judgmentUnitRequirements(graph, unit)) {
      const role = requirement.payload.evidenceRole as FrontierRef["evidenceRole"];
      const requirementFrontier: FrontierRef = { ...unitFrontier, problemNodeId: requirement.id, evidenceRequirementRef: requirement.semanticRef || requirement.id, evidenceRole: role };
      const discoverKey = `${prefix}:discover:${role}`;
      const captureKey = `${prefix}:capture:${role}`;
      const evaluateKey = `${prefix}:evaluate:${role}`;
      nodes.push({ key: discoverKey, kind: "evidence_discovery", title: `发现${role === "support" ? "支持" : role === "counter" ? "反证" : "边界"}证据：${unit.title}`, agent: "research-lead", dependsOn: [evidenceOnly ? "context" : methodKey], frontierRef: requirementFrontier });
      nodes.push({ key: captureKey, kind: "evidence_capture", title: `保存来源快照：${unit.title}`, agent: "research-lead", dependsOn: [discoverKey], frontierRef: requirementFrontier });
      nodes.push({ key: evaluateKey, kind: "evidence_evaluation", title: `评估${role === "support" ? "支持" : role === "counter" ? "反证" : "边界"}证据：${unit.title}`, agent: "research-lead", dependsOn: [captureKey], frontierRef: requirementFrontier });
      evaluations.push(evaluateKey);
    }
    if (!evidenceOnly) nodes.push({ key: `${prefix}:judgment`, kind: "judgment", title: `裁决判断单元：${unit.title}`, agent: "research-lead", dependsOn: [hypothesisKey, ...evaluations], frontierRef: unitFrontier });
  }
  const allowParallelEvidence = Boolean(workflowPrior.planningHints?.allowParallelEvidence);
  if (evidenceOnly) {
    const evidenceParallel = nodes.filter((node) => node.kind === "evidence_discovery").map((node) => node.key);
    return {
      intent: "evidence_only",
      rationale: `由 02_scenario_task Workflow Pattern ${workflowPatternRef} 编译；仅解决证据 frontier，不生成判断或报告。`,
      nodes,
      parallelGroups: allowParallelEvidence && evidenceParallel.length > 1 ? [evidenceParallel] : [],
      stopConditions: [String(workflowPrior.graphPrior?.convergence || "requested evidence requirements resolved or blocked"), "budget exhausted", "researcher stop", ...scenarioStopConditions],
      stopPredicates: [{ kind: "budget_exhausted" }, { kind: "researcher_stop" }],
    };
  }
  const judgmentKeys = nodes.filter((node) => node.kind === "judgment").map((node) => node.key);
  const evaluationKeys = nodes.filter((node) => node.kind === "evidence_evaluation").map((node) => node.key);
  const financialDependencies: string[] = [];
  if (fundamental) {
    nodes.push({ key: "financial_normalization", kind: "financial_normalization", title: "规范化财务历史与口径", agent: "research-lead", dependsOn: evaluationKeys, frontierRef: { problemGraphId: graph.id, compilerBoundary: "scope" } });
    nodes.push({ key: "model_build_or_update", kind: "model_build_or_update", title: "构建或更新结构化财务模型", agent: "research-lead", dependsOn: ["financial_normalization"], frontierRef: { problemGraphId: graph.id, compilerBoundary: "scope" } });
    nodes.push({ key: "model_audit", kind: "model_audit", title: "确定性审计模型口径、公式与勾稽", agent: "research-lead", dependsOn: ["model_build_or_update"], frontierRef: { problemGraphId: graph.id, compilerBoundary: "audit" } });
    financialDependencies.push("model_audit");
  }
  if (needsValuation) {
    nodes.push({ key: "valuation_analysis", kind: "valuation_analysis", title: "基于审计通过模型形成估值分析", agent: "research-lead", dependsOn: ["model_audit"], frontierRef: { problemGraphId: graph.id, compilerBoundary: "synthesis" } });
    financialDependencies.push("valuation_analysis");
  }
  if (needsThesis) {
    nodes.push({ key: "thesis_update", kind: "thesis_update", title: "版本化更新命题支柱与改判信号", agent: "research-lead", dependsOn: [...judgmentKeys, ...financialDependencies], frontierRef: { problemGraphId: graph.id, compilerBoundary: "synthesis" } });
  }
  boundary("synthesis", "synthesis", "综合原子判断并保留局部差异", judgmentKeys, "synthesis");
  boundary("compose", "compose", "生成可编辑研究制品", ["synthesis", ...(needsThesis ? ["thesis_update"] : []), ...(needsValuation ? ["valuation_analysis"] : [])], "compose");
  if (needsReview) nodes.push({ key: "independent_review", kind: "independent_review", title: "隔离复核证据、模型、反证与叙事边界", agent: "research-lead", dependsOn: ["compose"], frontierRef: { problemGraphId: graph.id, compilerBoundary: "audit" } });
  boundary("audit", "audit", "确定性审计引用与表达", ["compose", ...(needsReview ? ["independent_review"] : [])], "audit");
  const parallelGroups = [nodes.filter((node) => node.kind === "method_selection").map((node) => node.key), ...(allowParallelEvidence ? [nodes.filter((node) => node.kind === "evidence_discovery").map((node) => node.key)] : [])]
    .filter((group) => group.length > 1);
  return {
    intent: graph.intentRefs[0] as ResearchIntent || "full_research",
    rationale: `由已确认的 Research Problem Graph 与 02_scenario_task Workflow Pattern ${workflowPatternRef} 编译；证据与裁决按 frontier 隔离。`,
    nodes, parallelGroups, stopConditions: [String(workflowPrior.graphPrior?.convergence || "required units terminal"), "budget exhausted", "researcher stop", ...scenarioStopConditions, ...capabilityGaps],
    stopPredicates: [{ kind: "required_units_terminal" }, { kind: "budget_exhausted" }, { kind: "researcher_stop" }],
  };
}

export function materializeNodes(taskId: string, plan: ResearchPlan, budget: Budget): TaskNode[] {
  const ids = new Map(plan.nodes.map((node) => [node.key, randomUUID()]));
  return plan.nodes.map((node) => {
    const type = getResearchNodeType(node.kind);
    return ({
    id: ids.get(node.key)!, taskId, kind: node.kind, title: node.title, capabilityType: type.capabilityType, capabilityId: type.capabilityId,
    assignedAgent: node.agent, dependsOn: node.dependsOn.map((key) => ids.get(key)!), status: node.dependsOn.length ? "pending" : "ready",
    budget: node.budget || { maxModelCalls: Math.max(1, Math.floor(budget.maxModelCalls / plan.nodes.length)), maxToolCalls: Math.max(1, Math.floor(budget.maxToolCalls / plan.nodes.length)), maxCostUsd: budget.maxCostUsd / plan.nodes.length },
    inputArtifactIds: [], outputArtifactIds: [], frontierRef: node.frontierRef || { problemGraphId: `problem-graph:${taskId}`, compilerBoundary: node.kind === "compose" ? "compose" : node.kind === "audit" ? "audit" : node.kind === "judgment" ? "synthesis" : "scope" }, iteration: node.iteration || 0,
    });
  });
}
