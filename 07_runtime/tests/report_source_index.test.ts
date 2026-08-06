import { describe, expect, it } from "vitest";
import {
  appendReportClaimSourceIndex,
  buildReportClaimSourceIndex,
} from "../report_source_index";

const sources = [
  {
    id: "SRC-1",
    title: "Company filing",
    publisher: "Issuer",
    published_at: "2026-07-01T00:00:00.000Z",
    url: "https://example.com/filing",
  },
  {
    id: "SRC-2",
    title: "Industry data",
    publisher: "Provider",
    published_at: "2026-07-02",
    url: "https://example.com/data",
  },
];

describe("report claim source index", () => {
  it("maps each reader-facing claim to deduplicated bound sources", () => {
    const index = buildReportClaimSourceIndex({
      report_claims: [{
        statement: "价格改善主要由供给约束驱动",
        source_ids: ["SRC-1", "SRC-1", "SRC-2"],
      }],
    }, sources);
    expect(index).toEqual([{
      statement: "价格改善主要由供给约束驱动",
      sources: [
        expect.objectContaining({ id: "SRC-1", publisher: "Issuer", publishedAt: "2026-07-01" }),
        expect.objectContaining({ id: "SRC-2", publisher: "Provider", publishedAt: "2026-07-02" }),
      ],
    }]);
  });

  it("appends a readable source index once", () => {
    const report = appendReportClaimSourceIndex("# 研究报告\n\n正文。", {
      report_claims: [{ statement: "库存下降", source_ids: ["SRC-1"] }],
    }, sources);
    expect(report).toContain("## 核心主张来源索引");
    expect(report).toContain("[Company filing](https://example.com/filing)");
    expect(appendReportClaimSourceIndex(report, {
      report_claims: [{ statement: "库存下降", source_ids: ["SRC-1"] }],
    }, sources)).toBe(report);
  });
});
