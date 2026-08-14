import { buildResearchProblemGraph } from "@/src/runtime/problem-graph";
import { planFromProblemGraph, materializeNodes } from "@/src/runtime/planner";

const DEFAULT_BUDGET = { maxModelCalls: 12, maxToolCalls: 30, maxCostUsd: 3 };

const goal = "截至2026-08-11，华泰智研半导体行业景气度连续三个月下行，是否足以支持半导体行业基本面转弱的投资判断？请聚焦中国A股半导体二级行业，区分研究衍生景气指标与独立实物量证据。";

const graph = buildResearchProblemGraph({ taskId: "diag-task", researchCaseId: "semiconductor-restraint-2026-08-11", goal, intent: "full_research", reportDepth: "standard", lensRefs: [] });
const persistedGraph = {
  ...graph,
  version: 1,
  fingerprint: "diagnostic-only",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};
const plan = planFromProblemGraph(persistedGraph, DEFAULT_BUDGET);
console.log("PLAN node count:", plan.nodes.length);
const nodes = materializeNodes("diag-task", plan, DEFAULT_BUDGET);
console.log("MATERIALIZED node count:", nodes.length);
for (const n of nodes.filter((n) => ["hypothesis", "judgment", "independent_review", "evidence_evaluation", "method_selection", "compose"].includes(n.kind))) {
  console.log("  ", n.kind, "maxModelCalls=", n.budget.maxModelCalls, "maxToolCalls=", n.budget.maxToolCalls, "maxCostUsd=", n.budget.maxCostUsd?.toFixed(4));
}
