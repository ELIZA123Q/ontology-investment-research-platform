import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { latestArtifactMeta, latestArtifactPayload, listSourcesForReview, previousArtifactPayload } from "@/adapters/db_read_models";
import { StageWorkspaceLazy } from "@/app/components/stage-workspace-lazy";
import { listResearchJobsForRun } from "@/adapters/research_jobs";
import type { Stage3SourceCoverageProps, Stage4JudgmentProps } from "@/app/components/stage-workspace";
import { artifactForWorkspace } from "@/app/lib/client-rows";
import { computeSourceCoverage } from "@/engine/source_coverage";
import { buildEvidenceSupplementSummary } from "@/engine/evidence_supplement_diff";
import { normalizeCompetingExplanations, projectEvidenceRequirementsFromStructure, type EvidenceRequirementProjection } from "@/engine/structure_candidates";
import { STAGES, parseJson } from "@/engine/types";
import type { SourceRecord } from "@/engine/types";
import { researchStage } from "@/app/lib/research-journey";
import { latestJobForStage } from "@/app/lib/ui-labels";

export const dynamic = "force-dynamic";

function compactScopeSummary(jsonContent: string | undefined) {
  const data = parseJson<any>(jsonContent || "{}", {});
  const time = data.time_scope || {};
  return {
    coreObject: String(data.core_object || "").trim(),
    judgmentAction: String(data.judgment_action || "").trim(),
    asOf: String(time.as_of || "").trim(),
    lookback: String(time.lookback || "").trim(),
    forward: String(time.forward || "").trim(),
  };
}

function buildStage3SourceCoverage(runId: string): Stage3SourceCoverageProps | undefined {
  const structureArtifact = latestArtifactPayload(runId, "stage_02", ["approved", "needs_review"]);
  if (!structureArtifact) return undefined;

  const structure: any = parseJson(structureArtifact.json_content || "{}", {});
  const evidenceArtifact = latestArtifactPayload(runId, "stage_03", ["approved", "needs_review"])
    || latestArtifactPayload(runId, "stage_03");
  const evidenceData: any = parseJson(evidenceArtifact?.json_content || "{}", {});
  const approvedEvidenceData: any = parseJson(
    latestArtifactPayload(runId, "stage_03", ["approved"])?.json_content || "{}",
    {},
  );
  const taskData: any = parseJson(latestArtifactPayload(runId, "stage_01", ["approved"])?.json_content || "{}", {});
  const sources = listSourcesForReview(runId);

  const boundSourceIdList = [...new Set<string>(
    (evidenceData.evidence_drafts || [])
      .filter((item: any) => item.kind !== "gap")
      .flatMap((item: any) => Array.isArray(item.source_ids) ? item.source_ids.map(String) : []),
  )];
  const boundSourceIds = new Set(boundSourceIdList);
  const approvedBoundSourceIds = new Set<string>(
    (approvedEvidenceData.evidence_drafts || [])
      .filter((item: any) => item.kind !== "gap")
      .flatMap((item: any) => Array.isArray(item.source_ids) ? item.source_ids.map(String) : []),
  );
  const cutoffMs = Date.parse(String(taskData.time_scope?.as_of || ""));
  const controlledSources = sources.filter((source) => source.usability_status === "usable"
    && source.retrieval_status === "captured"
    && Boolean(source.quote_verified)
    && (!Number.isFinite(cutoffMs) || (Boolean(source.published_at) && Date.parse(String(source.published_at)) <= cutoffMs)));

  const units = (structure.judgment_units || []).map((unit: any, index: number) => ({
    id: String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`),
    title: String(unit.title || unit.statement || unit.question),
  }));

  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({
    id: String(item.id || item.evidence_id || `EV-${index + 1}`),
    kind: String(item.kind || "fact_draft"),
    direction: String(item.direction || "unknown"),
    directness: item.directness ? String(item.directness) : undefined,
    evidence_role: item.evidence_role ? String(item.evidence_role) : undefined,
    source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String) : [],
    judgment_unit_ids: Array.isArray(item.judgment_unit_ids)
      ? item.judgment_unit_ids.map(String)
      : Array.isArray(item.target_judgment_unit_refs)
        ? item.target_judgment_unit_refs.map(String)
        : [],
  }));

  const projectedRequirements = projectEvidenceRequirementsFromStructure({
    units: (structure.judgment_units || []).map((unit: any) => ({
      id: String(unit.id || ""),
      evidence_requirements: unit.evidence_requirements,
    })),
    counter_evidence_directions: structure.counter_evidence_directions,
  });
  const explicitRequirements: EvidenceRequirementProjection[] = Array.isArray(structure.evidence_requirements)
    ? structure.evidence_requirements.flatMap((item: any) => {
      const id = String(item?.id || "").trim();
      const requirement = String(item?.requirement || "").trim();
      const role = String(item?.evidence_role || "");
      const unitIds = Array.isArray(item?.judgment_unit_ids) ? item.judgment_unit_ids.map(String).filter(Boolean) : [];
      if (!id || !requirement || !["support", "counter", "context", "boundary"].includes(role) || !unitIds.length) return [];
      return [{
        id,
        requirement,
        evidence_role: role as EvidenceRequirementProjection["evidence_role"],
        minimum_independent_sources: Math.max(0, Number(item.minimum_independent_sources || 0)),
        judgment_unit_ids: unitIds,
        source: item.source === "counter_direction" ? "counter_direction" : "unit_requirement",
        source_ref: item.source_ref ? String(item.source_ref) : undefined,
      }];
    })
    : [];
  const requirements = explicitRequirements.length ? explicitRequirements : projectedRequirements;

  const coverage = computeSourceCoverage({
    sources: sources as any,
    evidence,
    requirements,
    cutoffMs: Number.isFinite(cutoffMs) ? cutoffMs : undefined,
  });

  return {
    units,
    sources: sources.map((source): Stage3SourceCoverageProps["sources"][number] => ({
      id: String(source.id),
      title: String(source.title),
      publisher: String(source.publisher),
      published_at: source.published_at ? String(source.published_at) : null,
      url: String(source.url),
      locator: source.locator ? String(source.locator) : undefined,
      usability_status: source.usability_status as SourceRecord["usability_status"],
      retrieval_status: source.retrieval_status as SourceRecord["retrieval_status"],
      authority_type: source.authority_type as SourceRecord["authority_type"],
      source_tier: source.source_tier as SourceRecord["source_tier"],
      quote_verified: Boolean(source.quote_verified),
      failure_detail: source.failure_detail ? String(source.failure_detail) : undefined,
      source_type: String(source.source_type),
      fact_status: approvedBoundSourceIds.has(String(source.id))
        ? "approved"
        : boundSourceIds.has(String(source.id))
          ? "draft"
          : "none",
    })),
    controlledSources: controlledSources.map((source) => ({
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      published_at: source.published_at,
      authority_type: source.authority_type,
    })),
    coverage,
    boundSourceIds: boundSourceIdList,
  };
}

function buildStage4JudgmentProjection(runId: string): Stage4JudgmentProps | undefined {
  const structureArtifact = latestArtifactPayload(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifactPayload(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) return undefined;

  const structure: any = parseJson(structureArtifact.json_content || "{}", {});
  const evidenceData: any = parseJson(evidenceArtifact.json_content || "{}", {});
  const structureUnitIds = (structure.judgment_units || []).map((unit: any, index: number) => String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`));

  return {
    units: (structure.judgment_units || []).map((unit: any, index: number) => ({
      id: String(unit.id || unit.judgment_unit_id || `JU-${index + 1}`),
      title: String(unit.title || unit.statement || unit.question),
      ontology_node_ids: Array.isArray(unit.ontology_node_ids) ? unit.ontology_node_ids.map(String) : [],
    })),
    evidence: (evidenceData.evidence_drafts || [])
      .filter((item: any) => item.kind !== "gap")
      .map((item: any, index: number) => ({
        id: String(item.id || item.evidence_id || `EV-${index + 1}`),
        statement: String(item.statement || ""),
        judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids.map(String) : [],
        direction: String(item.direction || ""),
      })),
    methodApplications: (evidenceData.method_applications || []).map((application: any) => ({
      application_id: String(application.application_id || ""),
      method_id: String(application.method_id || ""),
      capability_type: String(application.capability_type || ""),
      target_judgment_unit_refs: Array.isArray(application.target_judgment_unit_refs) ? application.target_judgment_unit_refs.map(String) : [],
      precondition_checks: Array.isArray(application.precondition_checks)
        ? application.precondition_checks.map((check: any) => ({
          precondition_id: String(check.precondition_id || ""),
          reason: String(check.reason || ""),
        }))
        : [],
    })),
    structureCompetingExplanations: normalizeCompetingExplanations(structure.competing_explanations, { unitIds: structureUnitIds }),
  };
}

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const n = Number(stage);
  const run = getRun(id);
  if (!run || n < 1 || n > 5) notFound();
  const journey = researchStage(n)!;
  const kind = STAGES[n - 1];
  const artifactRow = latestArtifactPayload(id, kind);
  const artifact = artifactRow ? artifactForWorkspace(artifactRow) : undefined;
  const latestStageJob = latestJobForStage(listResearchJobsForRun(id), kind);
  const activeJob = latestStageJob && ["queued", "running", "retrying", "waiting_for_input", "blocked"].includes(latestStageJob.status)
    ? latestStageJob
    : undefined;
  const reviewable = latestArtifactMeta(id, kind, ["approved", "needs_review"]);
  const unlocked = n === 1 || Boolean(latestArtifactMeta(id, STAGES[n - 2], ["approved"]));
  const approvedScope = n === 2
    ? compactScopeSummary(latestArtifactPayload(id, "stage_01", ["approved"])?.json_content)
    : undefined;
  const sourceCoverage = n === 3 ? buildStage3SourceCoverage(id) : undefined;
  const judgmentProjection = n === 4 ? buildStage4JudgmentProjection(id) : undefined;
  const supplementSummary = n === 3 && artifactRow
    ? (() => {
      const current = parseJson<any>(artifactRow.json_content || "{}", {});
      const previousRaw = previousArtifactPayload(id, "stage_03", artifactRow.version)?.json_content || "{}";
      const previous = parseJson<any>(previousRaw, {});
      const hasPrevious = previousRaw.trim() !== "{}" && Object.keys(previous || {}).length > 0;
      const summary = buildEvidenceSupplementSummary({
        current,
        previous: hasPrevious ? previous : null,
      });
      return summary.visible && artifactRow.status === "needs_review" ? summary : undefined;
    })()
    : undefined;
  const statusLabel = ({
    draft: "草稿",
    running: "生成中",
    needs_review: "待确认",
    approved: "已确认",
    failed: "失败",
    cancelled: "已取消",
    superseded: "已被新版取代",
  } as Record<string, string>)[artifact?.status || ""] || artifact?.status || "尚未开始";
  const reviewHref = `/runs/${id}${journey.reviewPath}`;

  return <>
    <div className="pagehead scene-head">
      <div>
        <div className="eyebrow">修改{journey.navLabel}阶段 · {statusLabel}</div>
        <h1>{journey.editTitle}</h1>
        <p className="muted">
          {reviewable || n <= 3
            ? journey.editHint
            : "本阶段尚无可核对版本：先在这里生成，再回阶段页面确认输出。"}
        </p>
      </div>
      {reviewHref ? (
        reviewable ? (
          <Link className="button" href={reviewHref}>
            查看本阶段输出 →
          </Link>
        ) : (
          <span className="button button-muted" aria-disabled="true" title="生成后可进入审阅场景">
            生成后查看输出
          </span>
        )
      ) : null}
    </div>
    <StageWorkspaceLazy
      runId={id}
      question={run.question}
      stage={n}
      artifact={artifact}
      activeJob={activeJob ? {
        id: activeJob.id,
        status: activeJob.status,
        attempt: activeJob.attempt,
        max_attempts: activeJob.max_attempts,
        last_error: activeJob.last_error,
        available_at: activeJob.available_at,
        updated_at: activeJob.updated_at,
      } : undefined}
      unlocked={unlocked}
      approvedScope={approvedScope}
      sourceCoverage={sourceCoverage}
      judgmentProjection={judgmentProjection}
      supplementSummary={supplementSummary}
    />
  </>;
}
