import { randomUUID } from "node:crypto";
import type { AgentId, Budget, FrontierRef, ResearchIntent, ResearchProblemGraph, StopPredicate, TaskNode } from "@/src/contracts";
import { judgmentUnitRequirements } from "@/src/runtime/problem-graph";
import { getResearchNodeType } from "@/src/runtime/node-catalog";

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
export function planFromProblemGraph(graph: ResearchProblemGraph, budget: Budget): ResearchPlan {
  const nodes: PlannedNode[] = [];
  const boundary = (key: string, kind: string, title: string, dependsOn: string[], compilerBoundary: NonNullable<FrontierRef["compilerBoundary"]>) =>
    nodes.push({ key, kind, title, agent: "research-lead", dependsOn, frontierRef: { problemGraphId: graph.id, compilerBoundary } });
  boundary("context", "semantic_context", "装配研究范围与历史上下文", [], "scope");

  const judgmentUnits = graph.nodes.filter((node) => node.type === "judgment_unit" && node.required);
  for (const unit of judgmentUnits) {
    const prefix = unit.key.replace(/[^a-zA-Z0-9_:-]/g, "_");
    const unitFrontier: FrontierRef = { problemGraphId: graph.id, problemNodeId: unit.id, judgmentUnitRef: unit.semanticRef || unit.id };
    const methodKey = `${prefix}:method`;
    const hypothesisKey = `${prefix}:hypothesis`;
    nodes.push({ key: methodKey, kind: "method_selection", title: `选择证伪方法：${unit.title}`, agent: "research-lead", dependsOn: ["context"], frontierRef: unitFrontier });
    nodes.push({ key: hypothesisKey, kind: "hypothesis", title: `主假设与竞争解释：${unit.title}`, agent: "research-lead", dependsOn: [methodKey], frontierRef: unitFrontier });
    const evaluations: string[] = [];
    for (const requirement of judgmentUnitRequirements(graph, unit)) {
      const role = requirement.payload.evidenceRole as FrontierRef["evidenceRole"];
      const requirementFrontier: FrontierRef = { ...unitFrontier, problemNodeId: requirement.id, evidenceRequirementRef: requirement.semanticRef || requirement.id, evidenceRole: role };
      const discoverKey = `${prefix}:discover:${role}`;
      const captureKey = `${prefix}:capture:${role}`;
      const evaluateKey = `${prefix}:evaluate:${role}`;
      nodes.push({ key: discoverKey, kind: "evidence_discovery", title: `发现${role === "support" ? "支持" : role === "counter" ? "反证" : "边界"}证据：${unit.title}`, agent: "research-lead", dependsOn: [methodKey], frontierRef: requirementFrontier });
      nodes.push({ key: captureKey, kind: "evidence_capture", title: `保存来源快照：${unit.title}`, agent: "research-lead", dependsOn: [discoverKey], frontierRef: requirementFrontier });
      nodes.push({ key: evaluateKey, kind: "evidence_evaluation", title: `评估${role === "support" ? "支持" : role === "counter" ? "反证" : "边界"}证据：${unit.title}`, agent: "research-lead", dependsOn: [captureKey], frontierRef: requirementFrontier });
      evaluations.push(evaluateKey);
    }
    nodes.push({ key: `${prefix}:judgment`, kind: "judgment", title: `裁决判断单元：${unit.title}`, agent: "research-lead", dependsOn: [hypothesisKey, ...evaluations], frontierRef: unitFrontier });
  }
  const judgmentKeys = nodes.filter((node) => node.kind === "judgment").map((node) => node.key);
  boundary("synthesis", "synthesis", "综合原子判断并保留局部差异", judgmentKeys, "synthesis");
  boundary("compose", "compose", "生成可编辑研究制品", ["synthesis"], "compose");
  boundary("audit", "audit", "确定性审计引用与表达", ["compose"], "audit");
  const parallelGroups = [nodes.filter((node) => node.kind === "method_selection").map((node) => node.key), nodes.filter((node) => node.kind === "evidence_discovery").map((node) => node.key)]
    .filter((group) => group.length > 1);
  return {
    intent: graph.intentRefs[0] as ResearchIntent || "full_research",
    rationale: "由已确认的 Research Problem Graph 编译；证据与裁决均按判断单元和证据角色隔离。",
    nodes, parallelGroups, stopConditions: ["required units terminal", "budget exhausted", "researcher stop"],
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
