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
      JSON.stringify({
        method_id: item.method_id,
        method_version: item.method_version,
        status: item.status,
        precondition_checks: item.precondition_checks || [],
        input_evidence_refs: item.input_evidence_refs || [],
        output_signal_refs: item.output_signal_refs || [],
        output_judgment_refs: item.output_judgment_refs || [],
        limitations: item.limitations || [],
      }),
    ]),
  );
}

function judgmentSnapshot(artifact?: Artifact) {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  return new Map<string, string>(
    (data.judgments || []).map((item: any) => [
      String(item.judgment_unit_id || item.id),
      JSON.stringify({
        strength: item.strength,
        conclusion: item.conclusion,
        decision_status: item.decision_status,
        conflict_status: item.conflict_status,
        supporting_evidence_draft_ids: item.supporting_evidence_draft_ids || [],
        counter_evidence_draft_ids: item.counter_evidence_draft_ids || [],
        hypothesis_ids: item.hypothesis_ids || [],
        rule_evaluation_ids: item.rule_evaluation_ids || [],
        method_application_ids: item.method_application_ids || [],
        uncertainties: item.uncertainties || [],
        invalidation_conditions: item.invalidation_conditions || [],
      }),
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

function judgmentChange(previous: string | null, current: string | null) {
  if (!previous && current) return "新增";
  if (previous && !current) return "失效/移除";
  const previousLevel = Number(parseJson<any>(previous || "{}", {}).strength?.match(/^J(\d)/)?.[1] || 0);
  const currentLevel = Number(parseJson<any>(current || "{}", {}).strength?.match(/^J(\d)/)?.[1] || 0);
  if (currentLevel > previousLevel) return "强化";
  if (currentLevel < previousLevel) return "削弱";
  return previous === current ? "未变化" : "结论变化";
}

export function runDifferenceAttribution(previous: ComparableRun, current: ComparableRun) {
  const previousSources = new Set(previous.sources.map((source) => source.normalized_url));
  const currentSources = new Set(current.sources.map((source) => source.normalized_url));
  const previousSourceState = new Map(previous.sources.map((source) => [source.normalized_url, `${source.content_hash || ""}:${source.usability_status || ""}:${source.source_tier || ""}`]));
  const currentSourceState = new Map(current.sources.map((source) => [source.normalized_url, `${source.content_hash || ""}:${source.usability_status || ""}:${source.source_tier || ""}`]));
  const addedSources = sortedDifference(currentSources, previousSources);
  const removedSources = sortedDifference(previousSources, currentSources);
  const changedSources = [...new Set([...previousSources, ...currentSources])]
    .filter((url) => previousSourceState.has(url) && currentSourceState.has(url) && previousSourceState.get(url) !== currentSourceState.get(url))
    .sort()
    .map((url) => ({ url, previous: previousSourceState.get(url), current: currentSourceState.get(url) }));
  const methodChanges = changedEntries(applicationSnapshot(previous.stage04), applicationSnapshot(current.stage04));
  const judgmentChanges = changedEntries(judgmentSnapshot(previous.stage04), judgmentSnapshot(current.stage04))
    .map((item) => ({ ...item, change: judgmentChange(item.previous, item.current) }));
  const modelChanged = previous.stage04?.model_name !== current.stage04?.model_name;
  const promptChanged = previous.stage04?.prompt_version !== current.stage04?.prompt_version;
  const knowledgeChanged =
    previous.stage03?.knowledge_version !== current.stage03?.knowledge_version
    || previous.stage04?.knowledge_version !== current.stage04?.knowledge_version;
  const causes: string[] = [];
  if (addedSources.length || removedSources.length || changedSources.length) causes.push("evidence_change");
  if (methodChanges.length) causes.push("method_change");
  if (modelChanged) causes.push("model_change");
  if (promptChanged || knowledgeChanged) causes.push("runtime_configuration_change");
  if (judgmentChanges.length && !causes.length) causes.push("model_variation");
  if (!judgmentChanges.length) causes.push("no_judgment_change");
  return {
    causes,
    evidence: { added_sources: addedSources, removed_sources: removedSources, changed_sources: changedSources },
    methods: { changed: methodChanges },
    runtime: {
      model_changed: modelChanged,
      prompt_changed: promptChanged,
      knowledge_changed: knowledgeChanged,
      previous_model: previous.stage04?.model_name || null,
      current_model: current.stage04?.model_name || null,
    },
    judgments: { changed: judgmentChanges },
    unexplained_model_variation: causes.includes("model_variation"),
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
  const evidenceDrafts = evidenceData.evidence_drafts || [];
  const evidenceById = new Map<string, any>(evidenceDrafts.map((item: any) => [String(item.id), item]));
  const judgmentById = new Map<string, any>(judgments.map((item: any) => [String(item.id), item]));
  const usableSourceIds = new Set(
    sources
      .filter((source) => source.usability_status === "usable"
        && source.retrieval_status === "captured"
        && Boolean(source.content_hash)
        && Boolean(source.locator)
        && Boolean(source.source_quote)
        && Boolean(source.quote_verified))
      .map((source) => source.id),
  );
  const executedIds = new Set(
    applications.filter((item: any) => item.status === "executed").map((item: any) => item.application_id),
  );
  const tokens = (artifact: Artifact) => {
    const value = usage(artifact);
    return (value.input_tokens || 0) + (value.output_tokens || 0);
  };
  const claimHasClosedTrace = (claim: any) => {
    const claimEvidenceIds = new Set<string>((claim.evidence_draft_ids || []).map(String));
    const claimSourceIds = new Set<string>((claim.source_ids || []).map(String));
    const claimJudgments = (claim.judgment_ids || []).map((id: unknown) => judgmentById.get(String(id))).filter(Boolean);
    if (!claimJudgments.length || !claimEvidenceIds.size || !claimSourceIds.size) return false;
    const judgmentEvidenceIds = new Set<string>(claimJudgments.flatMap((item: any) => [
      ...(item.supporting_evidence_draft_ids || []),
      ...(item.counter_evidence_draft_ids || []),
    ].map(String)));
    if ([...claimEvidenceIds].some((id) => !judgmentEvidenceIds.has(id) || !evidenceById.has(id))) return false;
    const derivedSourceIds = new Set<string>([...claimEvidenceIds].flatMap((id) => {
      const draft = evidenceById.get(id);
      return draft?.kind === "gap" ? [] : (draft?.source_ids || []).map(String);
    }));
    return derivedSourceIds.size > 0
      && [...claimSourceIds].every((id) => derivedSourceIds.has(id) && usableSourceIds.has(id))
      && [...derivedSourceIds].every((id) => claimSourceIds.has(id));
  };
  const claimHasMethodTrace = (claim: any) => {
    const claimMethods = new Set<string>((claim.method_application_ids || []).map(String));
    const boundJudgments = (claim.judgment_ids || []).map((id: unknown) => judgmentById.get(String(id))).filter(Boolean);
    if (!claimMethods.size || !boundJudgments.length) return false;
    const judgmentMethods = new Set<string>(boundJudgments.flatMap((item: any) => (item.method_application_ids || []).map(String)));
    return [...claimMethods].every((id) => judgmentMethods.has(id) && executedIds.has(id));
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
      clickable_sources: usableSourceIds.size,
      supported_claim_ratio: reportClaims.length
        ? reportClaims.filter(claimHasClosedTrace).length / reportClaims.length
        : 0,
      counterevidence_count: judgments.reduce((total: number, item: any) => total + (item.counter_evidence_draft_ids?.length || 0), 0),
      limitations_count: (reportData.limitations || []).length
        + judgments.reduce((total: number, item: any) => total + (item.invalidation_conditions?.length || 0), 0),
      traceable_claim_ratio: reportClaims.length
        ? reportClaims.filter((item: any) => claimHasClosedTrace(item) && claimHasMethodTrace(item)).length / reportClaims.length
        : 0,
      judgment_method_trace_ratio: judgments.length
        ? judgments.filter((item: any) => (item.method_application_ids || []).some((id: string) => executedIds.has(id))).length / judgments.length
        : 0,
      method_application_count: applications.length,
      executed_method_application_count: executedIds.size,
      evidence_drafts: evidenceDrafts.length,
      tokens: tokens(report),
      web_search_calls: parseJson<any>(stage03?.tool_usage || "{}", {}).web_search_calls || 0,
    },
  };
}
