import "server-only";
import { getWorkbenchDb } from "./db";
import { formalStateVariableDisplayNames } from "../engine/ontology_display_labels";
import { buildVariableComparabilityGroups, extractVariableObservations } from "../engine/variable_comparability";

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
