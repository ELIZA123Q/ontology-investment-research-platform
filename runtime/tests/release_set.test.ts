import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let createRun: typeof import("@/storage/db").createRun;
let createArtifact: typeof import("@/storage/db").createArtifact;
let buildKnowledgeLock: typeof import("@/export/release_set").buildKnowledgeLock;
let buildKnowledgePackage: typeof import("@/skills/method_selection/knowledge_package").buildKnowledgePackage;

beforeAll(async () => {
  ({ createRun, createArtifact } = await import("@/storage/db"));
  ({ buildKnowledgeLock } = await import("@/export/release_set"));
  ({ buildKnowledgePackage } = await import("@/skills/method_selection/knowledge_package"));
});

function methodApplication(capability: "judgment_structure" | "evidence" | "adjudication") {
  const identity = capability === "judgment_structure"
    ? ["BF-SD-01", "2.0.0"]
    : capability === "evidence"
      ? ["kb03:A03", "3.2.0"]
      : ["kb04:A03", "1.0.0"];
  return {
    application_id: `MA-${capability}`,
    method_id: identity[0],
    method_version: identity[1],
    capability_type: capability,
    target_question_refs: [], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: ["StateVariable"],
    status: capability === "adjudication" ? "executed" : "selected",
    precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [],
    execution_summary: "", applicability_boundary: "", limitations: [], counter_example_refs: [],
    provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null }, alternatives: [],
  };
}

describe("release knowledge binding", () => {
  it("locks exact reusable knowledge identities without embedding research results", () => {
    const run = createRun("未来六个月存储价格是否进入周期改善阶段？", "semiconductor");
    const methods = [methodApplication("judgment_structure"), methodApplication("evidence"), methodApplication("adjudication")];
    createArtifact(run.id, "stage_01", { status: "approved", json_content: JSON.stringify({ task_id: `JTASK-${run.id}` }) });
    createArtifact(run.id, "stage_02", { status: "approved", json_content: JSON.stringify({
      judgment_units: [{ id: "JU-1", ontology_node_ids: ["StateVariable"] }],
      variables: [{ id: "V-1", ontology_node_id: "StateVariable" }], method_applications: methods,
    }), input_context: JSON.stringify({ injected_assets: { knowledge_files: ["knowledge/frameworks/README.md"] } }) });
    createArtifact(run.id, "stage_03", { status: "approved", json_content: JSON.stringify({ method_applications: methods }) });
    createArtifact(run.id, "stage_04", { status: "approved", json_content: JSON.stringify({ method_applications: methods }) });
    createArtifact(run.id, "stage_05", { status: "approved", json_content: JSON.stringify({}) });

    const task = buildKnowledgePackage(run.id, new Date("2026-08-01T00:00:00Z"));
    const lock = buildKnowledgeLock(run.id, "REL-TEST");
    expect(task.package_kind).toBe("knowledge_task_slice");
    expect(task.manifest.run_context?.question).toContain("周期改善");
    expect(task.manifest.excludes).toEqual(expect.arrayContaining(["evidence_snapshots", "judgments", "research_report"]));
    expect(task.files.some((file) => /report|evidence_snapshot/i.test(file.file_name))).toBe(false);
    expect(lock.release_id).toBe("REL-TEST");
    expect(lock.task_slice.fingerprint).toBe(task.fingerprint);
    expect(lock.used_methods.map((item) => item.method_id)).toEqual(expect.arrayContaining(["BF-SD-01", "kb03:A03", "kb04:A03"]));
    expect(lock.injected_knowledge_by_stage.stage_02).toContain("knowledge/frameworks/README.md");
  });
});
