import { describe, expect, it } from "vitest";
import { projectResearchCaseSnapshotForDsh } from "@/src/dsh/model-visible-projection";

const source = (permissionScope: "public_research_use" | "restricted") => ({
  sourceId: `source:${permissionScope}`, uri: "https://example.test/source", title: "Source", capturedAt: "2026-08-17T00:00:00.000Z",
  locator: "p. 1", quote: "raw source excerpt", contentHash: "sha256:source", verification: "verified" as const, permissionScope,
});

describe("DSH model-visible projection", () => {
  it("withholds artifacts carrying restricted provenance before they reach the external DSH model", () => {
    const projection = projectResearchCaseSnapshotForDsh({
      runtime: {
        messages: [{ content: "must not leak" }], events: [{ payload: "must not leak" }],
        artifacts: [{
          id: "artifact-1", conversationId: "conversation-1", taskId: "task-1", kind: "evidence_package", title: "restricted", version: 1,
          status: "verified" as const, data: { raw: "secret" }, sourceRefs: [source("restricted")], createdBy: "system", createdAt: "2026-08-17T00:00:00.000Z",
        }],
      },
    });

    expect(projection.runtime).not.toHaveProperty("messages");
    expect(projection.runtime).not.toHaveProperty("events");
    expect(projection.runtime.artifacts[0]).toMatchObject({
      modelDataPolicy: "restricted_no_egress", sourceRefs: [], data: { withheld: true },
    });
  });

  it("preserves public evidence for the DSH model", () => {
    const projection = projectResearchCaseSnapshotForDsh({
      runtime: {
        artifacts: [{
          id: "artifact-2", conversationId: "conversation-1", taskId: "task-1", kind: "evidence_package", title: "public", version: 1,
          status: "verified" as const, data: { fact: "public" }, sourceRefs: [source("public_research_use")], createdBy: "system", createdAt: "2026-08-17T00:00:00.000Z",
        }],
      },
    });

    expect(projection.runtime.artifacts[0]).toMatchObject({ modelDataPolicy: "public", data: { fact: "public" } });
  });
});
