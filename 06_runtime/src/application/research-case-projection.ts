import type { Task } from "@/src/contracts";
import type { Artifact } from "@/src/contracts/evidence";
import { editableArtifactFields } from "@/src/governance/policy-engine";
import type { AgentKernel } from "@/src/runtime/kernel";
import { approvalCommand, taskOutcomeLabel } from "@/src/runtime/state-machine";
import type { ResearchCaseV2 } from "@/src/application/research-case-contracts";

export function buildResearchCaseSnapshot(researchCase: ResearchCaseV2, kernel: AgentKernel) {
  const runtime = kernel.snapshot(researchCase.conversationId, researchCase.taskId);
  const pending = runtime.approvals[0];
  const binding = pending ? approvalCommand(pending.kind) : null;
  const artifactPermissions = Object.fromEntries(runtime.artifacts.map((artifact) => {
    if (artifact.kind === "report") return [artifact.id, [...editableArtifactFields("report")]];
    if (artifact.kind !== "judgment") return [artifact.id, []];
    const data = artifact.data as Record<string, unknown>;
    const sufficient = !["abstain", "insufficient"].includes(String(data.disposition || data.confidence));
    return [artifact.id, [...editableArtifactFields("judgment", sufficient)]];
  }));
  return {
    researchCase,
    runtime,
    decisionSpine: decisionSpine(runtime.artifacts, runtime.task),
    intervention: pending && binding ? { approvalId: pending.id, prompt: pending.prompt, ...binding } : null,
    taskOutcome: runtime.task?.outcome ? { value: runtime.task.outcome, label: taskOutcomeLabel(runtime.task.outcome) } : null,
    artifactPermissions,
  };
}

function decisionSpine(artifacts: Artifact[], task: Task | null) {
  const definitions = [
    ["scope", ["research_plan", "research_problem_graph"]],
    ["evidence", ["evidence_package"]],
    ["business_and_kpi", ["hypothesis_map"]],
    ["financial_model", ["normalized_financials", "financial_model"]],
    ["judgment", ["judgment", "thesis_state"]],
    ["valuation", ["valuation_analysis"]],
    ["report", ["report", "review"]],
  ] as const;
  return definitions.map(([id, kinds]) => {
    const matches = artifacts.filter((artifact) => (kinds as readonly string[]).includes(artifact.kind));
    const latest = matches.at(-1);
    const status = latest?.status === "superseded" ? "invalidated"
      : latest?.status === "verified" ? "ready"
      : task?.status === "waiting_approval" && latest ? "waiting_approval"
      : latest ? "limited"
      : task?.outcome?.startsWith("blocked_") || task?.outcome === "stopped_insufficient_evidence" ? "blocked" : "limited";
    return { id, status, artifactIds: matches.map((artifact) => artifact.id) };
  });
}
