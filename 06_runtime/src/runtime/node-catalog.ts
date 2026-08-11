import type { ArtifactKind, TaskNode } from "@/src/contracts";

export interface ResearchNodeType {
  kind: string;
  capabilityType: TaskNode["capabilityType"];
  capabilityId: string;
  outputKind: ArtifactKind | "runtime_context";
  preconditions: string[];
  invariants: string[];
  checkpointAfter: boolean;
}

export const RESEARCH_NODE_CATALOG: readonly ResearchNodeType[] = [
  { kind: "clarify", capabilityType: "skill", capabilityId: "research-framing", outputKind: "research_plan", preconditions: [], invariants: ["只询问会改变研究路径的问题"], checkpointAfter: true },
  { kind: "semantic_context", capabilityType: "service", capabilityId: "context-builder", outputKind: "runtime_context", preconditions: [], invariants: ["ContextPackage 以 append-only Event Manifest 留痕，不另建可编辑业务实体", "引用必须带 Release、资产版本和选择原因"], checkpointAfter: false },
  { kind: "method_selection", capabilityType: "skill", capabilityId: "research-design", outputKind: "method_application", preconditions: [], invariants: ["每个方法 ID 必须来自受治理目录", "必须包含退出条件", "方法输入门未满足时不得伪装为已执行"], checkpointAfter: false },
  { kind: "impact_analysis", capabilityType: "policy", capabilityId: "research-lead.replan", outputKind: "research_plan", preconditions: ["存在历史任务或新材料"], invariants: ["未受影响制品保持复用", "时间范围变化必须触发新鲜度检查"], checkpointAfter: true },
  { kind: "evidence_discovery", capabilityType: "tool", capabilityId: "source.discover", outputKind: "evidence_package", preconditions: ["已定义证据需求"], invariants: ["候选来源不是 EvidenceFact"], checkpointAfter: false },
  { kind: "evidence_capture", capabilityType: "action", capabilityId: "CaptureSource", outputKind: "evidence_package", preconditions: ["存在候选来源"], invariants: ["必须保存 locator、短引文、哈希和获取时间", "正式来源快照只能通过 Ontology Action 写入"], checkpointAfter: false },
  { kind: "evidence_evaluation", capabilityType: "function", capabilityId: "AssessEvidenceUsability", outputKind: "evidence_package", preconditions: ["来源已经 capture，或明确记录无可用来源"], invariants: ["Function 只读", "未经 capture 不得升级为 EvidenceFact", "不合格 Evidence 不能支持 Claim"], checkpointAfter: true },
  { kind: "hypothesis", capabilityType: "function", capabilityId: "GenerateHypothesisCandidates", outputKind: "hypothesis_map", preconditions: ["证据评估已完成"], invariants: ["候选不是正式 Hypothesis", "至少包含一个竞争解释或说明不适用"], checkpointAfter: false },
  { kind: "judgment", capabilityType: "function", capabilityId: "ComputeJudgmentProposal", outputKind: "judgment", preconditions: ["证据评估已完成"], invariants: ["Function 只生成提案", "正式 Judgment 必须通过 ApproveJudgment", "没有合格 Evidence 时 Judgment 必须降级为暂不可判断", "改判条件必须显式"], checkpointAfter: true },
  { kind: "compose", capabilityType: "skill", capabilityId: "research-delivery", outputKind: "report", preconditions: ["存在可交付的判断或证据包"], invariants: ["正式 Claim 必须绑定已验证来源"], checkpointAfter: false },
  { kind: "audit", capabilityType: "verifier", capabilityId: "citation-and-expression", outputKind: "review", preconditions: ["存在待审计 Artifact"], invariants: ["Verifier 结果与质量 Eval 分开", "审计不得静默改写主制品"], checkpointAfter: false },
] as const;

export function getResearchNodeType(kind: string): ResearchNodeType {
  const found = RESEARCH_NODE_CATALOG.find((item) => item.kind === kind);
  if (!found) throw new Error(`Research node kind is not allowed: ${kind}`);
  return found;
}
