import { describe, expect, it } from "vitest";
import { publishStatusLabel, researchJobStatusLabel, runStatusLabel } from "@/app/lib/ui-labels";

describe("researcher-facing status labels", () => {
  it("does not expose persisted workflow enums", () => {
    expect(runStatusLabel("in_progress")).toBe("进行中");
    expect(researchJobStatusLabel("waiting_for_input")).toBe("等待补充输入");
    expect(publishStatusLabel("workbench_only")).toBe("仅工作台运行");
    expect(publishStatusLabel("workbench_export_only")).toBe("仅工作台导出");
  });
});
