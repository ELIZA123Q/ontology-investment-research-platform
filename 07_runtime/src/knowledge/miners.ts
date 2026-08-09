import { createHash } from "node:crypto";
import type {
  Artifact,
  KnowledgeMiner,
  KnowledgeMinerOutput,
  KnowledgeMiningContext,
  TemporalFact,
} from "@/src/contracts";

const normalize = (value: unknown) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
const identity = (...parts: unknown[]) => createHash("sha256").update(parts.map(normalize).join("|")).digest("hex").slice(0, 24);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const provenance = (artifact: Artifact) => [`artifact:${artifact.id}@${artifact.version}`];

export const TemporalFactMiner: KnowledgeMiner = {
  id: "temporal-fact-miner",
  version: "1.0.0",
  mine(context) {
    const outputs: KnowledgeMinerOutput[] = [];
    for (const artifact of context.artifacts.filter((item) => item.kind === "evidence_package")) {
      const data = object(artifact.data);
      const verifiedSources = new Map(artifact.sourceRefs.filter((source) => source.verification === "verified").map((source) => [source.sourceId, source]));
      for (const raw of list(data.facts)) {
        const fact = object(raw);
        const sourceRefs = list(fact.sourceRefs || fact.source_ids).map(String).filter((ref) => verifiedSources.has(ref));
        if (!sourceRefs.length) continue;
        const subjectRef = String(fact.subjectRef || fact.subject || fact.entity || "").trim();
        const predicate = String(fact.predicate || fact.metric || fact.name || "").trim();
        if (!subjectRef || !predicate || !("value" in fact)) continue;
        const temporalFact: TemporalFact = {
          subjectRef,
          predicate,
          value: fact.value,
          validFrom: typeof fact.validFrom === "string" ? fact.validFrom : undefined,
          validTo: typeof fact.validTo === "string" ? fact.validTo : undefined,
          recordedAt: artifact.createdAt,
          sourceRefs,
          applicabilityScope: String(fact.applicabilityScope || fact.applicability_scope || "").trim(),
          supersedes: list(fact.supersedes).map(String),
          confidence: Number(fact.confidence ?? 0.8),
        };
        const identityKey = `fact:${identity(subjectRef, predicate)}`;
        outputs.push({
          assetKind: "temporal_fact", identityKey,
          content: {
            identityKey, ...temporalFact,
            sourceQualifications: sourceRefs.map((sourceId) => {
              const source = verifiedSources.get(sourceId)!;
              return { sourceId, sourceType: source.sourceType || "unknown", publisherId: source.publisherId || source.uri };
            }),
          },
          provenanceRefs: provenance(artifact), confidence: temporalFact.confidence,
          riskLevel: 2, validFrom: temporalFact.validFrom, validTo: temporalFact.validTo,
        });
      }
    }
    return outputs;
  },
};

export const SemanticAssetMiner: KnowledgeMiner = {
  id: "semantic-asset-miner",
  version: "1.0.0",
  mine(context) {
    const outputs: KnowledgeMinerOutput[] = [];
    for (const artifact of context.artifacts.filter((item) => item.kind === "research_plan" || item.kind === "hypothesis_map")) {
      const data = object(artifact.data);
      for (const raw of list(data.variables || data.semanticCandidates || data.ontologyCandidates)) {
        const candidate = object(raw);
        const nodeId = String(candidate.ontology_node_id || candidate.ontologyNodeId || "");
        if (!nodeId.startsWith("task_local:") && candidate.authority !== "task_local") continue;
        const name = String(candidate.name || candidate.label || nodeId.slice("task_local:".length)).trim();
        if (!name) continue;
        const identityKey = `ontology:${identity(name, candidate.category, candidate.variable_kind)}`;
        outputs.push({
          assetKind: "ontology", identityKey,
          content: { identityKey, name, category: candidate.category || "unknown", variableKind: candidate.variable_kind || "unknown", definition: candidate.definition || "", sourceNodeId: nodeId },
          provenanceRefs: provenance(artifact), confidence: 0.65, riskLevel: 3,
        });
      }
    }
    return outputs;
  },
};

export const CapabilityMiner: KnowledgeMiner = {
  id: "capability-miner",
  version: "1.0.0",
  mine(context) {
    const outputs: KnowledgeMinerOutput[] = [];
    for (const artifact of context.artifacts.filter((item) => item.kind === "research_plan")) {
      const data = object(artifact.data);
      const method = String(data.method || "").trim();
      if (!method) continue;
      const identityKey = `method:${identity(method)}`;
      outputs.push({
        assetKind: "method", identityKey,
        content: {
          identityKey, name: method, exitCondition: data.exitCondition || "",
          taskFamily: context.task.intent, evaluationScoreDelta: Number(data.evaluationScoreDelta || 0),
        },
        provenanceRefs: provenance(artifact), confidence: 0.7, riskLevel: 2,
      });
    }
    return outputs;
  },
};

function failureReason(context: KnowledgeMiningContext): { reason: string; artifact?: Artifact } | null {
  if (context.task.status === "failed" || context.task.status === "cancelled") return { reason: `task_${context.task.status}` };
  for (const artifact of context.artifacts) {
    const data = object(artifact.data);
    if (artifact.kind === "review" && data.passed === false) return { reason: String(list(data.errors)[0] || "deterministic_review_failed"), artifact };
    if (artifact.kind === "evidence_package" && data.sufficient === false && data.stopReason) return { reason: String(data.stopReason), artifact };
  }
  return null;
}

export const EvaluationMiner: KnowledgeMiner = {
  id: "evaluation-miner",
  version: "1.0.0",
  mine(context) {
    const failure = failureReason(context);
    if (!failure) return [];
    const refs = failure.artifact ? provenance(failure.artifact) : [`task:${context.task.id}`];
    const failureKey = `failure:${identity(failure.reason, context.task.intent)}`;
    const evalKey = `eval:${identity(failure.reason, context.task.intent)}`;
    return [
      {
        assetKind: "failure_pattern", identityKey: failureKey,
        content: { identityKey: failureKey, reason: failure.reason, taskFamily: context.task.intent, sourceTaskId: context.task.id },
        provenanceRefs: refs, confidence: 0.9, riskLevel: 2,
      },
      {
        assetKind: "eval_case", identityKey: evalKey,
        content: {
          identityKey: evalKey, name: `回归：${failure.reason.slice(0, 80)}`,
          sourceTaskId: context.task.id, goal: context.task.goal,
          expectedOutcome: context.task.status === "failed" ? "no_unhandled_failure" : "preserve_correct_abstention",
          deidentified: context.conversation.tenantId === "default", replayable: true,
        },
        provenanceRefs: refs, confidence: 0.85, riskLevel: 2,
      },
    ];
  },
};

export const MemoryMiner: KnowledgeMiner = {
  id: "memory-miner",
  version: "1.0.0",
  mine(context) {
    const label = context.task.goal.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!label) return [];
    const identityKey = `topic:${identity(label)}`;
    return [{
      assetKind: "topic_index", identityKey,
      content: { identityKey, label, intent: context.task.intent, lastTaskId: context.task.id, lastObservedAt: new Date().toISOString() },
      provenanceRefs: [`task:${context.task.id}`], confidence: 1, riskLevel: 1,
    }];
  },
};

export const DEFAULT_KNOWLEDGE_MINERS: readonly KnowledgeMiner[] = [
  TemporalFactMiner,
  SemanticAssetMiner,
  CapabilityMiner,
  EvaluationMiner,
  MemoryMiner,
] as const;
