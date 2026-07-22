import "server-only";
import { getRun, getWorkbenchDb } from "./db";
import { loadGraphForRun } from "../engine/instance_graph";
import { ontologyTypeLabel, formalStateVariableDisplayNames } from "../engine/ontology_display_labels";
import { queryEvidenceImpact } from "../engine/ontology_research_query";
import { aggregateTaskLocalCandidates, extractTaskLocalCandidateOccurrences } from "../engine/ontology_candidates";
import { extractVariableObservations } from "../engine/variable_comparability";

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
