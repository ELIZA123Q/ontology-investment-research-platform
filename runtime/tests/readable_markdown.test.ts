import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-readable-${process.pid}.sqlite`;
process.env.WORKBENCH_EXPORT_ROOT = `/tmp/ontology-workbench-readable-exports-${process.pid}`;

let db: typeof import("@/adapters/db");
let workflow: typeof import("@/engine/workflow");

beforeAll(async () => {
  db = await import("@/adapters/db");
  workflow = await import("@/engine/workflow");
});

describe("save structured JSON rewrites readable markdown", () => {
  it("rebuilds stage_02 readable draft from edited JSON", () => {
    const run = db.createRun("保存后重写可读稿", "semiconductor");
    const baseMa = {
      target_question_refs: ["Q-1"],
      target_judgment_unit_refs: ["JU-1"],
      target_ontology_object_refs: [],
      status: "candidate",
      precondition_checks: [],
      input_evidence_refs: [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      applicability_boundary: "库存观察",
      limitations: [],
      counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
      alternatives: [],
    } as const;
    const data: any = {
      method_applications: [
        { ...baseMa, application_id: "MA-STRUCT", method_id: "BF-FQ-01", method_version: "2.0.0", capability_type: "judgment_structure" },
        { ...baseMa, application_id: "MA-EVIDENCE", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence" },
        { ...baseMa, application_id: "MA-ADJ", method_id: "kb04:A02", method_version: "1.0.0", capability_type: "adjudication" },
      ],
      research_scope: { id: "SCOPE-1", label: "存储库存观察", dimensions: {} },
      judgment_units: [{
        id: "JU-1",
        title: "库存方向",
        question: "库存是否下降？",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE-1",
        evidence_requirements: ["官方口径库存"],
        ontology_node_ids: [],
      }],
      variables: [{
        id: "inventory",
        name: "inventory",
        category: "inventory",
        definition: "同口径库存",
        variable_kind: "observed",
        anchors: ["官方披露"],
        ontology_node_id: "task_local:inventory",
        role: "target",
      }],
      paths: [],
      counter_evidence_directions: ["库存回升"],
      competing_explanations: ["季节性波动"],
      document_markdown: "# 旧稿\n\n这段应被覆盖。请保存后按最新结构化内容重写可读稿，不要保留旧文。",
    };
    const artifact = db.createArtifact(run.id, "stage_02", {
      status: "needs_review",
      json_content: JSON.stringify(data),
      markdown_content: data.document_markdown,
    });

    data.judgment_units[0].title = "库存是否转向平衡";
    data.judgment_units[0].question = "未来两季库存是否由过剩转向平衡？";
    const saved = workflow.editArtifact(artifact.id, JSON.stringify(data), "客户端传来的旧可读稿应被忽略");

    expect(saved.markdown_content).toContain("库存是否转向平衡");
    expect(saved.markdown_content).toContain("未来两季库存是否由过剩转向平衡？");
    expect(saved.markdown_content).toContain("库存回升");
    expect(saved.markdown_content).not.toContain("这段应被覆盖");
    expect(saved.markdown_content).not.toContain("客户端传来的旧可读稿应被忽略");
    const parsed = JSON.parse(saved.json_content);
    expect(parsed.document_markdown).toBe(saved.markdown_content);
  });
});
