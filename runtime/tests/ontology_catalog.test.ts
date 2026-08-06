import { describe, expect, it } from "vitest";
import {
  activeOntologyObjects,
  activeOntologyRelations,
  loadOntologyCatalog,
  ontologyEnumValues,
} from "@/skills/ontology/catalog_loader";

describe("formal ontology catalog", () => {
  it("provides one typed runtime entry point for the formal ontology", () => {
    const catalog = loadOntologyCatalog();

    expect(catalog.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.object_types.get("JudgmentUnit")?.source_file).toBe(
      "ontology/01_通用/models/judgment.yaml",
    );
    expect(catalog.relation_types.get("judgmentResolvesUnit")?.source_types).toEqual(["Judgment"]);
    expect(catalog.rules.has("judgment_evidence_threshold")).toBe(true);
    expect(activeOntologyObjects().length).toBeGreaterThan(40);
    expect(activeOntologyRelations().length).toBeGreaterThan(80);
  });

  it("reads enum values from object attribute definitions", () => {
    expect(ontologyEnumValues("JudgmentUnit", "judgment_type")).toContain("cycle_phase");
    expect(ontologyEnumValues("SourceDocument", "source_tier")).toEqual([
      "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8",
    ]);
  });
});
