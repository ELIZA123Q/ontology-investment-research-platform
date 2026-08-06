import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let db: typeof import("../storage/db");
let buildRunArchive: typeof import("../runner/run_archive").buildRunArchive;
let getArchiveFilePayload: typeof import("../runner/run_archive").getArchiveFilePayload;

beforeAll(async () => {
  db = await import("../storage/db");
  ({ buildRunArchive, getArchiveFilePayload } = await import("../runner/run_archive"));
});

describe("run_archive", () => {
  it("生成阶段档案和附加文件", () => {
    const run = db.createRun("归档测试", "semiconductor");
    db.createArtifact(run.id, "stage_01", { status: "approved", json_content: JSON.stringify({ normalized_question: "Q1" }), markdown_content: "# stage1" });
    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify({
        judgment_units: [],
        ontology_view_yaml: "schema_name: task_ontology_view\njudgment_units: []\n",
      }),
      markdown_content: "# 研究逻辑",
    });
    db.createArtifact(run.id, "stage_03", { status: "needs_review", json_content: JSON.stringify({ evidence_drafts: [] }) });
    db.createArtifact(run.id, "stage_04", { status: "approved", json_content: JSON.stringify({ judgments: [] }) });
    db.createArtifact(run.id, "stage_05", { status: "approved", json_content: JSON.stringify({ title: "报告" }), markdown_content: "# 报告" });

    const archive = buildRunArchive(run.id);
    expect(archive.files.some((f) => f.file_name === "01_task.yaml")).toBe(true);
    expect(archive.files.some((f) => f.file_name === "01-投研需求说明.md")).toBe(true);
    expect(archive.files.some((f) => f.file_name === "02-研究逻辑.md")).toBe(true);
    expect(archive.files.some((f) => f.file_name === "02-本体视图.yaml")).toBe(true);
    expect(archive.files.some((f) => f.file_name === "05-研究报告.md")).toBe(true);
    expect(archive.files.some((f) => f.file_name === "business_instance_graph.yaml")).toBe(true);

    const entry = archive.files.find((f) => f.file_name === "01_task.yaml");
    expect(entry).toBeDefined();
    const payload = getArchiveFilePayload(run.id, entry!.id);
    expect(payload.content).toContain("stage: \"01\"");
  });
});
