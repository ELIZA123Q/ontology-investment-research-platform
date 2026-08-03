import { describe, expect, it } from "vitest";
import { deriveRunProgress, projectRunStatus } from "@/engine/run_progress";

describe("run progress projection", () => {
  it("derives the visible stage from approved artifacts instead of stale caches", () => {
    const progress = deriveRunProgress(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
    expect(progress).toMatchObject({
      current_stage: 5,
      completed_stage_count: 5,
      contiguous_stage_count: 5,
      is_contiguous: true,
    });
    expect(projectRunStatus("in_progress", progress)).toBe("complete");
  });

  it("makes non-contiguous imported data explicit without inventing completions", () => {
    const progress = deriveRunProgress(["stage_01", "stage_05", "stage_05", "evaluation"]);
    expect(progress.current_stage).toBe(5);
    expect(progress.completed_stage_count).toBe(2);
    expect(progress.contiguous_stage_count).toBe(1);
    expect(progress.is_contiguous).toBe(false);
  });

  it("keeps archived lifecycle state while projecting stage progress", () => {
    const progress = deriveRunProgress(["stage_01", "stage_02"]);
    expect(projectRunStatus("archived", progress)).toBe("archived");
  });
});
