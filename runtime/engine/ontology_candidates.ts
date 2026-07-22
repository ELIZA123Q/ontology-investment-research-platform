import { createHash } from "node:crypto";

export type OntologyCandidateStatus = "pending" | "expert_confirmed" | "promoted" | "rejected";

export type TaskLocalCandidateOccurrence = {
  candidate_key: string;
  run_id: string;
  artifact_id: string;
  artifact_version: number;
  question: string;
  domain: string;
  variable_id: string;
  name: string;
  category: string;
  variable_kind: string;
  definition: string;
  ontology_node_id: string;
  observed_at: string;
};

export type TaskLocalCandidateSummary = {
  candidate_key: string;
  name: string;
  category: string;
  variable_kind: string;
  occurrence_count: number;
  run_count: number;
  cross_task_reused: boolean;
  run_ids: string[];
  questions: string[];
  domains: string[];
  variable_ids: string[];
  definitions: string[];
  first_observed_at: string;
  last_observed_at: string;
};

function canonicalToken(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function ontologyCandidateKey(input: { name: unknown; category: unknown; variable_kind: unknown }): string {
  const identity = [canonicalToken(input.name), canonicalToken(input.category), canonicalToken(input.variable_kind)].join("|");
  return `task-local:${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

export function extractTaskLocalCandidateOccurrences(rows: Array<{
  run_id: string;
  artifact_id: string;
  artifact_version: number;
  question: string;
  domain: string;
  json_content: string;
  created_at: string;
}>): TaskLocalCandidateOccurrence[] {
  const occurrences: TaskLocalCandidateOccurrence[] = [];
  for (const row of rows) {
    let data: any = {};
    try { data = JSON.parse(row.json_content || "{}"); } catch { data = {}; }
    for (const variable of Array.isArray(data.variables) ? data.variables : []) {
      const ontologyNodeId = String(variable?.ontology_node_id || "").trim();
      if (!ontologyNodeId.startsWith("task_local:")) continue;
      const name = String(variable?.name || variable?.id || ontologyNodeId.slice("task_local:".length)).trim();
      const category = String(variable?.category || "unknown").trim();
      const variableKind = String(variable?.variable_kind || "unknown").trim();
      occurrences.push({
        candidate_key: ontologyCandidateKey({ name, category, variable_kind: variableKind }),
        run_id: row.run_id,
        artifact_id: row.artifact_id,
        artifact_version: Number(row.artifact_version),
        question: row.question,
        domain: row.domain,
        variable_id: String(variable?.id || "").trim(),
        name,
        category,
        variable_kind: variableKind,
        definition: String(variable?.definition || "").trim(),
        ontology_node_id: ontologyNodeId,
        observed_at: row.created_at,
      });
    }
  }
  return occurrences;
}

export function aggregateTaskLocalCandidates(
  occurrences: TaskLocalCandidateOccurrence[],
): TaskLocalCandidateSummary[] {
  const groups = new Map<string, TaskLocalCandidateOccurrence[]>();
  for (const occurrence of occurrences) {
    const group = groups.get(occurrence.candidate_key) || [];
    group.push(occurrence);
    groups.set(occurrence.candidate_key, group);
  }
  return [...groups.entries()].map(([candidateKey, group]) => {
    const sorted = [...group].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    const latest = sorted.at(-1)!;
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    const runIds = unique(group.map((item) => item.run_id));
    return {
      candidate_key: candidateKey,
      name: latest.name,
      category: latest.category,
      variable_kind: latest.variable_kind,
      occurrence_count: group.length,
      run_count: runIds.length,
      cross_task_reused: runIds.length > 1,
      run_ids: runIds,
      questions: unique(group.map((item) => item.question)),
      domains: unique(group.map((item) => item.domain)),
      variable_ids: unique(group.map((item) => item.variable_id)),
      definitions: unique(group.map((item) => item.definition)),
      first_observed_at: sorted[0].observed_at,
      last_observed_at: latest.observed_at,
    };
  }).sort((left, right) => right.run_count - left.run_count
    || right.occurrence_count - left.occurrence_count
    || right.last_observed_at.localeCompare(left.last_observed_at));
}
