import { RESEARCH_NODE_CATALOG } from "@/src/runtime/node-catalog";
import { planResearch, type ResearchPlan } from "@/src/runtime/planner";
import type { ResearchIntent } from "@/src/contracts";

export interface GoldTaskContract {
  id: string;
  goal: string;
  expectedIntent: ResearchIntent;
  expectedRequiredNodes: string[];
  expectedForbiddenNodes: string[];
  expectedOutcome:
    | "requires_verified_sources_before_supported_claim"
    | "abstain_when_evidence_is_insufficient"
    | "invalidate_impacted_artifacts_only";
}

export interface GoldTaskCheck {
  id: string;
  passed: boolean;
  note: string;
}

export interface GoldTaskEvaluation {
  taskId: string;
  passed: boolean;
  intent: ResearchIntent;
  checks: GoldTaskCheck[];
}

function dependencyPathExists(plan: ResearchPlan, ancestorKind: string, descendantKind: string): boolean {
  const byKey = new Map(plan.nodes.map((node) => [node.key, node]));
  const starts = plan.nodes.filter((node) => node.kind === descendantKind);
  const visit = (key: string, seen: Set<string>): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    const node = byKey.get(key);
    if (!node) return false;
    if (node.kind === ancestorKind) return true;
    return node.dependsOn.some((dependency) => visit(dependency, seen));
  };
  return starts.some((node) => visit(node.key, new Set()));
}

function check(id: string, passed: boolean, success: string, failure: string): GoldTaskCheck {
  return { id, passed, note: passed ? success : failure };
}

function outcomeChecks(task: GoldTaskContract, plan: ResearchPlan): GoldTaskCheck[] {
  const evidenceChain = [
    dependencyPathExists(plan, "evidence_discovery", "evidence_capture"),
    dependencyPathExists(plan, "evidence_capture", "evidence_evaluation"),
    dependencyPathExists(plan, "evidence_evaluation", "judgment"),
  ].every(Boolean);
  if (task.expectedOutcome === "requires_verified_sources_before_supported_claim") {
    return [check("evidence_chain_before_judgment", evidenceChain, "判断位于发现、快照和核验证据链之后。", "判断可以绕过完整证据链。")];
  }
  if (task.expectedOutcome === "abstain_when_evidence_is_insufficient") {
    const judgmentType = RESEARCH_NODE_CATALOG.find((node) => node.kind === "judgment");
    const abstentionInvariant = judgmentType?.invariants.some((item) => item.includes("暂不可判断")) || false;
    return [
      check("evidence_chain_before_judgment", evidenceChain, "判断依赖完整证据链。", "判断可以绕过完整证据链。"),
      check("abstention_invariant", abstentionInvariant, "节点合同强制无合格证据时弃权。", "判断节点缺少证据不足时弃权的硬约束。"),
    ];
  }
  const hasImpact = plan.nodes.some((node) => node.kind === "impact_analysis");
  const rerunsMethodSelection = plan.nodes.some((node) => node.kind === "method_selection");
  return [
    check("impact_analysis_first", hasImpact, "更新路径先做影响分析。", "更新路径缺少影响分析。"),
    check("no_unconditional_method_rerun", !rerunsMethodSelection, "未无条件重跑研究设计。", "更新路径无条件重跑了研究设计。"),
  ];
}

export function evaluateGoldTask(task: GoldTaskContract): GoldTaskEvaluation {
  const plan = planResearch(task.goal);
  const nodeKinds = new Set(plan.nodes.map((node) => node.kind));
  const checks: GoldTaskCheck[] = [
    check("intent", plan.intent === task.expectedIntent, `意图为 ${plan.intent}。`, `期望 ${task.expectedIntent}，实际为 ${plan.intent}。`),
    ...task.expectedRequiredNodes.map((kind) => check(`required:${kind}`, nodeKinds.has(kind), `包含强制节点 ${kind}。`, `缺少强制节点 ${kind}。`)),
    ...task.expectedForbiddenNodes.map((kind) => check(`forbidden:${kind}`, !nodeKinds.has(kind), `未出现禁止节点 ${kind}。`, `出现禁止节点 ${kind}。`)),
    ...outcomeChecks(task, plan),
  ];
  return { taskId: task.id, passed: checks.every((item) => item.passed), intent: plan.intent, checks };
}

export function evaluateGoldTasks(tasks: GoldTaskContract[]): GoldTaskEvaluation[] {
  return tasks.map(evaluateGoldTask);
}
