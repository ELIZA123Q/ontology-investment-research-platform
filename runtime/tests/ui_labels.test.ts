import { describe, expect, it } from "vitest";
import {
  differenceCauseLabel,
  latestJobPerRun,
  latestJobForStage,
  evidenceKindLabel,
  publishStatusLabel,
  researchJobIssueMessage,
  researchJobRecoveryHref,
  researchJobStatusLabel,
  runStatusLabel,
  sourceTierLabel,
} from "@/app/lib/ui-labels";

describe("researcher-facing status labels", () => {
  it("does not expose persisted workflow enums", () => {
    expect(runStatusLabel("in_progress")).toBe("进行中");
    expect(researchJobStatusLabel("waiting_for_input")).toBe("等待补充输入");
    expect(publishStatusLabel("workbench_only")).toBe("仅工作台运行");
    expect(publishStatusLabel("workbench_export_only")).toBe("仅工作台导出");
  });

  it("turns technical job failures into an actionable recovery path", () => {
    expect(researchJobIssueMessage("402 Insufficient Balance")).toContain("模型服务额度暂时不足");
    expect(researchJobIssueMessage("DeepSeek 未提交合法结构化结果；invalid_type")).not.toMatch(/DeepSeek|invalid_type/);
    expect(researchJobRecoveryHref("run-1", "stage_04")).toBe("/runs/run-1/stages/4");
  });

  it("uses research language for provenance and change attribution", () => {
    expect(evidenceKindLabel("source_claim")).toBe("来源事实");
    expect(sourceTierLabel("S2")).toBe("高权威来源");
    expect(sourceTierLabel("S5")).toBe("可用公开来源");
    expect(sourceTierLabel("S8")).toBe("低权威线索");
    expect(differenceCauseLabel("evidence_change")).toBe("证据变化");
  });

  it("counts one active item per research instead of historical jobs", () => {
    expect(latestJobPerRun([
      { run_id: "a", updated_at: "2026-07-26T10:00:00Z", id: "old" },
      { run_id: "b", updated_at: "2026-07-26T11:00:00Z", id: "b" },
      { run_id: "a", updated_at: "2026-07-26T12:00:00Z", id: "new" },
    ])).toEqual([
      { run_id: "a", updated_at: "2026-07-26T12:00:00Z", id: "new" },
      { run_id: "b", updated_at: "2026-07-26T11:00:00Z", id: "b" },
    ]);
    expect(latestJobForStage([
      { stage: "stage_03", created_at: "2026-07-26T10:00:00Z", status: "blocked" },
      { stage: "stage_03", created_at: "2026-07-26T12:00:00Z", status: "waiting_for_review" },
    ], "stage_03")?.status).toBe("waiting_for_review");
  });
});
