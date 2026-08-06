import "server-only";
import { getRun, getWorkbenchDb } from "../../storage/db";
import { loadGraphForRun } from "./instance_graph";
import { ontologyTypeLabel, formalStateVariableDisplayNames } from "./display_labels";
import { queryEvidenceImpact } from "./research_query";
import { aggregateTaskLocalCandidates, extractTaskLocalCandidateOccurrences } from "../../governance/ontology_changes/candidates";
import { extractVariableObservations } from "./variable_comparability";

function latestStructureRows() {
  return getWorkbenchDb().prepare(`
    SELECT a.run_id, a.id AS artifact_id, a.version AS artifact_version, a.json_content, a.created_at,
           r.question, r.domain
    FROM artifacts a
    JOIN research_runs r ON r.id=a.run_id
    WHERE a.kind='stage_02'
      AND a.status IN ('approved','needs_review')
      AND r.current_stage > 0
      AND a.version=(
        SELECT MAX(a2.version) FROM artifacts a2
        WHERE a2.run_id=a.run_id AND a2.kind='stage_02' AND a2.status IN ('approved','needs_review')
      )
  `).all() as any[];
}

export function listEvidenceImpactQueries(runId: string) {
  const run = getRun(runId);
  if (!run) return [];
  const graph = loadGraphForRun(runId, run.package_path).graph;
  return graph.objects
    .filter((object) => object.type === "EvidenceFact")
    .map((object) => queryEvidenceImpact(graph, object.id))
    .map((result) => ({
      ...result,
      impacted_judgments: result.impacted_judgments.map((judgment) => ({
        ...judgment,
        path_labels: judgment.path.map((step) => ontologyTypeLabel(step.relation_type)),
      })),
    }));
}

export type EvidenceRequirementQuery = {
  id: string;
  label: string;
  role: string;
  fulfillment: "met" | "partial" | "unmet";
  blocking: boolean;
  affected_judgments: Array<{ id: string; label: string; strength: string }>;
};

/** 正式 ER→JU→Judgment 投影；只沿显式关系，不按文本猜绑定。 */
export function listEvidenceRequirementQueries(runId: string): EvidenceRequirementQuery[] {
  const run = getRun(runId);
  if (!run) return [];
  const graph = loadGraphForRun(runId, run.package_path).graph;
  const objects = new Map(graph.objects.map((object) => [object.id, object]));
  const judgmentsByUnit = new Map<string, Array<{ id: string; label: string; strength: string }>>();
  for (const relation of graph.relations.filter((item) => item.type === "judgmentResolvesUnit")) {
    const judgment = objects.get(relation.sourceId);
    if (!judgment || judgment.type !== "Judgment") continue;
    const current = judgmentsByUnit.get(relation.targetId) || [];
    current.push({
      id: judgment.id,
      label: String(judgment.properties?.conclusion || judgment.properties?.statement || judgment.id),
      strength: String(judgment.properties?.strength || judgment.properties?.level || "J0"),
    });
    judgmentsByUnit.set(relation.targetId, current);
  }
  return graph.objects.filter((object) => object.type === "EvidenceRequirement").map((requirement) => {
    const unitIds = graph.relations
      .filter((relation) => relation.type === "requirementForJudgmentUnit" && relation.sourceId === requirement.id)
      .map((relation) => relation.targetId);
    const fulfillmentValues = graph.relations
      .filter((relation) => relation.type === "basketFulfillsRequirement" && relation.targetId === requirement.id)
      .map((relation) => String(relation.properties?.fulfillment || "unmet"));
    const fulfillment = fulfillmentValues.includes("met") ? "met" as const
      : fulfillmentValues.includes("partially_met") ? "partial" as const
        : "unmet" as const;
    const blocking = graph.objects.some((object) => object.type === "BlockingFactor"
      && Array.isArray(object.properties?.evidence_requirement_ids)
      && object.properties!.evidence_requirement_ids.map(String).includes(requirement.id));
    const affected = new Map<string, { id: string; label: string; strength: string }>();
    for (const unitId of unitIds) for (const judgment of judgmentsByUnit.get(unitId) || []) affected.set(judgment.id, judgment);
    return {
      id: requirement.id,
      label: String(requirement.properties?.requirement || requirement.properties?.statement || requirement.id),
      role: String(requirement.properties?.evidence_role || "support"),
      fulfillment,
      blocking,
      affected_judgments: [...affected.values()],
    };
  }).sort((left, right) => right.affected_judgments.length - left.affected_judgments.length
    || Number(right.blocking) - Number(left.blocking)
    || left.id.localeCompare(right.id));
}

export function listVariableUsageQueries() {
  const rows = latestStructureRows();
  const formalNames = formalStateVariableDisplayNames();
  const formalGroups = new Map<string, ReturnType<typeof extractVariableObservations>>();
  for (const observation of extractVariableObservations(rows)) {
    const group = formalGroups.get(observation.ontology_node_id) || [];
    group.push(observation);
    formalGroups.set(observation.ontology_node_id, group);
  }
  const formal = [...formalGroups.entries()].map(([semanticRef, observations]) => ({
    semantic_ref: semanticRef,
    label: formalNames.get(semanticRef) || semanticRef,
    source: "formal" as const,
    run_count: new Set(observations.map((item) => item.run_id)).size,
    occurrence_count: observations.length,
    occurrences: observations.map((item) => ({
      run_id: item.run_id,
      question: item.question,
      variable_id: item.variable_id,
      name: item.name,
    })),
  }));
  const localOccurrences = extractTaskLocalCandidateOccurrences(rows);
  const localOccurrencesByKey = new Map<string, typeof localOccurrences>();
  for (const occurrence of localOccurrences) {
    const group = localOccurrencesByKey.get(occurrence.candidate_key) || [];
    group.push(occurrence);
    localOccurrencesByKey.set(occurrence.candidate_key, group);
  }
  const local = aggregateTaskLocalCandidates(localOccurrences).map((candidate) => ({
    semantic_ref: candidate.candidate_key,
    label: candidate.name,
    source: "task_local" as const,
    run_count: candidate.run_count,
    occurrence_count: candidate.occurrence_count,
    occurrences: (localOccurrencesByKey.get(candidate.candidate_key) || []).map((occurrence) => ({
      run_id: occurrence.run_id,
      question: occurrence.question,
      variable_id: occurrence.variable_id,
      name: occurrence.name,
    })),
  }));
  return [...formal, ...local].sort((left, right) => right.run_count - left.run_count
    || right.occurrence_count - left.occurrence_count
    || left.label.localeCompare(right.label, "zh-CN"));
}
