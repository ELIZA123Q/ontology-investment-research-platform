import { describe, expect, it } from "vitest";
import { buildEventGroups } from "@/app/components/radar-dashboard";
import { packageLabel } from "@/app/components/new-run-form";

describe("researcher entry journey", () => {
  it("merges bilingual versions of one market event without hiding unrelated events", () => {
    const shared = {
      publisher: "TrendForce",
      published_at: "2026-07-21T00:00:00.000Z",
      occurred_at: null,
      discovered_at: "2026-07-21T00:00:00.000Z",
      event_type: "market_update",
    };
    const groups = buildEventGroups([
      {
        ...shared,
        id: "event-zh",
        title: "16GB DDR4 二手价格较高点下跌超过30%",
        candidate_labels: ["DDR4", "DRAM现货价", "二手内存"],
      },
      {
        ...shared,
        id: "event-en",
        title: "16GB DDR4 Second-Hand Price Falls Over 30% From Peak",
        candidate_labels: ["DDR4", "中国内存市场", "DRAM现货"],
      },
      {
        ...shared,
        id: "event-nand",
        title: "NAND Flash供给增速将领先需求",
        candidate_labels: ["NAND Flash", "NAND供需"],
      },
    ] as any);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.ids).toEqual(["event-zh", "event-en"]);
    expect(groups[1]?.ids).toEqual(["event-nand"]);
  });

  it("shows preset research examples as researcher concepts rather than file paths", () => {
    expect(packageLabel("90_compat/instances/02_V3样例/01_memory-cycle-run-002")).toBe("存储周期研究样例");
    expect(packageLabel("90_compat/instances/02_V3样例/02_us-controls-localization-run-002"))
      .toBe("出口管制与国产替代研究样例");
  });
});
