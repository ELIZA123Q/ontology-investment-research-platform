import "server-only";
import { getWorkbenchDb } from "../../storage/db";
import { formalStateVariableDisplayNames } from "./display_labels";
import { buildVariableComparabilityGroups, extractVariableObservations } from "./variable_comparability_engine";

export function listCrossRunVariableComparability() {
  const rows = getWorkbenchDb().prepare(`
    SELECT a.run_id, a.id AS artifact_id, a.version AS artifact_version, a.json_content, a.created_at,
           r.question
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
  const names = formalStateVariableDisplayNames();
  return buildVariableComparabilityGroups(extractVariableObservations(rows)).map((group) => ({
    ...group,
    ontology_label: names.get(group.ontology_node_id) || group.ontology_node_id,
  }));
}

// Re-export from engine version for backward compatibility
export { buildVariableComparabilityGroups, extractVariableObservations, compareVariableObservations, VARIABLE_COMPARABILITY_KEY_VERSION } from "./variable_comparability_engine";
export type { VariableObservation } from "./variable_comparability_engine";
