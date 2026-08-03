import { describe, expect, it } from "vitest";
import { resolveLegacyKnowledgeRoute } from "@/app/lib/knowledge-routes";

describe("knowledge route compatibility", () => {
  it("maps legacy task anchors and preserves the selected run", () => {
    expect(resolveLegacyKnowledgeRoute({ view: "task", runId: "run 1", hash: "#applications" })).toBe("/knowledge/task/applications?runId=run%201");
    expect(resolveLegacyKnowledgeRoute({ view: "task", runId: "run-2", hash: "#graphs" })).toBe("/knowledge/task/graph?runId=run-2");
  });
  it("maps legacy library anchors to real subpages", () => {
    expect(resolveLegacyKnowledgeRoute({ view: "library", hash: "#ontology-graph" })).toBe("/knowledge/library/map");
    expect(resolveLegacyKnowledgeRoute({ view: "library", hash: "#usage" })).toBe("/knowledge/library/usage");
    expect(resolveLegacyKnowledgeRoute({ view: "library", hash: "#quality" })).toBe("/knowledge/library/quality");
    expect(resolveLegacyKnowledgeRoute({ view: "library", hash: "#gaps" })).toBe("/knowledge/library/gaps");
  });
});
