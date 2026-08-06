import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  affectedRunsByOntologyFingerprint,
  analyzeOntologyImpact,
  buildOntologySemanticManifest,
  loadOntologyConsumers,
} from "@/skills/ontology/impact";
import type { Artifact } from "@/schemas/types";

describe("ontology change impact analysis", () => {
  it("maps a semantic element change to declared consumers and checks", () => {
    const current = buildOntologySemanticManifest();
    const previous = structuredClone(current);
    const sourceKey = Object.keys(previous.elements).find((key) => key.endsWith(":SourceDocument"))!;
    previous.ontology_fingerprint = "sha256:previous";
    previous.elements[sourceKey].signature = "sha256:old-source-contract";
    const report = analyzeOntologyImpact(previous, current);
    expect(report.changed).toBe(true);
    expect(report.changes).toContainEqual(expect.objectContaining({
      id: "SourceDocument",
      section: "object_types",
      kind: "changed",
    }));
    expect(report.affected_consumers.map((consumer) => consumer.id)).toEqual(expect.arrayContaining([
      "runtime_semantic_catalog",
      "runtime_schema_and_ui_vocabulary",
      "instance_graph_contract_and_materializer",
      "external_data_mapping_profiles",
    ]));
    expect(report.required_checks).toEqual(expect.arrayContaining([
      "ontology:check",
      "test:data_mapping_profiles",
      "validate_v3",
    ]));
  });

  it("registers every consumer with watched sections, paths, and verification gates", () => {
    for (const consumer of loadOntologyConsumers()) {
      expect(consumer.watches.length).toBeGreaterThan(0);
      expect(consumer.paths.length).toBeGreaterThan(0);
      expect(consumer.required_checks.length).toBeGreaterThan(0);
    }
  });

  it("identifies stored runs whose semantic envelopes use an older ontology fingerprint", () => {
    const artifact = (runId: string, id: string, fingerprint: string): Artifact => ({
      id,
      run_id: runId,
      kind: "stage_02",
      version: 1,
      status: "approved",
      json_content: JSON.stringify({ semantic_context: { ontology_fingerprint: fingerprint } }),
      markdown_content: "",
      model_name: null,
      prompt_version: "",
      knowledge_version: "",
      input_context: "",
      raw_model_output: "",
      response_id: null,
      token_usage: "{}",
      tool_usage: "{}",
      error_message: null,
      created_at: "",
      approved_at: "",
    });
    expect(affectedRunsByOntologyFingerprint([
      artifact("RUN-OLD", "A-1", "sha256:old"),
      artifact("RUN-CURRENT", "A-2", "sha256:current"),
    ], "sha256:current")).toEqual([{
      run_id: "RUN-OLD",
      artifact_ids: ["A-1"],
      ontology_fingerprints: ["sha256:old"],
    }]);
  });
});
