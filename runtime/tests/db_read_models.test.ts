import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-read-models-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let read: typeof import("@/adapters/db_read_models");

beforeAll(async () => {
  db = await import("@/adapters/db");
  read = await import("@/adapters/db_read_models");
});

describe("db_read_models", () => {
  it("latestArtifactPayload omits raw model dumps", () => {
    const run = db.createRun("瘦身读取", "semiconductor");
    db.createArtifact(run.id, "stage_01", {
      status: "needs_review",
      json_content: JSON.stringify({ core_object: "X" }),
      markdown_content: "# scope",
      raw_model_output: "HUGE RAW",
      input_context: "HUGE CONTEXT",
      token_usage: JSON.stringify({ total: 99 }),
    });
    const payload = read.latestArtifactPayload(run.id, "stage_01");
    expect(payload?.json_content).toContain("core_object");
    expect(payload?.markdown_content).toBe("# scope");
    expect(payload).not.toHaveProperty("raw_model_output");
    expect(payload).not.toHaveProperty("input_context");
    expect(payload).not.toHaveProperty("token_usage");
  });

  it("listSourcesForReview omits snapshot_text", () => {
    const run = db.createRun("来源瘦身", "semiconductor");
    db.upsertSource(run.id, {
      url: "https://example.com/a",
      title: "A",
      publisher: "Example",
      published_at: "2024-01-01",
      source_type: "web_citation",
      search_excerpt: "excerpt",
      snapshot_text: "VERY LARGE SNAPSHOT",
      source_quote: "quote",
      quote_verified: true,
      usability_status: "usable",
      retrieval_status: "captured",
      content_hash: "hash",
    });
    const sources = read.listSourcesForReview(run.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("A");
    expect(sources[0].source_quote).toBe("quote");
    expect(sources[0]).not.toHaveProperty("snapshot_text");
    expect(sources[0]).not.toHaveProperty("search_excerpt");
  });

  it("listWorkItemsForReview omits payload_json", () => {
    const run = db.createRun("工作项瘦身", "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_03", { status: "needs_review" });
    db.upsertWorkItem({
      run_id: run.id,
      kind: "evidence_review",
      stage: "stage_03",
      target_type: "evidence",
      target_id: "EV-1",
      title: "审阅",
      status: "pending",
      priority: "high",
      reason: "gap",
      note: "",
      source_event_id: null,
      artifact_id: artifact.id,
      attempt: artifact.version,
      payload_json: JSON.stringify({ bulky: true }),
    });
    const items = read.listWorkItemsForReview(run.id);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("审阅");
    expect(items[0]).not.toHaveProperty("payload_json");
  });

  it("getRunOverview does not load full artifact/source dumps", () => {
    const run = db.createRun("总览瘦身", "semiconductor");
    db.createArtifact(run.id, "stage_03", {
      status: "approved",
      json_content: JSON.stringify({ evidence_drafts: [{ id: "EV-1", kind: "fact_draft" }] }),
      raw_model_output: "RAW",
    });
    db.createArtifact(run.id, "stage_04", {
      status: "approved",
      json_content: JSON.stringify({ judgments: [{ id: "J-1" }] }),
    });
    const overview = read.getRunOverview(run.id);
    expect(overview?.run.id).toBe(run.id);
    expect(overview?.stage03Json).toContain("EV-1");
    expect(overview?.stage04Json).toContain("J-1");
    expect(overview).not.toHaveProperty("artifacts");
    expect(overview).not.toHaveProperty("sources");
  });

  it("listArtifactLedger exposes has_markdown without body", () => {
    const run = db.createRun("台账", "semiconductor");
    db.createArtifact(run.id, "stage_05", {
      status: "approved",
      markdown_content: "# report",
      json_content: "{}",
    });
    const ledger = read.listArtifactLedger(run.id);
    expect(ledger[0]?.has_markdown).toBe(true);
    expect(ledger[0]).not.toHaveProperty("json_content");
    expect(ledger[0]).not.toHaveProperty("markdown_content");
  });
});
