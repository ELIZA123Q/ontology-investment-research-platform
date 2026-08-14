import type { Artifact, EvidenceFact, SignalRole, Task, TaskNode } from "@/src/contracts";
import type { ModelProvider } from "@/src/providers/model-provider";
import { ModelGateway } from "@/src/providers/model-gateway";
import type { RuntimeStore } from "@/src/runtime/store";
import { deriveModelDataPolicy } from "@/src/providers/model-data-policy";
import { BOUNDED_MODEL_REASONING_PROTOCOL } from "@/src/research/generated/bounded-model-reasoning-protocol";

export interface BoundedResearchReasoning {
  evidenceAssignments: Array<{ evidenceFactId: string; role: SignalRole; rationale: string }>;
  hypotheses: Array<{ statement: string; evidenceFactIds: string[]; falsificationConditions: string[]; distinguishingSignals: string[] }>;
  judgment: null | { statement: string; confidence: "low" | "medium" | "high"; evidenceFactIds: string[]; changeConditions: string[]; reasoningSummary: string };
  reviewFindings: Array<{ severity: "critical" | "major" | "minor"; description: string; artifactRefs: string[] }>;
}

export interface ModelReasoningAttempt {
  attempted: boolean;
  cached: boolean;
  data?: BoundedResearchReasoning;
  provider?: string;
  model?: string;
  fingerprint?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  errors?: string[];
}

const schema = {
  type: "object", required: ["evidenceAssignments", "hypotheses", "judgment", "reviewFindings"], properties: {
    evidenceAssignments: { type: "array", items: { type: "object", required: ["evidenceFactId", "role", "rationale"], properties: { evidenceFactId: { type: "string" }, role: { enum: ["support", "weaken", "block", "context"] }, rationale: { type: "string" } } } },
    hypotheses: { type: "array", items: { type: "object", required: ["statement", "evidenceFactIds", "falsificationConditions", "distinguishingSignals"], properties: { statement: { type: "string" }, evidenceFactIds: { type: "array", items: { type: "string" } }, falsificationConditions: { type: "array", items: { type: "string" } }, distinguishingSignals: { type: "array", items: { type: "string" } } } } },
    judgment: { anyOf: [{ type: "null" }, { type: "object", required: ["statement", "confidence", "evidenceFactIds", "changeConditions", "reasoningSummary"], properties: { statement: { type: "string" }, confidence: { enum: ["low", "medium", "high"] }, evidenceFactIds: { type: "array", items: { type: "string" } }, changeConditions: { type: "array", items: { type: "string" } }, reasoningSummary: { type: "string" } } }] },
    reviewFindings: { type: "array", items: { type: "object", required: ["severity", "description", "artifactRefs"], properties: { severity: { enum: ["critical", "major", "minor"] }, description: { type: "string" }, artifactRefs: { type: "array", items: { type: "string" } } } } },
  },
} as const;

const numericTokens = (text: string) => new Set(text.match(/\d+(?:\.\d+)?%?/g) || []);
const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
const protocol = BOUNDED_MODEL_REASONING_PROTOCOL;

function validate(raw: unknown, task: Task, facts: EvidenceFact[], artifacts: Artifact[]): { data?: BoundedResearchReasoning; errors: string[] } {
  if (!raw || typeof raw !== "object") return { errors: ["Model reasoning output must be an object"] };
  const item = raw as Record<string, unknown>;
  const errors: string[] = [];
  const factIds = new Set(facts.map((fact) => fact.id));
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const allowedNumbers = numericTokens(JSON.stringify({ goal: task.goal, facts: facts.map((fact) => fact.statement) }));
  const assertText = (text: string, field: string) => {
    if (protocol.deterministic_output_screen.prohibited_investment_terms.some((term) => text.includes(term))) errors.push(`${field} contains a prohibited investment recommendation`);
    for (const token of numericTokens(text)) if (!allowedNumbers.has(token)) errors.push(`${field} introduces unsupported numeric token ${token}`);
  };
  const evidenceAssignments = (Array.isArray(item.evidenceAssignments) ? item.evidenceAssignments : []).flatMap((rawAssignment) => {
    if (!rawAssignment || typeof rawAssignment !== "object") return [];
    const assignment = rawAssignment as Record<string, unknown>;
    const evidenceFactId = String(assignment.evidenceFactId || "");
    const role = String(assignment.role || "") as SignalRole;
    const rationale = String(assignment.rationale || "").trim();
    if (!factIds.has(evidenceFactId)) errors.push(`evidence assignment references unauthorized fact ${evidenceFactId}`);
    if (!["support", "weaken", "block", "context"].includes(role)) errors.push(`evidence assignment has invalid role ${role}`);
    assertText(rationale, "evidence rationale");
    return evidenceFactId && rationale ? [{ evidenceFactId, role, rationale }] : [];
  });
  const hypotheses = (Array.isArray(item.hypotheses) ? item.hypotheses : []).slice(0, 5).flatMap((rawHypothesis) => {
    if (!rawHypothesis || typeof rawHypothesis !== "object") return [];
    const hypothesis = rawHypothesis as Record<string, unknown>;
    const statement = String(hypothesis.statement || "").trim();
    const evidenceFactIds = textList(hypothesis.evidenceFactIds);
    const falsificationConditions = textList(hypothesis.falsificationConditions);
    const distinguishingSignals = textList(hypothesis.distinguishingSignals);
    if (evidenceFactIds.some((id) => !factIds.has(id))) errors.push("hypothesis references unauthorized EvidenceFact");
    if (!falsificationConditions.length) errors.push("hypothesis requires falsification conditions");
    assertText([statement, ...falsificationConditions, ...distinguishingSignals].join("\n"), "hypothesis");
    return statement ? [{ statement, evidenceFactIds, falsificationConditions, distinguishingSignals }] : [];
  });
  let judgment: BoundedResearchReasoning["judgment"] = null;
  if (item.judgment && typeof item.judgment === "object") {
    const rawJudgment = item.judgment as Record<string, unknown>;
    const statement = String(rawJudgment.statement || "").trim();
    const confidence = String(rawJudgment.confidence || "low") as "low" | "medium" | "high";
    const evidenceFactIds = textList(rawJudgment.evidenceFactIds);
    const changeConditions = textList(rawJudgment.changeConditions);
    const reasoningSummary = String(rawJudgment.reasoningSummary || "").trim();
    if (evidenceFactIds.some((id) => !factIds.has(id))) errors.push("judgment references unauthorized EvidenceFact");
    if (!changeConditions.length) errors.push("judgment requires change conditions");
    if (!["low", "medium", "high"].includes(confidence)) errors.push("judgment confidence is invalid");
    assertText([statement, reasoningSummary, ...changeConditions].join("\n"), "judgment");
    if (statement) judgment = { statement, confidence, evidenceFactIds, changeConditions, reasoningSummary };
  }
  const reviewFindings = (Array.isArray(item.reviewFindings) ? item.reviewFindings : []).slice(0, 12).flatMap((rawFinding) => {
    if (!rawFinding || typeof rawFinding !== "object") return [];
    const finding = rawFinding as Record<string, unknown>;
    const severity = String(finding.severity || "minor") as "critical" | "major" | "minor";
    const description = String(finding.description || "").trim();
    const artifactRefs = textList(finding.artifactRefs);
    if (artifactRefs.some((id) => !artifactIds.has(id))) errors.push("review references an unauthorized artifact");
    if (!["critical", "major", "minor"].includes(severity)) errors.push("review severity is invalid");
    assertText(description, "review finding");
    return description ? [{ severity, description, artifactRefs }] : [];
  });
  return errors.length ? { errors: [...new Set(errors)] } : { data: { evidenceAssignments, hypotheses, judgment, reviewFindings }, errors: [] };
}

export async function requestBoundedResearchReasoning(store: RuntimeStore, provider: ModelProvider | null, input: { task: Task; node: TaskNode; facts: EvidenceFact[]; artifacts: Artifact[] }): Promise<ModelReasoningAttempt> {
  if (!provider) return { attempted: false, cached: false, errors: ["No configured model provider"] };
  if (input.node.kind !== "independent_review" && !input.facts.length) return { attempted: false, cached: false, errors: ["No verified EvidenceFact is available for model reasoning"] };
  const promptInput = {
    target: input.node.kind, researchGoal: input.task.goal,
    evidenceFacts: input.facts.map((fact) => ({ id: fact.id, statement: fact.statement, factType: fact.factType, businessTime: fact.businessTime, existingEvidenceRoles: fact.evidenceRoles || [] })),
    authorizedArtifacts: input.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, title: artifact.title, status: artifact.status, data: artifact.data })),
    hardRules: protocol.hard_rules,
    targetInstruction: protocol.target_instructions[input.node.kind as keyof typeof protocol.target_instructions],
  };
  const sourceRefs = input.artifacts.flatMap((artifact) => artifact.sourceRefs);
  const dataPolicy = deriveModelDataPolicy(sourceRefs, input.facts.map((fact) => fact.snapshotId));
  try {
    const result = await new ModelGateway(store, provider).generate({
      operation: `research_reasoning:${input.node.kind}`,
      promptVersion: protocol.runtime_projection.prompt_version,
      schemaVersion: protocol.runtime_projection.schema_version,
      schemaName: "bounded_research_reasoning",
      system: protocol.runtime_projection.system_instruction,
      prompt: JSON.stringify(promptInput), responseSchema: schema as unknown as Record<string, unknown>, maxOutputTokens: protocol.runtime_projection.max_output_tokens,
      dataPolicy,
      validateResponse: (value) => {
        const checked = validate(value, input.task, input.facts, input.artifacts);
        if (checked.errors.length) throw new Error(checked.errors.join("; "));
      },
    });
    const parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    const checked = validate(parsed, input.task, input.facts, input.artifacts);
    return checked.data ? { attempted: true, cached: result.cached, data: checked.data, provider: result.provider, model: result.model, fingerprint: result.fingerprint, usage: result.usage }
      : { attempted: true, cached: result.cached, provider: result.provider, model: result.model, fingerprint: result.fingerprint, usage: result.usage, errors: checked.errors };
  } catch (error) {
    return { attempted: true, cached: false, provider: provider.id, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
