import { describe, expect, it } from "vitest";
import {
  ASSET_PATH_ALIASES,
  ontologyModelFileCandidates,
  ontologyModelRegistryCandidates,
  requireAssetPath,
  resolveAssetPath,
} from "../lib/asset_path";
import { ONTOLOGY_MODEL_REGISTRY_HIT, loadOntologyCatalog, resetOntologyCatalogForTests } from "../skills/ontology/catalog_loader";
import { loadKnowledge, resolveKnowledgeFile } from "../skills/method_selection/knowledge_loader";
import { loadRuntimeAssetCoverage } from "../runtime_asset_coverage";

describe("asset_path resolution", () => {
  it("resolves ontology model registry via primary→compat", () => {
    const resolved = requireAssetPath("01_semantic/01_ontology/model_registry.yaml", ontologyModelRegistryCandidates());
    expect(resolved.relativePath).toBe("01_semantic/01_ontology/model_registry.yaml");
    expect(resolved.hit).toBe("primary");
    expect(ONTOLOGY_MODEL_REGISTRY_HIT).toBe("primary");
  });

  it("resolves model yaml from ontology truth first", () => {
    const resolved = requireAssetPath("01_semantic/01_ontology/models/semantic.yaml", ontologyModelFileCandidates("semantic.yaml"));
    expect(resolved.relativePath).toBe("01_semantic/01_ontology/models/semantic.yaml");
    expect(resolved.hit).toBe("primary");
  });

  it("maps dictionary aliases to semantic primary when present", () => {
    const logical = "90_compat/ontology/01_通用/00_投研本体框架概述.md";
    expect(ASSET_PATH_ALIASES[logical]).toBeTruthy();
    const resolved = resolveAssetPath(logical);
    expect(resolved).toBeTruthy();
    expect(resolved!.hit).toBe("primary");
    expect(resolved!.relativePath).toContain("01_semantic/02_dictionary/");
  });

  it("catalog_loader still loads through resolver", () => {
    resetOntologyCatalogForTests();
    const catalog = loadOntologyCatalog();
    expect(catalog.object_types.size).toBeGreaterThan(0);
    expect(catalog.fingerprint.startsWith("sha256:")).toBe(true);
  });

  it("knowledge_loader reports resolution hits", () => {
    const hit = resolveKnowledgeFile("90_compat/ontology/01_通用/01_语义结构域规范.md");
    expect(hit?.hit).toBe("primary");
    expect(hit?.resolvedPath).toContain("01_semantic/02_dictionary/");
  });

  it("loadKnowledge includes resolutions audit for stage_02", () => {
    const packed = loadKnowledge("stage_02");
    expect(packed.resolutions?.length).toBeGreaterThan(0);
    expect(packed.files.length).toBeGreaterThan(5);
    expect(
      packed.files.some((f) => f.includes("dictionary") || f.includes("02_dictionary")),
    ).toBeTruthy();
  });

  it("coverage loader records resolved_from", () => {
    const coverage = loadRuntimeAssetCoverage();
    expect(coverage.resolved_from).toBe("05_governance/03_校验/runtime_asset_coverage.yaml");
    expect(coverage.resolved_hit).toBe("primary");
  });
});
