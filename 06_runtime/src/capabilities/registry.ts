import type { AgentId, ArtifactKind, TrustedComponentKind } from "@/src/contracts";
import releaseManifestJson from "../../../03_agent_capability/releases/current.json";

export type CapabilityLifecycle = "authored" | "candidate" | "active" | "retired";
export type CapabilityExecutionScope = "production" | "evaluation";

export interface CapabilityReleaseEntry {
  id: string;
  version: string;
  lifecycle: CapabilityLifecycle;
  executionScopes: CapabilityExecutionScope[];
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

export const CAPABILITY_RELEASE = releaseManifestJson as CapabilityReleaseManifest;
const releaseEntries = new Map(CAPABILITY_RELEASE.skills.map((entry) => [entry.id, entry]));

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
): SkillManifest => {
  const release = releaseEntries.get(id);
  if (!release) throw new Error(`Skill ${id} is missing from Capability Release ${CAPABILITY_RELEASE.releaseId}`);
  return { id, version: release.version, description, procedure, inputKinds: ["context_package"], outputKind, allowedTools, eligibleAgents, lifecycle: release.lifecycle, executionScopes: release.executionScopes };
};

export const SKILLS: readonly SkillManifest[] = [
  skill("research-framing", "明确对象、期限、决策、成功标准与必要澄清。", "research_plan", ["research-lead"], ["识别会改变路径的缺口", "给出可编辑默认值", "把目标表达为可证伪问题"]),
  skill("research-design", "面对 Task 选择研究框架、判断结构与证伪设计。", "method_application", ["research-lead", "analysis-specialist"], ["识别判断类型", "匹配方法约束", "记录替代方法与退出条件"]),
  skill("evidence-research", "提出证据需求、选择来源与通道、获取核验、留痕并评估完备度。", "evidence_package", ["research-lead", "evidence-investigator", "independent-critic"], ["区分候选来源、快照和 EvidenceFact", "检查交叉验证", "证据不足时显式停止"]),
  skill("judgment-reasoning", "建立主假设、竞争解释、因果链、反证、情景与判断强度。", "hypothesis_map", ["research-lead", "analysis-specialist"], ["列出竞争解释", "绑定支持与反证", "定义区分性观察和改判信号"]),
  skill("research-delivery", "将已验证证据与判断组织为快答、研报、判断卡等交付物。", "report", ["research-lead"], ["只使用正式制品", "区分事实、推断与观点", "保留不确定性和改判条件"]),
  skill("company-fundamental-research", "拆解商业模式、KPI、竞争优势、财务传导与公司命题。", "hypothesis_map", ["research-lead"], ["冻结公司和报告期边界", "绑定经营到财务传导", "列出竞争解释"]),
  skill("sector-cycle-research", "分析供需、库存、价格、产能与周期位置并映射公司。", "hypothesis_map", ["research-lead"], ["冻结产品和区域口径", "区分直接指标与代理指标", "说明公司暴露与时滞"]),
  skill("financial-modeling", "生成规范化财务和可审计的驱动式三表模型。", "financial_model", ["research-lead", "financial-modeler"], ["历史与预测边界分离", "冻结单位、币种和口径", "模型审计失败即阻断估值"]),
  skill("valuation-analysis", "在审计通过的模型上完成可比、DCF/SOTP 与敏感性。", "valuation_analysis", ["research-lead", "financial-modeler"], ["冻结 asOf 与股本口径", "说明方法适用性", "不生成评级或目标价"]),
  skill("earnings-update", "比较实际值、指引、内部前值与授权一致预期，更新模型与命题影响。", "thesis_state", ["research-lead"], ["无 vintage 一致预期即阻断 beat/miss", "分解一次性项目", "记录模型修订"]),
  skill("thesis-monitoring", "版本化维护命题支柱、信号、催化剂和失效条件。", "thesis_state", ["research-lead"], ["不得覆盖历史版本", "信号必须绑定制品引用", "不替代正式改判"]),
  skill("independent-research-review", "在隔离上下文中复核证据、模型、反证和叙事边界。", "review", ["independent-critic"], ["只读取授权制品切片", "只输出 review", "不得静默改写主制品"]),
] as const;

export const TOOLS: readonly ToolManifest[] = [
  { id: "semantic.search", version: "1.0.0", description: "混合检索本体、全文、向量与图引用。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "source.discover", version: "1.0.0", description: "发现候选研究来源。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "source.capture", version: "1.0.0", description: "抓取并快照指定来源。", risk: "write", requiresApproval: false, idempotent: true },
  { id: "source.query", version: "1.0.0", description: "按来源策略查询并检索外部材料；底层可通过 MCP/API/DB 适配。", risk: "read", requiresApproval: false, idempotent: true },
  { id: "artifact.publish", version: "1.0.0", description: "发布正式制品。", risk: "external_side_effect", requiresApproval: true, idempotent: true },
  { id: "financial.model.validate", version: "1.0.0", description: "确定性校验模型边界、公式依赖、审计和一致预期条件。", risk: "read", requiresApproval: false, idempotent: true },
] as const;

const allSkills = SKILLS.map((item) => item.id);
export const AGENTS: readonly AgentManifest[] = [
  {
    id: "research-lead",
    description: "唯一面向研究员，负责目标、计划、预算、委派、判断和交付。",
    canDelegateTo: ["evidence-investigator", "financial-modeler", "analysis-specialist", "independent-critic"],
    allowedSkills: allSkills,
    allowedTools: ["semantic.search", "source.discover", "source.capture", "source.query", "financial.model.validate", "artifact.publish"],
    canWriteArtifactKinds: ["research_plan", "method_application", "evidence_package", "hypothesis_map", "judgment", "report", "review", "normalized_financials", "financial_model", "valuation_analysis", "thesis_state", "ui_surface"],
    contextPolicy: "conversation",
    lifecycle: "active",
  },
  {
    id: "evidence-investigator",
    description: "只处理委派证据切片，不负责最终判断。",
    canDelegateTo: [],
    allowedSkills: ["evidence-research"],
    allowedTools: ["semantic.search", "source.discover", "source.capture", "source.query"],
    canWriteArtifactKinds: ["evidence_package"],
    contextPolicy: "delegated_slice",
    lifecycle: "planned",
  },
  {
    id: "financial-modeler",
    description: "只处理授权财务数据、结构化模型、估值分析与模型审计，不负责判断或发布。",
    canDelegateTo: [],
    allowedSkills: ["financial-modeling", "valuation-analysis"],
    allowedTools: ["semantic.search", "source.query", "financial.model.validate"],
    canWriteArtifactKinds: ["normalized_financials", "financial_model", "valuation_analysis"],
    contextPolicy: "delegated_slice",
    lifecycle: "planned",
  },
  {
    id: "analysis-specialist",
    description: "按需处理复杂传导、竞争解释和情景分析。",
    canDelegateTo: [],
    allowedSkills: ["research-design", "judgment-reasoning"],
    allowedTools: ["semantic.search", "source.query"],
    canWriteArtifactKinds: ["method_application", "hypothesis_map"],
    contextPolicy: "delegated_slice",
    lifecycle: "planned",
  },
  {
    id: "independent-critic",
    description: "在隔离上下文中审查，只能输出 review，不能静默改写主制品。",
    canDelegateTo: [],
    allowedSkills: ["independent-research-review"],
    allowedTools: ["semantic.search", "financial.model.validate"],
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

export function assertSkillExecutionAllowed(id: string, scope: CapabilityExecutionScope): SkillManifest {
  const found = getSkill(id);
  if (!found.executionScopes.includes(scope)) throw new Error(`Skill ${id} is not released for ${scope} execution`);
  if (scope === "production" && found.lifecycle !== "active") throw new Error(`Candidate skill ${id} cannot be dispatched in production`);
  return found;
}

export function getAgent(id: AgentId): AgentManifest {
  const found = AGENTS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}
