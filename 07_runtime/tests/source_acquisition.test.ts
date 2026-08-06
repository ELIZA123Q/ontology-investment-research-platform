import { describe, expect, it } from "vitest";
import { normalizeSourceAcquisitionInput } from "@/skills/evidence_evaluation/source_acquisition_input";

describe("source acquisition authority_type", () => {
  it("requires a non-unknown authority type", () => {
    expect(() => normalizeSourceAcquisitionInput({
      url: "https://example.com/report",
      title: "报告",
      publisher: "Example",
      published_at: "2026-01-01",
      source_tier: "S2",
      authority_type: "unknown",
      locator: "quote:库存下降超过10%",
      source_quote: "库存下降超过10%，符合逐字引用长度要求。",
    })).toThrow(/权威类型/);
  });

  it("normalizes a valid authority type", () => {
    const input = normalizeSourceAcquisitionInput({
      url: "https://example.com/report",
      title: "报告",
      publisher: "Example",
      published_at: "2026-01-01",
      source_tier: "S2",
      authority_type: "official",
      locator: "quote:库存下降超过10%",
      source_quote: "库存下降超过10%，符合逐字引用长度要求。",
    });
    expect(input.authority_type).toBe("official");
  });
});
