import { describe, expect, it } from "vitest";
import type { SourceReference } from "@/src/contracts/evidence";
import { deriveModelDataPolicy } from "@/src/providers/model-data-policy";

const source = (id: string, permissionScope?: SourceReference["permissionScope"]): SourceReference => ({
  sourceId: id, uri: `https://example.test/${id}`, title: id, capturedAt: "2026-08-11T00:00:00Z", locator: "p1", quote: "fact",
  contentHash: `sha256:${id}`, verification: "verified", permissionScope,
});

describe("model data egress policy", () => {
  it("allows public evidence, keeps authorized data private and blocks restricted or unscoped provenance", () => {
    expect(deriveModelDataPolicy([source("public", "public_research_use")], ["public"])).toBe("public");
    expect(deriveModelDataPolicy([source("licensed", "authorized_research_use")], ["licensed"])).toBe("private_authorized");
    expect(deriveModelDataPolicy([source("restricted", "restricted")], ["restricted"])).toBe("restricted_no_egress");
    expect(deriveModelDataPolicy([source("legacy")], ["legacy"])).toBe("restricted_no_egress");
    expect(deriveModelDataPolicy([source("public", "public_research_use")], ["missing"])).toBe("restricted_no_egress");
    expect(deriveModelDataPolicy([source("public", "public_research_use"), source("extra", "restricted")], ["public"])).toBe("restricted_no_egress");
  });
});
