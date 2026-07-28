import { notFound, redirect } from "next/navigation";
import { getRun } from "@/adapters/db";
import {
  latestArtifactPayload,
  listSourcesForReview,
  listWorkItemsForReview,
  previousArtifactPayload,
} from "@/adapters/db_read_models";
import { EvidenceBoard } from "@/app/components/evidence-board";
import { sourceRowForClient, workItemForClient } from "@/app/lib/client-rows";
import { buildEvidenceReviewSuggestions } from "@/engine/evidence_review_assist";
import { buildEvidenceSupplementSummary } from "@/engine/evidence_supplement_diff";
import { projectEvidenceRequirementsFromStructure } from "@/engine/structure_candidates";
import { parseJson } from "@/engine/types";
import Link from "next/link";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { researcherLanguage } from "@/app/lib/researcher-stage-output";

export const dynamic = "force-dynamic";

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const evidenceArtifact = latestArtifactPayload(id, "stage_03", ["approved", "needs_review"]);
  if (!evidenceArtifact) redirect(`/runs/${id}/stages/3`);

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
  // 证据页只展示并统计当前 Stage03 版本的对象级审阅任务。
  // 历史版本和 Stage04/独立审阅任务仍保留在档案中，但不能混入当前证据口径。
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
  }));

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

  const pending = workItems.filter((item) => item.status === "pending" || item.status === "rework");
  const approved = workItems.filter((item) => item.status === "approved");
  const gapAccepted = workItems.filter((item) => item.kind === "supplement_evidence" && item.status === "approved");

  return <>
    <StageSceneChrome
      runId={id}
      stage={3}
      status={evidenceArtifact.status}
      outputCount={evidence.length}
      statusNote={pending.length ? `先处理 ${pending.length} 项待核对内容。` : "当前证据审阅已完成，可进入判断阶段。"}
      actions={
        <>
          <StageApprovalButton
            runId={id}
            artifactId={evidenceArtifact.id}
            stage={3}
            status={evidenceArtifact.status}
            canApprove={pending.length === 0}
            blockingHint={pending.length ? `先处理 ${pending.length} 项待核对或退回修改的内容` : undefined}
          />
          <div className="run-meta">
            <span>待核对 {pending.length}</span>
            <span>已确认 {approved.length}</span>
            <span>已确认暂缺 {gapAccepted.length}</span>
          </div>
          <Link className="button" href={`/runs/${id}/stages/3`}>去补证 →</Link>
        </>
      }
    />

    {units.length ? <EvidenceBoard
      runId={id}
      units={units}
      evidence={evidence}
      sources={sources.map(sourceRowForClient)}
      workItems={workItems.map(workItemForClient)}
      suggestions={suggestions}
      supplementSummary={supplementSummary.visible ? supplementSummary : null}
      artifactVersion={evidenceArtifact.version}
    /> : <div className="card empty-state">
      <h2>先建立研究结构</h2>
      <p className="muted">证据台必须按判断单元组织；请先确认问题树、竞争解释与必要证据。</p>
      <Link className="button" href={`/runs/${id}/structure`}>进入结构场景</Link>
    </div>}
  </>;
}
