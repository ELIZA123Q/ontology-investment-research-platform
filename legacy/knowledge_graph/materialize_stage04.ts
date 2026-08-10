import "server-only";
import { loadOntologyCatalog } from "@/skills/ontology/catalog_loader";
import { resolveDiscriminatingEvidence } from "@/agents/02_structure/structure_candidates";
import type { BusinessInstanceGraph } from "./types";

const TRACE_NODE_TARGET_TYPES = new Set(
  loadOntologyCatalog().relation_types.get("traceIncludesNode")?.target_types || [],
);

type AddObjects = (
  values: unknown,
  type: string,
  idKeys: string[],
  section: string,
  typeFromItem?: boolean,
) => void;

export function materializeStage04(
  current: BusinessInstanceGraph,
  slice: BusinessInstanceGraph,
  stageJson: Record<string, unknown>,
  addObjects: AddObjects,
) {
    for (const [index, signal] of ((stageJson.signals as any[]) || []).entries()) {
      const id = String(signal.signal_id || signal.id || `SIG-${index + 1}`);
      slice.objects.push({
        id,
        type: "Signal",
        properties: { ...signal },
        projection: { section: "signals", index },
      });
      for (const evidenceId of signal.evidence_refs || signal.evidence_draft_ids || []) {
        slice.relations.push({
          id: `REL-${id}-EVIDENCE-${evidenceId}`,
          type: "signalGroundedByFact",
          sourceId: id,
          targetId: String(evidenceId),
          properties: { role: signal.role },
        });
      }
      for (const hypothesisId of signal.target_hypothesis_ids || []) {
        slice.relations.push({
          id: `REL-${id}-HYPOTHESIS-${hypothesisId}`,
          type: "signalEvaluatesHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: {},
        });
      }
    }
    addObjects(stageJson.hypotheses, "Hypothesis", ["hypothesis_id", "id"], "hypotheses");
    for (const [index, hypothesis] of ((stageJson.hypotheses as any[]) || []).entries()) {
      const hypothesisId = String(hypothesis.hypothesis_id || hypothesis.id || `H-${index + 1}`);
      for (const unitId of hypothesis.judgment_unit_ids || []) {
        if (!unitId) continue;
        const relationId = `REL-${unitId}-HYPOTHESIS-${hypothesisId}`;
        if (slice.relations.some((item) => item.id === relationId)) continue;
        slice.relations.push({
          id: relationId,
          type: "unitHasHypothesis",
          sourceId: String(unitId),
          targetId: hypothesisId,
          properties: { role: "primary" },
        });
      }
    }
    for (const [index, explanation] of ((stageJson.competing_explanations as any[]) || []).entries()) {
      const explanationId = String(explanation.explanation_id || explanation.id || `CE-${index + 1}`);
      const statement = String(explanation.statement || "").trim();
      slice.objects.push({
        id: explanationId,
        type: "CompetingExplanation",
        properties: {
          ...explanation,
          statement,
          discriminating_evidence: resolveDiscriminatingEvidence(explanation, { statement }),
        },
        projection: { section: "competing_explanations", index },
      });
      for (const unitId of explanation.judgment_unit_ids || []) {
        if (!unitId) continue;
        slice.relations.push({
          id: `REL-${explanationId}-UNIT-${unitId}`,
          type: "competingExplanationForUnit",
          sourceId: explanationId,
          targetId: String(unitId),
          properties: { stage: "stage_04" },
        });
      }
    }
    addObjects(stageJson.rule_evaluations, "RuleEvaluation", ["rule_evaluation_id", "id"], "rule_evaluations");
    addObjects(stageJson.market_expectations, "MarketExpectation", ["id"], "market_expectations");
    addObjects(stageJson.expectation_gaps, "ExpectationGap", ["id"], "expectation_gaps");
    addObjects(stageJson.asset_impacts, "AssetImpact", ["id"], "asset_impacts");
    for (const gap of (Array.isArray(stageJson.expectation_gaps) ? stageJson.expectation_gaps as any[] : [])) {
      const gapId = String(gap.id || "");
      if (!gapId) continue;
      if (gap.judgment_ref) {
        slice.relations.push({
          id: `REL-${gapId}-JUDGMENT-${gap.judgment_ref}`,
          type: "expectationGapBasedOnJudgment",
          sourceId: gapId,
          targetId: String(gap.judgment_ref),
          properties: {},
        });
      }
      if (gap.market_expectation_ref) {
        slice.relations.push({
          id: `REL-${gapId}-EXPECTATION-${gap.market_expectation_ref}`,
          type: "expectationGapComparesExpectation",
          sourceId: gapId,
          targetId: String(gap.market_expectation_ref),
          properties: {},
        });
      }
    }
    for (const impact of (Array.isArray(stageJson.asset_impacts) ? stageJson.asset_impacts as any[] : [])) {
      const impactId = String(impact.id || "");
      if (!impactId) continue;
      for (const judgmentId of impact.source_judgment_refs || []) {
        slice.relations.push({
          id: `REL-${impactId}-JUDGMENT-${judgmentId}`,
          type: "assetImpactBasedOnJudgment",
          sourceId: impactId,
          targetId: String(judgmentId),
          properties: {},
        });
      }
    }

    for (const [index, trace] of ((stageJson.reasoning_traces as any[]) || []).entries()) {
      slice.objects.push({
        id: String(trace.trace_id || trace.id || `RT-${index + 1}`),
        type: "ReasoningTrace",
        properties: {
          ...trace,
          judgment_ref: trace.judgment_ref || trace.judgment_id,
          node_refs: trace.node_refs || trace.node_ids,
          created_at: trace.created_at,
        },
        projection: { section: "reasoning_traces", index },
      });
    }
    for (const [index, judgment] of ((stageJson.judgments as any[]) || []).entries()) {
      const id = String(judgment.judgment_id || judgment.id || `J-${index + 1}`);
      slice.objects.push({
        id,
        type: "Judgment",
        properties: {
          ...judgment,
          statement: judgment.statement || judgment.conclusion,
          level: judgment.level || judgment.strength,
          confidence: judgment.confidence,
          decision_status: judgment.decision_status,
          conflict_status: judgment.conflict_status,
          not_judgeable_reason: judgment.not_judgeable_reason,
          scope_ref: judgment.scope_ref,
          cutoff_at: judgment.cutoff_at,
          conditions: judgment.conditions || [],
          invalidation_conditions: judgment.invalidation_conditions,
        },
        projection: { section: "judgments", index },
      });
      for (const hypothesisId of judgment.hypothesis_ids || []) {
        slice.relations.push({
          id: `REL-${id}-${hypothesisId}`,
          type: "judgmentBasedOnHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: {},
        });
        if (judgment.judgment_unit_id) {
          slice.relations.push({
            id: `REL-${judgment.judgment_unit_id}-HYPOTHESIS-${hypothesisId}`,
            type: "unitHasHypothesis",
            sourceId: String(judgment.judgment_unit_id),
            targetId: String(hypothesisId),
            properties: { role: "primary" },
          });
        }
      }
      for (const ruleId of judgment.rule_evaluation_ids || []) {
        slice.relations.push({
          id: `REL-${id}-RULE-${ruleId}`,
          type: "judgmentHasRuleEvaluation",
          sourceId: id,
          targetId: String(ruleId),
          properties: {},
        });
      }
      if (judgment.judgment_unit_id) {
        slice.relations.push({
          id: `REL-${id}-UNIT-${judgment.judgment_unit_id}`,
          type: "judgmentResolvesUnit",
          sourceId: id,
          targetId: String(judgment.judgment_unit_id),
          properties: {},
        });
      }
      for (const applicationId of judgment.method_application_refs || judgment.method_application_ids || []) {
        slice.relations.push({
          id: `RUNTIME-${id}-METHOD-${applicationId}`,
          type: "runtimeJudgmentUsesMethodApplication",
          sourceId: id,
          targetId: String(applicationId),
          properties: { authority: "public_contract_1.3" },
        });
      }
    }
    for (const trace of (stageJson.reasoning_traces as any[]) || []) {
      const traceId = String(trace.trace_id || trace.id);
      const judgmentId = String(trace.judgment_ref || trace.judgment_id);
      slice.relations.push({
        id: `REL-${traceId}-JUDGMENT-${judgmentId}`,
        type: "reasoningTraceForJudgment",
        sourceId: traceId,
        targetId: judgmentId,
        properties: {},
      });
      for (const [sequence, nodeId] of ((trace.node_refs || trace.node_ids || []) as string[]).entries()) {
        const target = [...current.objects, ...slice.objects].find((object) => object.id === String(nodeId));
        if (!target || !TRACE_NODE_TARGET_TYPES.has(target.type)) continue;
        slice.relations.push({
          id: `REL-${traceId}-NODE-${sequence + 1}-${nodeId}`,
          type: "traceIncludesNode",
          sourceId: traceId,
          targetId: String(nodeId),
          properties: { sequence: sequence + 1 },
        });
      }
    }
}

