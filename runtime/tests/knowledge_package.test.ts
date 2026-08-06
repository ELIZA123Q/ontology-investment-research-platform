import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let buildKnowledgePackage: typeof import("@/skills/method_selection/knowledge_package").buildKnowledgePackage;
let validateKnowledgePackageFiles: typeof import("@/skills/method_selection/knowledge_package").validateKnowledgePackageFiles;
let db: typeof import("@/storage/db");

beforeAll(async () => {
  ({ buildKnowledgePackage, validateKnowledgePackageFiles } = await import("@/skills/method_selection/knowledge_package"));
  db = await import("@/storage/db");
});

describe("portable knowledge package", () => {
  it("exports a self-describing formal baseline with checksums and no research payload", () => {
    const bundle = buildKnowledgePackage(null, new Date("2026-08-01T00:00:00.000Z"));
    const names = bundle.files.map((file) => file.file_name);
    expect(bundle.scope).toBe("formal_baseline");
    expect(bundle.package_kind).toBe("knowledge_baseline");
    expect(names).toContain("manifest.json");
    expect(names).toContain("catalog/formal-ontology-catalog.json");
    expect(names).toContain("catalog/research-method-catalog.json");
    expect(names).toContain("catalog/data-mapping-registry.json");
    expect(names.some((name) => name.startsWith("ontology/models/") && name.endsWith(".yaml"))).toBe(true);
    expect(names).toContain("governance/05_元治理本体/method_assets.yaml");
    expect(names).not.toContain("context/task-local-ontology.json");
    const manifest = JSON.parse(bundle.files.find((file) => file.file_name === "manifest.json")!.content);
    expect(manifest.schema_name).toBe("portable_research_knowledge_manifest");
    expect(manifest.contents.methods).toBe(43);
    expect(manifest.excludes).toEqual(expect.arrayContaining(["research_report", "judgments", "credentials"]));
    expect(Object.keys(manifest.checksums).length).toBeGreaterThan(2);
    const result = validateKnowledgePackageFiles(new Map(bundle.files.map((file) => [file.file_name, file.content])));
    expect(result.ok).toBe(true);
  });

  it("exports task-local ontology only in a task slice with explicit authority and provenance", () => {
    const run = db.createRun(`任务知识包-${crypto.randomUUID()}`, "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify({
        variables: [{
          id: "VAR-LOCAL",
          name: "任务局部折旧节奏",
          category: "cost",
          variable_kind: "observed",
          definition: "只在本研究中使用的折旧节奏定义",
          anchors: ["Company"],
          ontology_node_id: "task_local:VAR-LOCAL",
        }],
      }),
    });
    const bundle = buildKnowledgePackage(run.id, new Date("2026-08-01T00:00:00.000Z"));
    expect(bundle.scope).toBe("run_context");
    expect(bundle.manifest.schema_version).toBe("1.1.0");
    expect(bundle.manifest.contents.task_local_ontology).toBe(1);
    const local = JSON.parse(bundle.files.find((file) => file.file_name === "context/task-local-ontology.json")!.content);
    expect(local.candidates).toEqual([expect.objectContaining({
      authority: "task_local",
      source_artifact_id: artifact.id,
      source_artifact_status: "approved",
      used_at: ["stage_02"],
    })]);
    expect(validateKnowledgePackageFiles(new Map(bundle.files.map((file) => [file.file_name, file.content]))).ok).toBe(true);
  });

  it("rejects a modified knowledge payload and non-knowledge manifests", () => {
    const bundle = buildKnowledgePackage(null, new Date("2026-08-01T00:00:00.000Z"));
    const files = new Map(bundle.files.map((file) => [file.file_name, file.content]));
    files.set("catalog/research-method-catalog.json", "{}\n");
    expect(validateKnowledgePackageFiles(files).ok).toBe(false);

    const invalid = new Map([["manifest.json", JSON.stringify({
      schema_name: "formal_research_delivery_manifest",
      schema_version: "1.0.0",
      package_kind: "formal_delivery_pack",
    })]]);
    expect(() => validateKnowledgePackageFiles(invalid)).toThrow(/manifest schema|不允许/);
  });
});
