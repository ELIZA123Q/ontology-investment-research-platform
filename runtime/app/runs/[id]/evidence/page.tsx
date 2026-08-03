import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import {
  latestArtifactPayload,
  listSourcesForReview,
  listWorkItemsForReview,
  previousArtifactPayload,
} from "@/adapters/db_read_models";
import { EvidenceBoard } from "@/app/components/evidence-board";
import type { EvidenceQuickFilter } from "@/app/lib/evidence-view";
import { sourceRowForClient, workItemForClient } from "@/app/lib/client-rows";
import { buildEvidenceReviewSuggestions } from "@/engine/evidence_review_assist";
import { buildEvidenceSupplementSummary } from "@/engine/evidence_supplement_diff";
import { buildEvidenceProfileGapHints, profileHintsAsGapPriorities } from "@/engine/evidence_profile_gaps";
import { precheckFindingsAsWeakLinks, precheckStage03OntologyConstraints } from "@/engine/ontology_stage03_precheck";
import { projectEvidenceRequirementsFromStructure } from "@/engine/structure_candidates";
import { parseJson } from "@/engine/types";
import Link from "next/link";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { buildEvidenceReadinessView, buildStageDecisionView, researcherLanguage } from "@/app/lib/researcher-stage-output";
import { journeyEditHref } from "@/app/lib/research-journey";
import { StageExceptionNotice } from "@/app/components/stage-exception-notice";

export const dynamic = "force-dynamic";

export default async function EvidencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string; from?: string; filter?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const run = getRun(id);
  if (!run) notFound();
  const evidenceArtifact = latestArtifactPayload(id, "stage_03", ["approved", "needs_review"]);
  if (!evidenceArtifact) {
    return (
      <EmptyState
        title="尚未准备证据"
        description="先进入证据准备页取得公开来源并形成待核对事实，再回到证据台逐项确认。"
        actionHref={journeyEditHref(id, 3)}
        actionLabel="开始取证 →"
      />
    );
  }

  const structure: any = parseJson(latestArtifactPayload(id, "stage_02", ["approved", "needs_review"])?.json_content || "{}", {});
  const evidenceData: any = parseJson(evidenceArtifact.json_content || "{}", {});
  const previousRaw = previousArtifactPayload(id, "stage_03", evidenceArtifact.version)?.json_content || "{}";
  const previousEvidenceData: any = parseJson(previousRaw, {});
  const hasPrevious = previousRaw.trim() !== "{}" && Object.keys(previousEvidenceData || {}).length > 0;
  const supplementSummary = buildEvidenceSupplementSummary({
    current: evidenceData,
    previous: hasPrevious ? previousEvidenceData : null,
  });
  const taskData: any = parseJson(latestArtifactPayload(id, "stage_01", ["approved"])?.json_content || "{}", {});
  const sources = listSourcesForReview(id);
  const workItems = listWorkItemsForReview(id).filter((item) =>
    item.artifact_id === evidenceArtifact.id && item.attempt === evidenceArtifact.version,
  );
  const cutoffMs = Date.parse(String(taskData.time_scope?.as_of || ""));

  const units = (structure.judgment_units || []).map((unit: any, index: number) => ({
    id: String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`),
    title: researcherLanguage(unit.title || unit.statement || unit.question),
    question: researcherLanguage(unit.question || unit.statement || ""),
    ontology_node_ids: Array.isArray(unit.ontology_node_ids) ? unit.ontology_node_ids.map(String) : [],
  }));

  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({
    id: String(item.id || item.evidence_id || `EV-${index + 1}`),
    statement: researcherLanguage(item.statement || ""),
    kind: String(item.kind || "fact_draft"),
    direction: String(item.direction || "unknown"),
    directness: item.directness ? String(item.directness) : undefined,
    source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String) : [],
    judgment_unit_ids: Array.isArray(item.judgment_unit_ids)
      ? item.judgment_unit_ids.map(String)
      : Array.isArray(item.target_judgment_unit_refs)
        ? item.target_judgment_unit_refs.map(String)
        : [],
    limitations: Array.isArray(item.limitations) ? item.limitations.map(researcherLanguage) : [],
    requirement: item.requirement ? researcherLanguage(item.requirement) : undefined,
    evidence_role: item.evidence_role ? String(item.evidence_role) : undefined,
    minimum_independent_sources: item.minimum_independent_sources !== undefined ? Number(item.minimum_independent_sources) : undefined,
    evidence_requirement_ids: Array.isArray(item.evidence_requirement_ids) ? item.evidence_requirement_ids.map(String) : [],
  }));
  const focusedEvidenceId = q.focus
    ? evidence.find((item: any) => item.id === q.focus || item.evidence_requirement_ids.includes(q.focus!))?.id || ""
    : "";

  const requirements = projectEvidenceRequirementsFromStructure({
    units: (structure.judgment_units || []).map((unit: any) => ({
      id: String(unit.id || ""),
      evidence_requirements: unit.evidence_requirements,
    })),
    counter_evidence_directions: structure.counter_evidence_directions,
  });

  const suggestions = buildEvidenceReviewSuggestions({
    evidence,
    sources: sources as any,
    workItems: workItems as any,
    cutoffMs: Number.isFinite(cutoffMs) ? cutoffMs : undefined,
    requirements,
  });

  const profileHints = buildEvidenceProfileGapHints({
    variables: structure.variables,
    judgment_units: structure.judgment_units,
    limit: 3,
  });
  const extraGapPriorities = profileHintsAsGapPriorities(profileHints);
  const ontologyPrecheck = precheckStage03OntologyConstraints({
    evidence_drafts: evidenceData.evidence_drafts || [],
    sources: sources as any,
    default_scope_ref: String(taskData.scope_ref || structure.scope_ref || ""),
    cutoff_at: String(taskData.time_scope?.as_of || ""),
  });
  const ontologyPrecheckHints = Array.from(new Set(precheckFindingsAsWeakLinks(ontologyPrecheck, 3)));
  const readiness = buildEvidenceReadinessView(evidenceData, {
    coverageConstraintCount: extraGapPriorities.length,
    ontologyWarningCount: ontologyPrecheckHints.length,
  });

  const pending = workItems.filter((item) => item.status === "pending" || item.status === "rework");
  const approved = workItems.filter((item) => item.status === "approved");
  const gapAccepted = workItems.filter((item) => item.kind === "supplement_evidence" && item.status === "approved");
  const supportCount = evidence.filter((item: any) => item.kind !== "gap" && item.kind !== "conflict" && item.kind !== "counter" && item.direction !== "weaken").length;
  const counterCount = evidence.filter((item: any) => item.kind === "counter" || item.direction === "weaken").length;
  const allowedFilters: EvidenceQuickFilter[] = ["all", "pending", "gaps", "changes"];
  const initialFilter = allowedFilters.includes(q.filter as EvidenceQuickFilter) ? q.filter as EvidenceQuickFilter : "all";
  const limitingCount = readiness.coverageConstraintCount + readiness.ontologyWarningCount;
  const evidenceState = pending.length
    ? `仍有 ${pending.length} 项待人工核对`
    : readiness.factCount === 0
      ? "尚未形成可用事实，只能保留证据尚缺"
      : limitingCount
        ? `已形成事实，但 ${limitingCount} 项覆盖或口径限制会约束结论强度`
        : "证据已核对，可进入判断";
  const decision = buildStageDecisionView({
    outcome: evidenceState,
    blockingReasons: pending.length ? [`${pending.length} 项证据需要人工处置`] : [],
    blockingTitle: `${pending.length} 项证据需要人工处置`,
  });

  return <>
    <StageSceneChrome
      runId={id}
      stage={3}
      status={evidenceArtifact.status}
      outputCount={evidence.length}
      statusNote={pending.length ? undefined : "当前证据审阅已完成，可进入判断阶段。"}
      actions={
        <>
          {pending.length === 0 ? <StageApprovalButton
            runId={id}
            artifactId={evidenceArtifact.id}
            stage={3}
            status={evidenceArtifact.status}
          /> : null}
          <StageStatusBadge status={evidenceArtifact.status} pendingCount={pending.length} />
          <Link className="button-secondary" href={journeyEditHref(id, 3)}>去补证</Link>
        </>
      }
    />

    {q.from ? <div className="notice audit-return-note">{focusedEvidenceId ? "已定位到与该关系问题对应的证据。" : "该证据要求尚未绑定到具体事实，请在本页补证或明确接受缺口。"}处理后，研究摘要与关系审计会自动重算。</div> : null}

    <StageExceptionNotice exception={decision.exception ? {
      ...decision.exception,
      summary: "待核对事实不会自动进入判断。",
      href: `/runs/${id}/evidence?filter=pending#evidence-board`,
      actionLabel: "查看待核对证据 →",
    } : null} />

    <section className="evidence-overview" aria-label="证据整体状况">
      <div className="evidence-overview-copy"><span>证据整体状况</span><strong>{decision.outcome}</strong><small>证据数量不等于结论强度；局限会在对应证据与判断中继续保留。</small></div>
      <div className="evidence-overview-metrics">
        <span><b>{supportCount}</b>支持事实</span>
        <span><b>{counterCount}</b>反证 / 削弱</span>
        <span><b>{readiness.conflictCount}</b>相互矛盾</span>
        <span><b>{readiness.gapCount}</b>尚缺证据</span>
        <span><b>{pending.length}</b>待核对</span>
        {limitingCount ? <span className="limiting"><b>{limitingCount}</b>强度限制</span> : null}
      </div>
      <small className="evidence-overview-reviewed">已确认 {approved.length} · 已确认暂缺 {gapAccepted.length}</small>
    </section>

    {units.length ? <EvidenceBoard
      runId={id}
      units={units}
      evidence={evidence}
      sources={sources.map(sourceRowForClient)}
      workItems={workItems.map(workItemForClient)}
      suggestions={suggestions}
      supplementSummary={supplementSummary.visible ? supplementSummary : null}
      artifactVersion={evidenceArtifact.version}
      extraGapPriorities={extraGapPriorities}
      ontologyPrecheckHints={ontologyPrecheckHints}
      focusId={focusedEvidenceId}
      initialFilter={initialFilter}
    /> : (
      <EmptyState
        title="先建立研究结构"
        description="证据台必须按关键判断组织；请先确认问题树、竞争解释与必要证据。"
        actionHref={`/runs/${id}/structure`}
        actionLabel="进入结构场景 →"
      />
    )}
  </>;
}
