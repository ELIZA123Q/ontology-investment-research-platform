import { describe, it } from "vitest";
import { loadLibraryKnowledgePage, loadTaskKnowledgePage } from "@/app/lib/knowledge-page-data";

describe("diag knowledge pages", () => {
  it("library page load", () => {
    try {
      const d = loadLibraryKnowledgePage();
      console.log("LIBRARY OK", {
        object_types: d.catalog?.object_types?.size,
        nodes: d.fullOntologyGraph?.nodes?.length,
        edges: d.fullOntologyGraph?.edges?.length,
        heatNodes: d.heatGraph?.nodes?.length,
        gapNodes: d.gapGraph?.nodes?.length,
        runs: d.runs?.length,
      });
    } catch (e) {
      console.error("LIBRARY ERROR >>>", (e as Error).stack || e);
      throw e;
    }
  });
  it("task page load", () => {
    try {
      const d = loadTaskKnowledgePage("3f15bd4a-3662-4183-a5c8-e3336f98565c");
      console.log("TASK OK", {
        hasDashboard: Boolean(d.dashboard),
        runs: d.runs?.length,
        ontologyNodes: d.ontologyNodes?.length,
      });
    } catch (e) {
      console.error("TASK ERROR >>>", (e as Error).stack || e);
      throw e;
    }
  });
});
