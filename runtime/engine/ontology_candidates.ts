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
  anchors: string[];
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
  anchors: string[];
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
        anchors: Array.isArray(variable?.anchors) ? variable.anchors.map(String).filter(Boolean) : [],
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
      anchors: unique(group.flatMap((item) => item.anchors)),
      first_observed_at: sorted[0].observed_at,
      last_observed_at: latest.observed_at,
    };
  }).sort((left, right) => right.run_count - left.run_count
    || right.occurrence_count - left.occurrence_count
    || right.last_observed_at.localeCompare(left.last_observed_at));
}

export type CandidateSimilarity = {
  candidate_key: string;
  name: string;
  score: number;
  confidence: "high" | "possible";
  reason: string;
};

function bigrams(value: string): Set<string> {
  const token = canonicalToken(value);
  if (!token) return new Set();
  if (token.length < 2) return new Set([token]);
  return new Set(Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2)));
}

function dice(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left.map(canonicalToken).filter(Boolean));
  const b = new Set(right.map(canonicalToken).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

/**
 * 保守的确定性近义提示：类别与变量类型必须一致；只有高分项默认建议归组。
 * 它只生成治理线索，绝不自动把两个 task_local 概念写成同一正式知识。
 */
export function candidateSimilarities(
  candidate: TaskLocalCandidateSummary,
  all: TaskLocalCandidateSummary[],
): CandidateSimilarity[] {
  return all.flatMap((other) => {
    if (other.candidate_key === candidate.candidate_key) return [];
    const sameDomain = candidate.domains.some((domain) => other.domains.map(canonicalToken).includes(canonicalToken(domain)));
    if (!sameDomain) return [];
    if (canonicalToken(other.category) !== canonicalToken(candidate.category)) return [];
    if (canonicalToken(other.variable_kind) !== canonicalToken(candidate.variable_kind)) return [];
    const exactName = canonicalToken(other.name) === canonicalToken(candidate.name);
    const nameScore = exactName ? 1 : dice(candidate.name, other.name);
    const definitionScore = Math.max(0, ...candidate.definitions.flatMap((left) => other.definitions.map((right) => dice(left, right))));
    const anchorScore = jaccard(candidate.anchors, other.anchors);
    const score = exactName ? 1 : Number((nameScore * .45 + definitionScore * .35 + anchorScore * .2).toFixed(4));
    if (score < .7) return [];
    const confidence = score >= .86 ? "high" as const : "possible" as const;
    return [{
      candidate_key: other.candidate_key,
      name: other.name,
      score,
      confidence,
      reason: exactName
        ? "名称归一后相同"
        : `名称 ${(nameScore * 100).toFixed(0)}% · 定义 ${(definitionScore * 100).toFixed(0)}% · 锚点 ${(anchorScore * 100).toFixed(0)}%`,
    }];
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"));
}
