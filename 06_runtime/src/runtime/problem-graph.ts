import { randomUUID } from "node:crypto";
import type { ProblemGraphEdge, ProblemGraphNode, ResearchIntent, ResearchProblemGraph } from "@/src/contracts";

type Motif = {
  ref: string;
  scenario: string;
  name: string;
  unit: string;
  judgmentType: string;
  focus: string;
};

const MOTIFS: Motif[] = [
  { ref: "cycle_judgment", scenario: "industry_research", name: "周期判断", unit: "供需、库存与价格所处周期阶段", judgmentType: "cycle_position", focus: "供需、库存、价格与产能利用率" },
  { ref: "value_chain_analysis", scenario: "industry_research", name: "产业链分析", unit: "价值链约束与利润传导", judgmentType: "value_chain_transmission", focus: "价值链、供给约束、议价能力与利润传导" },
  { ref: "company_analysis", scenario: "company_research", name: "公司分析", unit: "公司经营与盈利传导", judgmentType: "operating_profit_transmission", focus: "收入、成本、产能、订单与利润传导" },
  { ref: "company_coverage", scenario: "company_research", name: "公司首次覆盖", unit: "公司基本面、模型与估值边界", judgmentType: "company_coverage", focus: "商业模式、KPI、财务模型、估值、反证与失效条件" },
  { ref: "earnings_update", scenario: "company_research", name: "业绩更新", unit: "实际业绩、模型修订与命题影响", judgmentType: "earnings_update", focus: "实际值、指引、内部前值、一次性项目与模型修订" },
  { ref: "thesis_review", scenario: "company_research", name: "命题复核", unit: "命题支柱、信号与失效条件", judgmentType: "thesis_review", focus: "命题支柱、强化/削弱/阻断信号、催化剂与失效条件" },
  { ref: "event_impact_analysis", scenario: "event_research", name: "事件影响", unit: "事件对经营与估值的影响路径", judgmentType: "event_impact", focus: "事件、影响范围、时点和业绩传导" },
  { ref: "technology_route_analysis", scenario: "technology_research", name: "技术路线", unit: "技术成熟度与商业化约束", judgmentType: "technology_maturity", focus: "技术成熟度、性能、良率、成本与商业化" },
];

const stamp = () => new Date().toISOString();
const includes = (text: string, words: string[]) => words.some((word) => text.includes(word));

const LENS_MOTIF_REFS: Record<string, string[]> = {
  fundamental: ["company_analysis"], growth: ["company_analysis", "technology_route_analysis"], quality: ["company_analysis"],
  value_valuation: ["company_analysis"], cycle: ["cycle_judgment", "value_chain_analysis"], event_driven: ["event_impact_analysis"],
  expectation_gap: ["earnings_update", "thesis_review"], risk_first: ["thesis_review", "event_impact_analysis"],
};

export function selectTaskMotifs(goal: string, lensRefs: string[] = []): Motif[] {
  const text = goal.toLowerCase();
  const selected = new Map<string, Motif>();
  const add = (ref: string) => selected.set(ref, MOTIFS.find((item) => item.ref === ref)!);
  if (includes(text, ["行业", "景气", "周期", "库存", "价格", "供需", "产业链"])) { add("cycle_judgment"); add("value_chain_analysis"); }
  if (includes(text, ["首次覆盖", "首覆", "公司覆盖"])) add("company_coverage");
  if (includes(text, ["业绩更新", "财报", "业绩快报", "业绩预告", "季报", "年报"])) add("earnings_update");
  if (includes(text, ["命题复核", "thesis", "投资逻辑跟踪", "命题跟踪"])) add("thesis_review");
  if (includes(text, ["公司", "企业", "财报", "业绩", "收入", "利润", "估值"])) add("company_analysis");
  if (includes(text, ["公告", "事件", "政策", "监管", "并购", "停产", "事故"])) add("event_impact_analysis");
  if (includes(text, ["技术", "路线", "成熟度", "良率", "商业化", "替代", "硅光", "sic", "碳化硅"])) add("technology_route_analysis");
  for (const lens of lensRefs) for (const ref of LENS_MOTIF_REFS[lens] || []) add(ref);
  if (!selected.size) add("company_analysis");
  return [...selected.values()];
}

export function buildResearchProblemGraph(input: {
  id?: string;
  taskId: string;
  researchCaseId: string;
  goal: string;
  intent: ResearchIntent;
  lensRefs?: string[];
}): Omit<ResearchProblemGraph, "version" | "fingerprint" | "createdAt" | "updatedAt"> {
  const id = input.id || randomUUID();
  const createdAt = stamp();
  const nodes: ProblemGraphNode[] = [];
  const edges: ProblemGraphEdge[] = [];
  const node = (key: string, type: ProblemGraphNode["type"], title: string, required: boolean, motifRef: string | undefined, payload: Record<string, unknown> = {}): ProblemGraphNode => {
    const value: ProblemGraphNode = { id: randomUUID(), graphId: id, key, type, title, state: type === "synthesis" ? "proposed" : "unresolved", required, motifRef, payload, resolvedArtifactIds: [], createdAt, updatedAt: createdAt };
    nodes.push(value);
    return value;
  };
  const edge = (from: ProblemGraphNode, to: ProblemGraphNode, relation: ProblemGraphEdge["relation"], payload: Record<string, unknown> = {}) => {
    edges.push({ id: randomUUID(), graphId: id, fromNodeId: from.id, toNodeId: to.id, relation, payload });
  };

  const roots: ProblemGraphNode[] = [];
  for (const motif of selectTaskMotifs(input.goal, input.lensRefs || [])) {
    const root = node(`${motif.ref}:question`, "root_question", `${motif.name}：${input.goal}`, true, motif.ref, { question: input.goal, scenarioRef: motif.scenario, lensRefs: input.lensRefs || [] });
    const unit = node(`${motif.ref}:unit`, "judgment_unit", motif.unit, true, motif.ref, { judgmentType: motif.judgmentType, focus: motif.focus, equivalenceKey: `${motif.ref}:${motif.judgmentType}` });
    const hypothesis = node(`${motif.ref}:primary`, "hypothesis", `主假设：${motif.unit}成立`, true, motif.ref, { role: "primary", judgmentUnitKey: unit.key });
    const competing = node(`${motif.ref}:competing`, "competing_explanation", `竞争解释：${motif.unit}并非由主路径驱动`, true, motif.ref, { role: "competing", judgmentUnitKey: unit.key });
    edge(unit, root, "aggregates");
    edge(hypothesis, unit, "informs");
    edge(competing, hypothesis, "challenges");
    for (const role of ["support", "counter", "boundary"] as const) {
      const requirement = node(`${motif.ref}:evidence:${role}`, "evidence_requirement", `${role === "support" ? "支持" : role === "counter" ? "反证" : "边界"}证据：${motif.unit}`, true, motif.ref, {
        evidenceRole: role, judgmentUnitKey: unit.key, minIndependentPublishers: role === "support" ? 2 : 1,
        requiredSourceTypes: role === "support" ? ["primary", "secondary"] : ["primary"], scope: motif.focus,
      });
      edge(requirement, unit, "requires", { evidenceRole: role });
      edge(requirement, role === "counter" ? competing : hypothesis, role === "counter" ? "informs" : "informs", { evidenceRole: role });
    }
    roots.push(root);
  }
  const synthesis = node("synthesis", "synthesis", "综合各判断单元并保留局部不确定性", true, undefined, { requiredTerminalStates: ["resolved", "blocked", "indeterminate"] });
  for (const root of roots) edge(root, synthesis, "aggregates");
  return {
    id, taskId: input.taskId, researchCaseId: input.researchCaseId, status: "proposed",
    intentRefs: [input.intent], scenarioRefs: [...new Set(roots.map((root) => String(root.payload.scenarioRef)))],
    taskMotifRefs: [...new Set(nodes.map((item) => item.motifRef).filter(Boolean) as string[])], lensRefs: input.lensRefs || [], nodes, edges,
  };
}

export function graphNodeByKey(graph: ResearchProblemGraph, key: string): ProblemGraphNode {
  const result = graph.nodes.find((item) => item.key === key);
  if (!result) throw new Error(`Problem graph node not found: ${key}`);
  return result;
}

export function judgmentUnitRequirements(graph: ResearchProblemGraph, unit: ProblemGraphNode): ProblemGraphNode[] {
  return graph.edges.filter((edge) => edge.toNodeId === unit.id && edge.relation === "requires")
    .map((edge) => graph.nodes.find((node) => node.id === edge.fromNodeId))
    .filter((node): node is ProblemGraphNode => Boolean(node));
}
