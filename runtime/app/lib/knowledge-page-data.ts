import "server-only";
import { listArtifacts, listRuns } from "@/storage/db";
import { loadOntology } from "@/skills/ontology/catalog_loader_adapter";
import { listOntologyCandidates } from "@/governance/ontology_changes/candidates_adapter";
import { listVariableUsageQueries } from "@/skills/ontology/research_queries";
import { listCrossRunVariableComparability } from "@/skills/ontology/variable_comparability";
import type { KnowledgeUsageRow } from "@/app/components/knowledge-usage-table";
import { buildKnowledgePackage } from "@/skills/method_selection/knowledge_package";
import { buildRunKnowledgeDashboard } from "@/skills/method_selection/knowledge_dashboard";
import { collectRunOntologyTouchpoints } from "@/skills/method_selection/knowledge_browser";
import { loadDataMappingRegistry } from "@/skills/financial_data/data_mapping";
import { loadOntologyCatalog } from "@/skills/ontology/catalog_loader";
import { affectedRunsByOntologyFingerprint } from "@/skills/ontology/impact";
import { applyUsageHeatToOntologyGraph, buildCandidateGapGraph, buildOntologyNetworkGraph } from "@/app/lib/ontology-network-graph";

export function knowledgeRuns() {
  return listRuns().filter((run) => run.current_stage > 0 && !["draft", "archived"].includes(run.status))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
}

export function loadTaskKnowledgePage(runId?: string) {
  const runs = knowledgeRuns();
  const selectedRun = runs.find((run) => run.id === runId) || runs[0];
  return { runs, selectedRun, dashboard: selectedRun ? buildRunKnowledgeDashboard(selectedRun.id) : null, ontologyNodes: loadOntology() };
}

export function loadLibraryKnowledgePage() {
  const runs = knowledgeRuns();
  const ontologyNodes = loadOntology();
  const catalog = loadOntologyCatalog();
  const mappings = loadDataMappingRegistry();
  const candidates = listOntologyCandidates();
  const variableUsage = listVariableUsageQueries();
  const comparability = listCrossRunVariableComparability();
  const baseline = buildKnowledgePackage(null);
  const affectedLegacyRuns = affectedRunsByOntologyFingerprint(runs.flatMap((run) => listArtifacts(run.id)), catalog.fingerprint);
  const touchUsage = new Map<string, { run_count: number; occurrence_count: number }>();
  const touchOccurrences = new Map<string, Array<{ run_id: string; question: string; name: string; domain: string; updated_at: string }>>();
  for (const run of runs) for (const id of collectRunOntologyTouchpoints(run.id)) {
    if (String(id).startsWith("task_local:")) continue;
    const current = touchUsage.get(id) || { run_count: 0, occurrence_count: 0 };
    current.run_count += 1; current.occurrence_count += 1; touchUsage.set(id, current);
    touchOccurrences.set(id, [...(touchOccurrences.get(id) || []), { run_id: run.id, question: run.question, name: id, domain: run.domain, updated_at: run.updated_at }]);
  }
  for (const usage of variableUsage.filter((item) => item.source === "formal")) touchUsage.set(usage.semantic_ref, { run_count: usage.run_count, occurrence_count: usage.occurrence_count });
  const fullOntologyGraph = buildOntologyNetworkGraph(ontologyNodes);
  const heatGraph = applyUsageHeatToOntologyGraph(fullOntologyGraph, touchUsage);
  const gapGraph = buildCandidateGapGraph(candidates);
  const usedFormalCount = ontologyNodes.filter((node) => touchUsage.has(node.id)).length;
  const unusedFormalCount = ontologyNodes.length - usedFormalCount;
  const duplicateOntologyIds = ontologyNodes.length - new Set(ontologyNodes.map((node) => node.id)).size;
  const ontologyIds = new Set(ontologyNodes.map((node) => node.id));
  const danglingRelations = ontologyNodes.filter((node) => node.category === "Relation" && [...node.source_types, ...node.target_types].some((id) => !ontologyIds.has(id)));
  const repeatedCandidates = candidates.filter((candidate) => candidate.run_count > 1);
  const activeMappings = mappings.profiles.filter((profile) => profile.status === "active").length;
  const comparisonById = new Map(comparability.map((group) => [group.ontology_node_id, group]));
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.candidate_key, candidate]));
  const ontologyById = new Map(ontologyNodes.map((node) => [node.id, node]));
  const usageRows: KnowledgeUsageRow[] = ontologyNodes.map((node) => {
    const occurrences = touchOccurrences.get(node.id) || [];
    return {
      semantic_ref: node.id, label: node.name, source: "formal" as const,
      knowledge_kind: node.category === "Relation" ? "relation" as const : node.category === "Rule" ? "rule" as const : "object" as const,
      domains: [...new Set(occurrences.map((item) => item.domain))], application_status: occurrences.length ? "applied" as const : "unused" as const,
      run_count: new Set(occurrences.map((item) => item.run_id)).size, occurrence_count: touchUsage.get(node.id)?.occurrence_count || 0,
      last_used_at: occurrences.map((item) => item.updated_at).sort().at(-1) || "", occurrences,
    };
  });
  for (const usage of variableUsage) {
    if (usage.source === "formal" && ontologyById.has(usage.semantic_ref)) continue;
    const occurrenceRuns = usage.occurrences.map((item) => runs.find((run) => run.id === item.run_id)).filter(Boolean);
    const candidate = candidateByKey.get(usage.semantic_ref);
    const comparison = comparisonById.get(usage.semantic_ref);
    usageRows.push({
      ...usage, knowledge_kind: "variable", domains: candidate?.domains || [...new Set(occurrenceRuns.map((run) => run!.domain))],
      application_status: usage.source === "task_local" ? "candidate" : "applied",
      last_used_at: candidate?.last_observed_at || occurrenceRuns.map((run) => run!.updated_at).sort().at(-1) || "",
      comparison: comparison ? { aligned_count: comparison.aligned_count, blocked_count: comparison.blocked_count, insufficient_count: comparison.insufficient_count, comparisons: comparison.comparisons } : undefined,
    });
  }
  usageRows.sort((left, right) => right.run_count - left.run_count || right.occurrence_count - left.occurrence_count || left.label.localeCompare(right.label, "zh-CN"));
  return {
    runs, ontologyNodes, catalog, mappings, candidates, baseline, affectedLegacyRuns, fullOntologyGraph, heatGraph, gapGraph, usageRows,
    usedFormalCount, unusedFormalCount, duplicateOntologyIds, danglingRelations, repeatedCandidates, activeMappings,
  };
}
