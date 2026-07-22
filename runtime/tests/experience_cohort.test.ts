import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-experience-cohort-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let cohort: typeof import("@/adapters/experience_cohort");

beforeAll(async () => {
  db = await import("@/adapters/db");
  cohort = await import("@/adapters/experience_cohort");
});

describe("prospective experience cohort", () => {
  it("loads ten planned cases and an eight-case target gate", () => {
    expect(db.getWorkbenchDatabaseIdentity()).toMatchObject({
      scope: "temporary",
      cohort_eligible: false,
    });
    const model = cohort.getExperienceCohort();
    expect(model.cases).toHaveLength(10);
    expect(model.target_gate).toBe(8);
    expect(model.completed_count).toBe(0);
    expect(model.baseline_ready).toBe(false);
    expect(model.summary.analysis_ready_count).toBe(0);
    expect(model.summary.workflow_gain_claim_status).toBe("insufficient_sample");
    expect(model.cases[0].progress.state).toBe("not_started");
    expect(model.cases[0].progress.destination).toBe("new_run");
  });

  it("binds a newly created run through the append-only creation event", () => {
    const definition = cohort.getExperienceCohortCaseDefinition("RXB-S01")!;
    const run = db.createRun(definition.question, "semiconductor", null, {
      experienceCase: {
        cohortId: definition.cohort_id,
        caseId: definition.case_id,
        informationCutoff: String(definition.information_cutoff),
      },
    });
    const event = db.listResearchExperienceEvents(run.id).find((item) => item.event_type === "run_created")!;
    expect(JSON.parse(event.payload_json)).toMatchObject({
      experience_cohort_id: "RXB-SEMI-20260722",
      experience_case_id: "RXB-S01",
      information_cutoff: "2025-01-16",
    });
    const enrolled = cohort.getExperienceCohort().cases.find((item) => item.case_id === "RXB-S01")!;
    expect(enrolled.status).toBe("enrolled");
    expect(enrolled.run_id).toBe(run.id);
    expect(enrolled.progress.state).toBe("research_in_progress");
    expect(enrolled.progress.destination).toBe("run");
    expect(cohort.getExperienceCohort().summary.measured_completed_count).toBe(0);
  });

  it("rejects formal cohort enrollment on a temporary QA database", () => {
    const definition = cohort.getExperienceCohortCaseDefinition("RXB-S02")!;
    expect(() => cohort.createExperienceCohortRun(definition)).toThrow(cohort.ExperienceCohortIneligibleDatabaseError);
  });
});
