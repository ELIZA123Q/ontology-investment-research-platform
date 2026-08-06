import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  dataMappingProfileForConnector,
  loadDataMappingRegistry,
} from "@/skills/financial_data/data_mapping";

describe("ontology data mapping profiles", () => {
  it("registers every wired evidence connector against active ontology targets", () => {
    const registry = loadDataMappingRegistry();
    expect(registry.schema_version).toBe("1.1.0");
    expect(registry.required_connectors).toHaveLength(18);
    expect(registry.profiles.map((profile) => profile.connector).sort())
      .toEqual([...registry.required_connectors].sort());
    expect(dataMappingProfileForConnector("cninfo")).toMatchObject({
      id: "cninfo_source_document",
      version: "1.0.0",
      target_mappings: [expect.objectContaining({ target_type: "SourceDocument" })],
      forbidden_direct_targets: expect.arrayContaining(["EvidenceFact", "Judgment"]),
    });
    expect(dataMappingProfileForConnector("datayes-stock-finoper-mcp")?.target_mappings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ target_type: "Observation", materialization: "requires_context" }),
        expect.objectContaining({ target_type: "SourceDocument", materialization: "requires_context" }),
      ]));
    expect(dataMappingProfileForConnector("china-policy")?.target_mappings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ target_type: "Event", materialization: "requires_context" }),
      ]));
    expect(dataMappingProfileForConnector("datayes-macro-mcp")?.target_mappings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ target_type: "Observation", materialization: "requires_context" }),
      ]));
    expect(dataMappingProfileForConnector("htsc_research_mcp")?.forbidden_direct_targets)
      .toEqual(expect.arrayContaining(["EvidenceFact", "Judgment"]));
  });

  it("requires mapping identity and field lineage in connector provenance", () => {
    expect(loadDataMappingRegistry().required_provenance_fields).toEqual(expect.arrayContaining([
      "mapping_profile_id",
      "mapping_profile_version",
      "response_fingerprint",
      "field_lineage_note",
    ]));
  });
});
