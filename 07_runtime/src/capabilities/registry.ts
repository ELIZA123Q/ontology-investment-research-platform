import type { AgentId, ArtifactKind, TrustedComponentKind } from "@/src/contracts";

export interface SkillManifest {
  id: string;
  version: string;
  description: string;
  procedure: string[];
  inputKinds: string[];
  outputKind: ArtifactKind;
  allowedTools: string[];
  eligibleAgents: AgentId[];
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
  description: string;
  canDelegateTo: AgentId[];
  allowedSkills: string[];
  allowedTools: string[];
  canWriteArtifactKinds: ArtifactKind[];
  contextPolicy: "conversation" | "delegated_slice" | "isolated_review";
  lifecycle: "active" | "planned";
}

const skill = (
  id: string,
  description: string,
  outputKind: ArtifactKind,
  eligibleAgents: AgentId[],
  procedure: string[],
  allowedTools: string[] = [],
): SkillManifest => ({ id, version: "1.0.0", description, procedure, inputKinds: ["context_package"], outputKind, allowedTools, eligibleAgents });

export const SKILLS: readonly SkillManifest[] = [
  skill("research-framing", "明确对象、期限、决策、成功标准与必要澄清。", "research_plan", ["research-lead"], ["识别会改变路径的缺口", "给出可编辑默认值", "把目标表达为可证伪问题"]),
  skill("research-method", "按判断类型选择研究、证伪与替代方法。", "research_plan", ["research-lead", "analysis-specialist"], ["识别判断类型", "匹配方法约束", "记录替代方法与退出条件"]),
  skill("evidence-assessment", "评估证据的相关性、可靠性、独立性和覆盖度。", "evidence_package", ["research-lead", "evidence-investigator", "independent-critic"], ["区分候选来源、快照和 EvidenceFact", "检查交叉验证", "证据不足时显式停止"]),
  skill("hypothesis-analysis", "建立主假设、竞争解释、情景和可证伪信号。", "hypothesis_map", ["research-lead", "analysis-specialist"], ["列出竞争解释", "绑定支持与反证", "定义区分性观察和改判信号"]),
  skill("research-writing", "把已验证的证据和判断写成边界清晰的研究制品。", "report", ["research-lead"], ["只使用正式制品", "区分事实、推断与观点", "保留不确定性和改判条件"]),
] as const;

export const TOOLS: readonly ToolManifest[] = [
  { id: "semantic.search", version: "1.0.0", description: "混合检索本体、全文、向量与图引用。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "source.discover", version: "1.0.0", description: "发现候选研究来源。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "source.capture", version: "1.0.0", description: "抓取并快照指定来源。", risk: "write", requiresApproval: false, idempotent: true },
  { id: "financial.mcp", version: "1.0.0", description: "通过 MCP 查询金融数据；它是 Tool，不是 Skill。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "artifact.publish", version: "1.0.0", description: "发布正式制品。", risk: "external_side_effect", requiresApproval: true, idempotent: true },
] as const;

const allSkills = SKILLS.map((item) => item.id);
export const AGENTS: readonly AgentManifest[] = [
  {
    id: "research-lead",
    description: "唯一面向研究员，负责目标、计划、预算、委派、判断和交付。",
    canDelegateTo: ["evidence-investigator", "analysis-specialist", "independent-critic"],
    allowedSkills: allSkills,
    allowedTools: ["semantic.search", "artifact.publish"],
    canWriteArtifactKinds: ["research_plan", "evidence_package", "hypothesis_map", "judgment", "report", "review", "ui_surface"],
    contextPolicy: "conversation",
    lifecycle: "active",
  },
  {
    id: "evidence-investigator",
    description: "只处理委派证据切片，不负责最终判断。",
    canDelegateTo: [],
    allowedSkills: ["evidence-assessment"],
    allowedTools: ["semantic.search", "source.discover", "source.capture", "financial.mcp"],
    canWriteArtifactKinds: ["evidence_package"],
    contextPolicy: "delegated_slice",
    lifecycle: "planned",
  },
  {
    id: "analysis-specialist",
    description: "按需处理复杂传导、竞争解释和情景分析。",
    canDelegateTo: [],
    allowedSkills: ["research-method", "hypothesis-analysis"],
    allowedTools: ["semantic.search", "financial.mcp"],
    canWriteArtifactKinds: ["hypothesis_map"],
    contextPolicy: "delegated_slice",
    lifecycle: "planned",
  },
  {
    id: "independent-critic",
    description: "在隔离上下文中审查，只能输出 review，不能静默改写主制品。",
    canDelegateTo: [],
    allowedSkills: ["evidence-assessment"],
    allowedTools: ["semantic.search"],
    canWriteArtifactKinds: ["review"],
    contextPolicy: "isolated_review",
    lifecycle: "planned",
  },
] as const;

export const TRUSTED_COMPONENTS: readonly TrustedComponentKind[] = [
  "clarification_form", "research_plan", "evidence_matrix", "hypothesis_map", "judgment_card", "comparison_table", "chart", "report_editor", "approval_card", "branch_card", "execution_timeline",
] as const;

export function getSkill(id: string): SkillManifest {
  const found = SKILLS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown skill: ${id}`);
  return found;
}

export function getAgent(id: AgentId): AgentManifest {
  const found = AGENTS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}
