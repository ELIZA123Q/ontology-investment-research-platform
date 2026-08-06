import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { repositoryPath } from "@/storage/repo_paths";
import {
  ONTOLOGY_CONFIDENCE_LEVELS,
  ONTOLOGY_ENUMS,
  ONTOLOGY_JUDGMENT_LEVELS,
  ONTOLOGY_JUDGMENT_TYPES,
  ONTOLOGY_SOURCE_TIERS,
} from "@/skills/ontology/vocabulary";

function ontologyModel(file: string) {
  return YAML.parse(
    readFileSync(repositoryPath("01_semantic", "01_ontology", "models", file), "utf8"),
  ) as Record<string, any>;
}

function allowedValues(model: Record<string, any>, objectType: string, attribute: string) {
  return model.object_types?.[objectType]?.attributes?.[attribute]?.allowed_values || [];
}

describe("client-safe ontology vocabulary projection", () => {
  it("projects every formal object enum without a parallel Runtime vocabulary", () => {
    const actual: Record<string, string[]> = {};
    for (const file of [
      "semantic.yaml",
      "state_event.yaml",
      "evidence.yaml",
      "judgment.yaml",
      "scenario.yaml",
      "semiconductor_extension.yaml",
    ]) {
      const document = ontologyModel(file);
      for (const [objectType, definition] of Object.entries<any>(document.object_types || {})) {
        for (const [attribute, field] of Object.entries<any>(definition.attributes || definition.properties || {})) {
          if (field?.type === "enum" && Array.isArray(field.allowed_values) && field.allowed_values.length) {
            actual[`${objectType}.${attribute}`] = field.allowed_values;
          }
        }
      }
    }
    expect(ONTOLOGY_ENUMS).toEqual(actual);
  });

  it("does not drift from formal ontology enum authorities", () => {
    const judgment = ontologyModel("judgment.yaml");
    const evidence = ontologyModel("evidence.yaml");

    expect([...ONTOLOGY_JUDGMENT_TYPES]).toEqual(allowedValues(judgment, "JudgmentUnit", "judgment_type"));
    expect([...ONTOLOGY_JUDGMENT_LEVELS]).toEqual(allowedValues(judgment, "Judgment", "level"));
    expect([...ONTOLOGY_CONFIDENCE_LEVELS]).toEqual(allowedValues(judgment, "Judgment", "confidence"));
    expect([...ONTOLOGY_SOURCE_TIERS]).toEqual(allowedValues(evidence, "SourceDocument", "source_tier"));
  });
});
