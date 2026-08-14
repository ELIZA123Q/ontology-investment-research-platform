import type { AgentId, ArtifactKind, ResearchRole, TrustedComponentKind } from "@/src/contracts";
import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

export type CapabilityLifecycle = "authored" | "candidate" | "active" | "retired";
export type CapabilityExecutionScope = "production" | "evaluation";

export interface CapabilityReleaseEntry {
  id: string;
  version: string;
  lifecycle: CapabilityLifecycle;
  executionScopes: CapabilityExecutionScope[];
  activationEvidence?: {
    type: "foundational_baseline" | "evaluation_run";
    evaluatedAt: string;
    rationale?: string;
    evaluationRunRefs?: string[];
    metrics?: { comparableCases: number; blindWinRate: number; severeRegressions: number; [key: string]: number };
  };
}

export interface CapabilityReleaseManifest {
  schemaName: "capability_release_manifest";
  schemaVersion: string;
  releaseId: string;
  status: "current" | "superseded";
  productScope: string;
  skills: CapabilityReleaseEntry[];
  agents: CapabilityReleaseEntry[];
  tools: CapabilityReleaseEntry[];
  activationPolicy: {
    minimumComparableCases: number;
    minimumBlindWinRate: number;
    maximumSevereRegressions: number;
    candidateProductionDispatchAllowed: boolean;
  };
}

export const CAPABILITY_RELEASE = DOMAIN_CATALOG.capabilities.release as unknown as CapabilityReleaseManifest;
const releaseFor = (kind: "skills" | "agents" | "tools", id: string) => {
  const found = CAPABILITY_RELEASE[kind].find((entry) => entry.id === id);
  if (!found) throw new Error(`${kind.slice(0, -1)} ${id} is missing from Capability Release ${CAPABILITY_RELEASE.releaseId}`);
  return found;
};

export interface SkillManifest {
  id: string;
  version: string;
  description: string;
  procedure: string[];
  inputKinds: string[];
  outputKind: ArtifactKind;
  allowedTools: string[];
  eligibleAgents: AgentId[];
  lifecycle: CapabilityLifecycle;
  executionScopes: CapabilityExecutionScope[];
}

export interface ToolManifest {
  id: string;
  version: string;
  description: string;
  risk: "read" | "write" | "external_side_effect";
  requiresApproval: boolean;
  idempotent: boolean;
}

export interface AgentManifest {
  id: AgentId;
  version: string;
  description: string;
  canAssumeRoles: ResearchRole[];
  canDelegateTo: AgentId[];
  allowedSkills: string[];
  allowedTools: string[];
  canWriteArtifactKinds: ArtifactKind[];
  contextPolicy: "conversation" | "delegated_slice" | "isolated_review";
  lifecycle: CapabilityLifecycle;
  executionScopes: CapabilityExecutionScope[];
}

type SkillDefinition = {
  skill_id: string;
  purpose: string;
  execution_contract: { output_kind: ArtifactKind; eligible_agents: AgentId[]; allowed_tools: string[]; procedure: string[] };
};
const skillAuthority = DOMAIN_CATALOG.capabilities.skills as unknown as { execution_contract_defaults: { input_kinds: string[] }; skills: SkillDefinition[] };
const skillDefinitions = skillAuthority.skills;
export const SKILLS: readonly SkillManifest[] = skillDefinitions.map((definition) => {
  const release = releaseFor("skills", definition.skill_id);
  return {
    id: definition.skill_id,
    version: release.version,
    description: definition.purpose,
    procedure: definition.execution_contract.procedure,
    inputKinds: skillAuthority.execution_contract_defaults.input_kinds,
    outputKind: definition.execution_contract.output_kind,
    allowedTools: definition.execution_contract.allowed_tools,
    eligibleAgents: definition.execution_contract.eligible_agents,
    lifecycle: release.lifecycle,
    executionScopes: release.executionScopes,
  };
});

type ToolDefinition = { tool_id: string; version: string; description: string; risk: ToolManifest["risk"]; approval_required?: boolean; idempotent: boolean };
export const TOOLS: readonly ToolManifest[] = (DOMAIN_CATALOG.capabilities.tools.tools as unknown as ToolDefinition[]).map((definition) => {
  const release = releaseFor("tools", definition.tool_id);
  return { id: definition.tool_id, version: release.version, description: definition.description, risk: definition.risk, requiresApproval: definition.approval_required === true, idempotent: definition.idempotent };
});

type AgentDefinition = {
  agent_id: AgentId;
  lifecycle: string;
  role?: string;
  notes?: string;
  can_assume_roles: ResearchRole[];
  context_policy?: AgentManifest["contextPolicy"];
  execution_contract: {
    context_policy?: AgentManifest["contextPolicy"];
    can_delegate_to: AgentId[];
    allowed_skills: string[] | "all_released_for_scope";
    allowed_tools: string[];
    writable_artifact_kinds: ArtifactKind[];
  };
};
const agentAuthority = DOMAIN_CATALOG.capabilities.agents as unknown as { agents: AgentDefinition[]; candidates: AgentDefinition[] };
export const AGENTS: readonly AgentManifest[] = [...agentAuthority.agents, ...agentAuthority.candidates].map((definition) => {
  const release = releaseFor("agents", definition.agent_id);
  return {
    id: definition.agent_id,
    version: release.version,
    description: definition.role || definition.notes || definition.agent_id,
    canAssumeRoles: definition.can_assume_roles,
    canDelegateTo: definition.execution_contract.can_delegate_to,
    allowedSkills: definition.execution_contract.allowed_skills === "all_released_for_scope" ? SKILLS.map((item) => item.id) : definition.execution_contract.allowed_skills,
    allowedTools: definition.execution_contract.allowed_tools,
    canWriteArtifactKinds: definition.execution_contract.writable_artifact_kinds,
    contextPolicy: definition.execution_contract.context_policy || definition.context_policy || "conversation",
    lifecycle: release.lifecycle,
    executionScopes: release.executionScopes,
  };
});

export const TRUSTED_COMPONENTS: readonly TrustedComponentKind[] = [
  "clarification_form", "research_plan", "evidence_matrix", "hypothesis_map", "judgment_card", "comparison_table", "chart", "report_editor", "approval_card", "branch_card", "execution_timeline",
] as const;

export function getSkill(id: string): SkillManifest {
  const found = SKILLS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown skill: ${id}`);
  return found;
}

export function assertSkillExecutionAllowed(id: string, scope: CapabilityExecutionScope): SkillManifest {
  const found = getSkill(id);
  if (!found.executionScopes.includes(scope)) throw new Error(`Skill ${id} is not released for ${scope} execution`);
  if (scope === "production" && found.lifecycle !== "active") throw new Error(`Candidate skill ${id} cannot be dispatched in production`);
  return found;
}

export function isSkillExecutionAllowed(id: string, scope: CapabilityExecutionScope): boolean {
  try { assertSkillExecutionAllowed(id, scope); return true; }
  catch { return false; }
}

export function runtimeExecutionScope(): CapabilityExecutionScope {
  return process.env.VNEXT_EXECUTION_SCOPE === "evaluation" ? "evaluation" : "production";
}

export function assertAgentExecutionAllowed(id: AgentId, scope: CapabilityExecutionScope): AgentManifest {
  const found = getAgent(id);
  if (!found.executionScopes.includes(scope)) throw new Error(`Agent ${id} is not released for ${scope} execution`);
  if (scope === "production" && found.lifecycle !== "active") throw new Error(`Candidate Agent ${id} cannot be dispatched in production`);
  return found;
}

export function assertToolExecutionAllowed(id: string, scope: CapabilityExecutionScope): ToolManifest {
  const found = TOOLS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown Tool: ${id}`);
  const release = releaseFor("tools", id);
  if (!release.executionScopes.includes(scope)) throw new Error(`Tool ${id} is not released for ${scope} execution`);
  if (scope === "production" && release.lifecycle !== "active") throw new Error(`Candidate Tool ${id} cannot be dispatched in production`);
  return found;
}

export function isToolExecutionAllowed(id: string, scope: CapabilityExecutionScope): boolean {
  try { assertToolExecutionAllowed(id, scope); return true; }
  catch { return false; }
}

export function getAgent(id: AgentId): AgentManifest {
  const found = AGENTS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}
