import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-source-acquisition-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let acquisition: typeof import("@/engine/source_acquisition");
let snapshots: typeof import("@/engine/source_snapshot");

beforeAll(async () => {
  db = await import("@/adapters/db");
  acquisition = await import("@/engine/source_acquisition");
  snapshots = await import("@/engine/source_snapshot");
});

afterEach(() => {
  snapshots.setSourceSnapshotDependenciesForTests(null);
});

describe("researcher supplied public source acquisition", () => {
  it("rejects malformed metadata before making a request", () => {
    expect(() => acquisition.normalizeSourceAcquisitionInput({
      url: "file:///tmp/private",
      title: "invalid",
      publisher: "test",
      published_at: "2026-07-18",
      source_tier: "S2",
      source_quote: "too short",
      locator: "page 1",
    })).toThrow(/http\/https/);
  });

  it("captures and registers a verified source without promoting it to evidence", async () => {
    const run = db.createRun("来源取得测试", "semiconductor");
    const quote = "公司披露可比口径库存连续两个季度下降，库存周转天数同步改善";
    const body = `<html><article>${quote}。${"公开披露正文用于验证来源取得边界。".repeat(20)}</article></html>`;
    snapshots.setSourceSnapshotDependenciesForTests({
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      requestResolved: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });

    const result = await acquisition.acquirePublicSource(run.id, {
      url: "https://example.com/disclosure",
      title: "库存公告",
      publisher: "Example",
      published_at: "2026-07-18T00:00:00Z",
      source_tier: "s2",
      source_group: "example",
      source_quote: quote,
      locator: `quote:${quote}`,
    });

    expect(result.accepted).toBe(true);
    expect(result.boundary).toMatch(/只进入 Source Registry/);
    expect(result.source).toMatchObject({
      source_type: "user_supplied_public_evidence",
      source_tier: "S2",
      source_group: "example",
      retrieval_status: "captured",
      usability_status: "usable",
      quote_verified: 1,
    });
    expect(result.source.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.latestArtifact(run.id, "stage_03")).toBeUndefined();
  });
});
