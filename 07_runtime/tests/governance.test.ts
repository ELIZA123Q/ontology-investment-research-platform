import { describe, expect, it } from "vitest";
import { verifyArtifactWrite, verifyReportClaims, verifySourceReference, verifyUiSurface } from "@/src/governance/verifiers";

describe("deterministic governance", () => {
  it("prevents planned critic from rewriting judgment", () => {
    expect(verifyArtifactWrite("independent-critic", "judgment").passed).toBe(false);
    expect(verifyArtifactWrite("independent-critic", "review").passed).toBe(true);
  });

  it("does not support claims with uncaptured or unverified sources", () => {
    const source = { sourceId: "s1", uri: "https://example.test", title: "示例", capturedAt: new Date().toISOString(), locator: "", quote: "", contentHash: "", verification: "unverified" as const };
    expect(verifySourceReference(source).passed).toBe(false);
    expect(verifyReportClaims({ claims: [{ text: "结论", sourceIds: ["s1"] }] }, [source]).passed).toBe(false);
  });

  it("only accepts approved non-executable UI surfaces", () => {
    expect(verifyUiSurface({ id: "1", component: "judgment_card", title: "判断", data: { statement: "暂不可判断" }, editableFields: [] }).passed).toBe(true);
    expect(verifyUiSurface({ id: "2", component: "report_editor", title: "报告", data: { body: "<script>alert(1)</script>" }, editableFields: [] }).passed).toBe(false);
  });
});
