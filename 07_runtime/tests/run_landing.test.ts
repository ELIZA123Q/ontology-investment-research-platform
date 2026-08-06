import { describe, expect, it } from "vitest";
import { resolveRunLanding } from "@/runner/run_landing";
import { deriveRunProgress } from "@/runner/run_progress";

const base = {
  runId: "run-1",
  progress: deriveRunProgress([]),
  artifacts: [] as any[],
  workItems: [] as any[],
  jobs: [] as any[],
  deliveryReady: false,
};

describe("run landing", () => {
  it("routes an unfinished run directly to its next stage", () => {
    expect(resolveRunLanding({ ...base, progress: deriveRunProgress(["stage_01", "stage_02"]) })).toMatchObject({
      kind: "stage_review", stage: "stage_03", href: "/runs/run-1/evidence",
    });
  });

  it("prioritizes an explicit rework item over a running job", () => {
    const state = resolveRunLanding({
      ...base,
      workItems: [{ stage: "stage_02", status: "rework", priority: "high", created_at: "2026-08-01T00:00:00Z" }],
      jobs: [{ stage: "stage_03", status: "running", created_at: "2026-08-01T01:00:00Z" }] as any,
    });
    expect(state).toMatchObject({ kind: "stage_review", stage: "stage_02", href: "/runs/run-1/structure" });
  });

  it("shows the summary only when all delivery conditions are ready", () => {
    const progress = deriveRunProgress(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
    expect(resolveRunLanding({ ...base, progress, deliveryReady: false }).kind).toBe("delivery_gate");
    expect(resolveRunLanding({ ...base, progress, deliveryReady: true }).kind).toBe("summary");
  });

  it("ignores a stale blocked job when the same stage has a newer approved artifact", () => {
    const progress = deriveRunProgress(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
    const state = resolveRunLanding({
      ...base,
      progress,
      deliveryReady: true,
      artifacts: [{ kind: "stage_02", status: "approved", created_at: "2026-08-01T02:00:00Z", approved_at: "2026-08-01T02:00:00Z" }],
      jobs: [{ stage: "stage_02", status: "blocked", created_at: "2026-08-01T01:00:00Z", updated_at: "2026-08-01T01:00:00Z" }] as any,
    });
    expect(state.kind).toBe("summary");
  });
});
