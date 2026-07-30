import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/recompute-progress-test-${process.pid}.sqlite`;
process.env.WORKBENCH_EXPORT_ROOT = `/tmp/recompute-progress-test-exports-${process.pid}`;

let db: typeof import("@/adapters/db");

beforeAll(async () => {
  db = await import("@/adapters/db");
});

describe("recomputeRunProgress 进度重算", () => {
  it("以实际已批准 stage 为真相源：supersede 降级已批准产出时进度回退", () => {
    const run = db.createRun("进度重算-基础", "semiconductor");

    // stage_01 批准 -> 1/in_progress
    db.createArtifact(run.id, "stage_01", { status: "approved" });
    db.recomputeRunProgress(run.id);
    let r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(1);
    expect(r.status).toBe("in_progress");

    // stage_05 批准 -> 推进到 5/complete
    const s5 = db.createArtifact(run.id, "stage_05", { status: "approved" });
    db.recomputeRunProgress(run.id);
    r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(5);
    expect(r.status).toBe("complete");

    // 模拟 stage_05 被取代降级（无新批准版本）
    db.updateArtifact(s5.id, { status: "superseded" });
    db.recomputeRunProgress(run.id);
    r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(1);
    expect(r.status).toBe("in_progress");
  });

  it("approveArtifact 推进进度；supersedeOtherArtifactAttempts 降级时回退", () => {
    const run = db.createRun("进度重算-挂点", "semiconductor");

    const a1 = db.createArtifact(run.id, "stage_01", { status: "needs_review" });
    db.approveArtifact(a1);
    let r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(1);
    expect(r.status).toBe("in_progress");

    const a5 = db.createArtifact(run.id, "stage_05", { status: "needs_review" });
    db.approveArtifact(a5);
    r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(5);
    expect(r.status).toBe("complete");

    // 新增一个未批准的 stage_05 版本并取代旧版 -> 旧版降级，进度回退
    const a5b = db.createArtifact(run.id, "stage_05", { status: "needs_review" });
    db.supersedeOtherArtifactAttempts(run.id, "stage_05", a5b.id);
    r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(1);
    expect(r.status).toBe("in_progress");
  });

  it("无已批准产出时保持原状态（不误改草稿）", () => {
    const run = db.createRun("进度重算-草稿", "semiconductor");
    db.recomputeRunProgress(run.id);
    const r = db.getRun(run.id)!;
    expect(r.current_stage).toBe(0);
    expect(r.status).toBe("draft");
  });
});
