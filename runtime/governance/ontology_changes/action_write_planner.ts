import { createHash } from "node:crypto";
import type { ActionTypeDef } from "./action_registry";
import type { BusinessInstanceGraph, GraphObject, GraphRelation } from "../../skills/ontology/instance_graph";
import { loadOntologyCatalog } from "../../skills/ontology/catalog_loader";

const TRACE_NODE_TYPES = new Set(
  loadOntologyCatalog().relation_types.get("traceIncludesNode")?.target_types || [],
);

export function planWrites(
  action: ActionTypeDef,
  parameters: Record<string, unknown>,
  functionResult: Record<string, unknown>,
  graph: BusinessInstanceGraph,
): { objects: GraphObject[]; relations: GraphRelation[] } {
  if (action.id === "RegisterSource") {
    const sourceId = String(parameters.sourceId || `SD-${hashShort(String(parameters.locator || parameters.url || parameters.title))}`);
    const object: GraphObject = {
      id: sourceId,
      type: "SourceDocument",
      properties: {
        title: String(parameters.title),
        source_tier: String(parameters.sourceTier || "unknown"),
        uri: String(parameters.url || parameters.locator || ""),
        publisher: String(parameters.publisher || ""),
        published_at: String(parameters.publishedAt),
        captured_at: parameters.capturedAt || new Date().toISOString(),
        locator: String(parameters.locator || parameters.url || ""),
        content_hash: String(parameters.contentHash),
        source_group: String(parameters.sourceGroup || parameters.publisher || ""),
        retrieval_status: String(parameters.retrievalStatus),
        usability_status: String(parameters.usabilityStatus),
        source_quote: String(parameters.sourceQuote || ""),
        quote_verified: parameters.quoteVerified === true,
        reliability: functionResult.reliability || "unassessed",
        reliability_basis: functionResult.reliabilityBasis || {},
      },
      projection: { section: "sources", index: graph.objects.filter((o) => o.type === "SourceDocument").length },
    };
    const relations: GraphRelation[] = [];
    const profileId = parameters.sourceProfileId ? String(parameters.sourceProfileId) : "";
    if (profileId && graph.objects.some((o) => o.id === profileId)) {
      relations.push({ id: `REL-${sourceId}-profile`, type: "sourceDocumentUsesProfile", sourceId, targetId: profileId, properties: {} });
    }
    const publisherRef = parameters.publisherRef ? String(parameters.publisherRef) : "";
    if (publisherRef && graph.objects.some((o) => o.id === publisherRef)) {
      relations.push({ id: `REL-${sourceId}-publisher`, type: "sourcePublishedBy", sourceId, targetId: publisherRef, properties: {} });
    }
    return { objects: [object], relations };
  }

  if (action.id === "ExtractClaim") {
    const sourceRef = String(parameters.sourceRef);
    const claimId = String(parameters.claimId || `CL-${hashShort(`${sourceRef}:${parameters.locator || parameters.contentRange || parameters.statement || Date.now()}`)}`);
    const statement = String(parameters.statement || (functionResult as any).claimCandidates?.[0] || parameters.contentRange || "未命名主张");
    return {
      objects: [{
        id: claimId,
        type: "EvidenceClaim",
        properties: {
          claim_id: claimId,
          statement,
          locator: String(parameters.locator || ""),
          extracted_at: String(parameters.extractedAt || new Date().toISOString()),
          cutoff_at: String(parameters.cutoffAt || parameters.extractedAt || new Date().toISOString()),
        },
        projection: { section: "evidence_claims", index: graph.objects.filter((o) => o.type === "EvidenceClaim").length },
      }],
      relations: [{ id: `REL-${claimId}-${sourceRef}`, type: "claimCitesSource", sourceId: claimId, targetId: sourceRef, properties: {} }],
    };
  }

  if (action.id === "NormalizeClaim") {
    const claimRef = String(parameters.claimRef);
    const existing = graph.objects.find((object) => object.id === claimRef)!;
    const semanticRefs = asStringArray(parameters.semanticRefs).filter((ref) => graph.objects.some((o) => o.id === ref));
    return {
      objects: [{
        ...existing,
        properties: {
          ...(existing.properties || {}),
          normalized: true,
          semantic_refs: asStringArray(parameters.semanticRefs),
          unit: String(parameters.unit || ""),
          business_time: String(parameters.businessTime || ""),
          normalization: functionResult.normalizedClaim || functionResult,
        },
      }],
      relations: semanticRefs.map((ref) => ({ id: `REL-${claimRef}-${ref}`, type: "claimAbout", sourceId: claimRef, targetId: ref, properties: {} })),
    };
  }

  if (action.id === "AssessEvidenceForUse") {
    const evidenceRefs = asStringArray(parameters.evidenceRefs);
    const assessmentId = String(parameters.assessmentId || `EA-${hashShort(evidenceRefs.join("|"))}`);
    const object: GraphObject = {
      id: assessmentId,
      type: "EvidenceAssessment",
      properties: {
        assessment: functionResult.usability === "usable" ? "usable"
          : functionResult.usability === "partial" ? "usable_with_caveat" : "unusable",
        directness: String(parameters.directness),
        limitations: asStringArray(parameters.limitations),
      },
      projection: { section: "evidence_assessments", index: graph.objects.filter((o) => o.type === "EvidenceAssessment").length },
    };
    return {
      objects: [object],
      relations: evidenceRefs.map((evidenceId, index) => ({
        id: `REL-${assessmentId}-${evidenceId}`,
        type: "assessmentEvaluatesFact",
        sourceId: assessmentId,
        targetId: evidenceId,
          properties: { index },
      })),
    };
  }

  if (action.id === "FormHypothesis") {
    const hypothesisId = String(parameters.hypothesisId || `HYP-${hashShort(String(parameters.statement))}`);
    const variableRef = String(parameters.variableRef || "");
    const judgmentUnitRef = String(parameters.judgmentUnitRef || "");
    const object: GraphObject = {
      id: hypothesisId,
      type: "Hypothesis",
      properties: {
        statement: String(parameters.statement),
        time_horizon: String(parameters.timeHorizon || ""),
        falsification_conditions: asStringArray(parameters.falsificationConditions),
        variable_ref: variableRef,
        direction: String(parameters.direction || "unknown"),
      },
      projection: { section: "hypotheses", index: graph.objects.filter((o) => o.type === "Hypothesis").length },
    };
    return { objects: [object], relations: [{
      id: `REL-${judgmentUnitRef}-${hypothesisId}`,
      type: "unitHasHypothesis",
      sourceId: judgmentUnitRef,
      targetId: hypothesisId,
      properties: { role: String(parameters.hypothesisRole || "primary") },
    }] };
  }

  if (action.id === "FormJudgment") {
    const judgmentId = String(parameters.judgmentId || `J-${hashShort(String(parameters.statement))}`);
    const hypothesisRefs = asStringArray(parameters.hypothesisRefs);
    const methodApplicationRefs = asStringArray(parameters.methodApplicationRefs);
    const ruleEvaluationRefs = asStringArray(parameters.ruleEvaluationRefs);
    const judgmentUnitRef = String(parameters.judgmentUnitRef || "");
    const object: GraphObject = {
      id: judgmentId,
      type: "Judgment",
      properties: {
        statement: String(parameters.statement),
        level: String(parameters.judgmentLevel),
        confidence: functionResult.confidence || "low",
        decision_status: String(parameters.decisionStatus || "supported"),
        conflict_status: String(parameters.conflictStatus || "none"),
        not_judgeable_reason: parameters.notJudgeableReason ? String(parameters.notJudgeableReason) : null,
        scope_ref: String(parameters.scopeRef),
        cutoff_at: String(parameters.cutoffAt),
        conditions: asStringArray(parameters.conditions),
        invalidation_conditions: asStringArray(parameters.invalidationConditions),
        confidence_basis: functionResult.confidenceBasis || {},
      },
      projection: { section: "judgments", index: graph.objects.filter((o) => o.type === "Judgment").length },
    };
    const relations: GraphRelation[] = [];
    for (const ref of hypothesisRefs) {
      if (!graph.objects.some((object) => object.id === ref)) continue;
      relations.push({ id: `REL-${judgmentId}-${ref}`, type: "judgmentBasedOnHypothesis", sourceId: judgmentId, targetId: ref, properties: {} });
    }
    for (const ref of methodApplicationRefs) {
      relations.push({
        id: `RUNTIME-${judgmentId}-${ref}`,
        type: "runtimeJudgmentUsesMethodApplication",
        sourceId: judgmentId,
        targetId: ref,
        properties: { authority: "public_contract_1.3" },
      });
    }
    for (const ref of ruleEvaluationRefs) {
      relations.push({ id: `REL-${judgmentId}-${ref}`, type: "judgmentHasRuleEvaluation", sourceId: judgmentId, targetId: ref, properties: {} });
    }
    relations.push({ id: `REL-${judgmentId}-${judgmentUnitRef}`, type: "judgmentResolvesUnit", sourceId: judgmentId, targetId: judgmentUnitRef, properties: {} });
    return { objects: [object], relations };
  }

  if (action.id === "RecordReasoningTrace") {
    const judgmentRef = String(parameters.judgmentRef);
    const traceId = String(parameters.traceId || `RT-${hashShort(`${judgmentRef}:${Date.now()}`)}`);
    const nodeRefs = [...new Set([
      ...asStringArray(parameters.inputRefs),
      ...asStringArray(parameters.methodApplicationRefs),
      judgmentRef,
    ])];
    const relationNodeRefs = nodeRefs.filter((ref) => {
      const target = graph.objects.find((object) => object.id === ref);
      return target && TRACE_NODE_TYPES.has(target.type);
    });
    return {
      objects: [{
        id: traceId,
        type: "ReasoningTrace",
        properties: {
          judgment_ref: judgmentRef,
          node_refs: nodeRefs,
          method_application_refs: asStringArray(parameters.methodApplicationRefs),
          created_at: String(parameters.evaluatedAt || new Date().toISOString()),
        },
        projection: { section: "reasoning_traces", index: graph.objects.filter((o) => o.type === "ReasoningTrace").length },
      }],
      relations: [
        { id: `REL-${traceId}-${judgmentRef}`, type: "reasoningTraceForJudgment", sourceId: traceId, targetId: judgmentRef, properties: {} },
        ...relationNodeRefs.map((ref, index) => ({
          id: `REL-${traceId}-${ref}`,
          type: "traceIncludesNode",
          sourceId: traceId,
          targetId: ref,
          properties: { sequence: index + 1 },
        })),
      ],
    };
  }

  if (action.id === "LinkOntologyObjects") {
    const sourceId = String(parameters.sourceId);
    const relationType = String(parameters.relationType);
    const targetId = String(parameters.targetId);
    return {
      objects: [],
      relations: [{
        id: String(parameters.relationId || `REL-${hashShort(`${sourceId}:${relationType}:${targetId}`)}`),
        type: relationType,
        sourceId,
        targetId,
        properties: parameters.properties && typeof parameters.properties === "object"
          ? { ...(parameters.properties as Record<string, unknown>) }
          : {},
      }],
    };
  }

  return { objects: [], relations: [] };
}

export function assertWriteScope(action: ActionTypeDef, objects: GraphObject[], relations: GraphRelation[]) {
  const scope = new Set(action.write_scope);
  for (const object of objects) {
    if (!scope.has(object.type)) throw new Error(`对象类型 ${object.type} 超出 write_scope`);
  }
  for (const relation of relations) {
    if (action.id === "LinkOntologyObjects") {
      if (!loadOntologyCatalog().relation_types.has(relation.type)) {
        throw new Error(`关系类型 ${relation.type} 不属于正式本体`);
      }
      continue;
    }
    if (!scope.has(relation.type)) throw new Error(`关系类型 ${relation.type} 超出 write_scope`);
  }
}

export function markActionProjection(writes: { objects: GraphObject[]; relations: GraphRelation[] }) {
  return {
    objects: writes.objects.map((object) => ({
      ...object,
      properties: { ...(object.properties || {}) },
      projection: {
        ...(object.projection || {}),
        origin: "action",
      },
    })),
    relations: writes.relations.map((relation) => ({
      ...relation,
      properties: {
        ...(relation.properties || {}),
        projection_origin: "action",
      },
    })),
  };
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value)
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

