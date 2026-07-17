import type { Artifact, SourceRecord } from "./types";
import { parseJson } from "./types";

const usage = (artifact: Artifact) => parseJson<any>(artifact.token_usage, {});

type ComparableRun = {
  stage03?: Artifact;
  stage04?: Artifact;
  sources: SourceRecord[];
};

function sortedDifference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function applicationSnapshot(artifact?: Artifact) {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  return new Map<string, string>(
    (data.method_applications || []).map((item: any) => [
      String(item.application_id),
      `${item.method_id}@${item.method_version}:${item.status}`,
    ]),
  );
}

function judgmentSnapshot(artifact?: Artifact) {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  return new Map<string, string>(
    (data.judgments || []).map((item: any) => [
      String(item.judgment_unit_id || item.id),
      `${item.strength}:${item.conclusion}`,
    ]),
  );
}

function changedEntries(previous: Map<string, string>, current: Map<string, string>) {
  const keys = new Set([...previous.keys(), ...current.keys()]);
  return [...keys]
    .filter((key) => previous.get(key) !== current.get(key))
    .sort()
    .map((key) => ({ id: key, previous: previous.get(key) || null, current: current.get(key) || null }));
}

export function runDifferenceAttribution(previous: ComparableRun, current: ComparableRun) {
  const previousSources = new Set(previous.sources.map((source) => source.normalized_url));
  const currentSources = new Set(current.sources.map((source) => source.normalized_url));
  const addedSources = sortedDifference(currentSources, previousSources);
  const removedSources = sortedDifference(previousSources, currentSources);
  const methodChanges = changedEntries(applicationSnapshot(previous.stage04), applicationSnapshot(current.stage04));
  const judgmentChanges = changedEntries(judgmentSnapshot(previous.stage04), judgmentSnapshot(current.stage04));
  const modelChanged = previous.stage04?.model_name !== current.stage04?.model_name;
  const promptChanged = previous.stage04?.prompt_version !== current.stage04?.prompt_version;
  const knowledgeChanged =
    previous.stage03?.knowledge_version !== current.stage03?.knowledge_version
    || previous.stage04?.knowledge_version !== current.stage04?.knowledge_version;
  const causes: string[] = [];
  if (addedSources.length || removedSources.length) causes.push("evidence_change");
  if (methodChanges.length) causes.push("method_change");
  if (modelChanged) causes.push("model_change");
  if (promptChanged || knowledgeChanged) causes.push("runtime_configuration_change");
  if (judgmentChanges.length && !causes.length) causes.push("model_variation");
  if (!judgmentChanges.length) causes.push("no_judgment_change");
  return {
    causes,
    evidence: { added_sources: addedSources, removed_sources: removedSources },
    methods: { changed: methodChanges },
    runtime: {
      model_changed: modelChanged,
      prompt_changed: promptChanged,
      knowledge_changed: knowledgeChanged,
      previous_model: previous.stage04?.model_name || null,
      current_model: current.stage04?.model_name || null,
    },
    judgments: { changed: judgmentChanges },
  };
}

export function comparisonMetrics(
  baseline: Artifact,
  report: Artifact,
  stage03: Artifact | undefined,
  stage04: Artifact | undefined,
  sources: SourceRecord[],
) {
  const baselineData: any = parseJson(baseline.json_content, {});
  const reportData: any = parseJson(report.json_content, {});
  const evidenceData: any = parseJson(stage03?.json_content || "{}", {});
  const judgmentData: any = parseJson(stage04?.json_content || "{}", {});
  const baselineClaims = baselineData.core_claims || [];
  const reportClaims = reportData.report_claims || [];
  const judgments = judgmentData.judgments || [];
  const applications = judgmentData.method_applications || [];
  const executedIds = new Set(
    applications.filter((item: any) => item.status === "executed").map((item: any) => item.application_id),
  );
  const tokens = (artifact: Artifact) => {
    const value = usage(artifact);
    return (value.input_tokens || 0) + (value.output_tokens || 0);
  };
  return {
    baseline: {
      clickable_sources: (baselineData.sources || []).length,
      supported_claim_ratio: baselineClaims.length
        ? baselineClaims.filter((item: any) => item.source_keys?.length).length / baselineClaims.length
        : 0,
      counterevidence_count: (baselineData.counterpoints || []).length,
      limitations_count: (baselineData.limitations || []).length,
      tokens: tokens(baseline),
      web_search_calls: parseJson<any>(baseline.tool_usage, {}).web_search_calls || 0,
    },
    runtime: {
      clickable_sources: sources.length,
      supported_claim_ratio: reportClaims.length
        ? reportClaims.filter((item: any) => item.source_ids?.length && item.judgment_ids?.length).length / reportClaims.length
        : 0,
      counterevidence_count: judgments.reduce((total: number, item: any) => total + (item.counter_evidence_draft_ids?.length || 0), 0),
      limitations_count: (reportData.limitations || []).length
        + judgments.reduce((total: number, item: any) => total + (item.invalidation_conditions?.length || 0), 0),
      traceable_claim_ratio: reportClaims.length
        ? reportClaims.filter((item: any) => item.judgment_ids?.length && item.method_application_ids?.length).length / reportClaims.length
        : 0,
      judgment_method_trace_ratio: judgments.length
        ? judgments.filter((item: any) => (item.method_application_ids || []).some((id: string) => executedIds.has(id))).length / judgments.length
        : 0,
      method_application_count: applications.length,
      executed_method_application_count: executedIds.size,
      evidence_drafts: (evidenceData.evidence_drafts || []).length,
      tokens: tokens(report),
      web_search_calls: parseJson<any>(stage03?.tool_usage || "{}", {}).web_search_calls || 0,
    },
  };
}
