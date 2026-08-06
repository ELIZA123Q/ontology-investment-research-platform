import "server-only";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createRun, getWorkbenchDatabaseIdentity, getWorkbenchDb, withImmediateTransaction } from "../storage/db";
import { latestArtifactPayload } from "../storage/db_read_models";
import { getResearchExperienceMetrics } from "./research_experience";
import { repositoryPath } from "../storage/repo_paths";
import {
  computeExperienceCohortSummary,
  deriveExperienceCaseProgress,
  parsePairedQualityMeasurement,
  type CohortCaseMeasurement,
  type ExperienceCaseProgress,
  type ExperienceCohortSummary,
} from "./experience_cohort";

type CohortCaseDefinition = {
  case_id: string;
  question: string;
  decision_context: string;
  information_cutoff: string;
  task_family: string;
  scenarios: string[];
  ontology_value_hypotheses: string[];
};

type CohortDocument = {
  cohort_id: string;
  title: string;
  measurement_contract: { target_setting_after_completed_cases: number };
  primary_cases: CohortCaseDefinition[];
};

export type ExperienceCohortCase = CohortCaseDefinition & {
  status: "planned" | "enrolled" | "running" | "completed";
  run_id: string | null;
  run_updated_at: string | null;
  progress: ExperienceCaseProgress;
};

export type ExperienceCohortReadModel = {
  cohort_id: string;
  title: string;
  target_gate: number;
  completed_count: number;
  enrolled_count: number;
  baseline_ready: boolean;
  summary: ExperienceCohortSummary;
  cases: ExperienceCohortCase[];
};

let cachedDocument: CohortDocument | undefined;

function cohortDocument(): CohortDocument {
  if (cachedDocument) return cachedDocument;
  const path = repositoryPath("90_compat", "evaluation", "07_研究员体验基线", "cohort.yaml");
  const document = parse(readFileSync(path, "utf-8")) as CohortDocument;
  if (!document?.cohort_id || !Array.isArray(document.primary_cases)) {
    throw new Error("研究员体验基线队列格式无效");
  }
  cachedDocument = document;
  return document;
}

export function getExperienceCohortCaseDefinition(caseId: string) {
  const document = cohortDocument();
  const item = document.primary_cases.find((candidate) => candidate.case_id === caseId);
  return item ? { cohort_id: document.cohort_id, ...item } : null;
}

export function isExperienceCohortRun(runId: string): boolean {
  return getExperienceCohort().cases.some((item) => item.run_id === runId);
}

export class ExperienceCohortAlreadyEnrolledError extends Error {}

export class ExperienceCohortIneligibleDatabaseError extends Error {
  constructor(public readonly databasePath: string) {
    super("临时或 QA 数据库不能登记正式前瞻体验样本");
  }
}

export function createExperienceCohortRun(
  definition: NonNullable<ReturnType<typeof getExperienceCohortCaseDefinition>>,
  packagePath?: string | null,
) {
  const database = getWorkbenchDatabaseIdentity();
  if (!database.cohort_eligible) {
    throw new ExperienceCohortIneligibleDatabaseError(database.path);
  }
  return withImmediateTransaction(() => {
    const existing = getExperienceCohort().cases.find((item) => item.case_id === definition.case_id)?.run_id;
    if (existing) throw new ExperienceCohortAlreadyEnrolledError(existing);
    return createRun(definition.question, "semiconductor", packagePath, {
      experienceCase: {
        cohortId: definition.cohort_id,
        caseId: definition.case_id,
        informationCutoff: String(definition.information_cutoff),
      },
    });
  });
}

export function getExperienceCohort(): ExperienceCohortReadModel {
  const document = cohortDocument();
  const db = getWorkbenchDb();
  const rows = db.prepare(`
    SELECT e.payload_json, r.id AS run_id, r.status AS run_status, r.updated_at
    FROM research_experience_events e
    JOIN research_runs r ON r.id = e.run_id
    WHERE e.event_type = 'run_created'
    ORDER BY e.occurred_at DESC
  `).all() as Array<{ payload_json: string; run_id: string; run_status: string; updated_at: string }>;
  const enrollmentByCase = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    try {
      const caseId = String(JSON.parse(row.payload_json || "{}").experience_case_id || "");
      if (caseId && !enrollmentByCase.has(caseId)) enrollmentByCase.set(caseId, row);
    } catch {
      // Unrelated append-only events must not break this read model.
    }
  }
  const measurementByCase = new Map<string, CohortCaseMeasurement>();
  const cases = document.primary_cases.map((item): ExperienceCohortCase => {
    const enrollment = enrollmentByCase.get(item.case_id);
    const status = !enrollment
      ? "planned"
      : enrollment.run_status === "complete"
        ? "completed"
        : enrollment.run_status === "draft"
          ? "enrolled"
          : "running";
    const runId = enrollment?.run_id || null;
    const experience = runId ? getResearchExperienceMetrics(runId) : null;
    const baseline = runId
      ? latestArtifactPayload(runId, "baseline", ["needs_review", "approved"])
      : undefined;
    const pairedQuality = runId
      ? parsePairedQualityMeasurement(latestArtifactPayload(runId, "evaluation", ["approved"])?.json_content || "")
      : null;
    const measurement: CohortCaseMeasurement = {
      case_id: item.case_id,
      status,
      run_id: runId,
      experience,
      paired_quality: pairedQuality,
    };
    measurementByCase.set(item.case_id, measurement);
    return {
      ...item,
      status,
      run_id: runId,
      run_updated_at: enrollment?.updated_at || null,
      progress: deriveExperienceCaseProgress({
        ...measurement,
        baseline_status: baseline?.status === "approved"
          ? "approved"
          : baseline?.status === "needs_review"
            ? "needs_review"
            : "missing",
      }),
    };
  });
  const completedCount = cases.filter((item) => item.status === "completed").length;
  const enrolledCount = cases.filter((item) => item.status !== "planned").length;
  const targetGate = Number(document.measurement_contract.target_setting_after_completed_cases || 8);
  const summary = computeExperienceCohortSummary(
    cases.map((item) => measurementByCase.get(item.case_id)!),
    targetGate,
  );
  return {
    cohort_id: document.cohort_id,
    title: document.title,
    target_gate: targetGate,
    completed_count: completedCount,
    enrolled_count: enrolledCount,
    baseline_ready: summary.analysis_ready,
    summary,
    cases,
  };
}
