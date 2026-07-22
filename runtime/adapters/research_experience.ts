import "server-only";
import { getRun, getWorkbenchDb, listResearchExperienceEvents } from "./db";
import { listResearchJobsForRun } from "./research_jobs";
import { computeResearchExperienceMetrics } from "../engine/research_experience_metrics";
import type { Artifact, ResearchWorkItem } from "../engine/types";

type MetricArtifact = Pick<Artifact, "id" | "run_id" | "kind" | "version" | "status" | "json_content" | "token_usage" | "approved_at" | "created_at">;
type MetricWorkItem = Pick<ResearchWorkItem, "id" | "run_id" | "status">;

export function getResearchExperienceMetrics(runId: string) {
  const run = getRun(runId);
  if (!run) return null;
  const db = getWorkbenchDb();
  const artifacts = db.prepare(`
    SELECT id, run_id, kind, version, status, json_content, token_usage, approved_at, created_at
    FROM artifacts
    WHERE run_id=?
    ORDER BY created_at ASC
  `).all(runId) as MetricArtifact[];
  const workItems = db.prepare(`
    SELECT id, run_id, status
    FROM research_work_items
    WHERE run_id=?
    ORDER BY created_at ASC
  `).all(runId) as MetricWorkItem[];
  return computeResearchExperienceMetrics({
    run,
    artifacts,
    workItems,
    jobs: listResearchJobsForRun(runId),
    events: listResearchExperienceEvents(runId),
  });
}
