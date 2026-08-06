import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-actions-${process.pid}.sqlite`;

let db: typeof import("@/storage/db");
let tools: typeof import("@/skills/ontology/tools");

beforeAll(async () => {
  db = await import("@/storage/db");
  tools = await import("@/skills/ontology/tools");
});

describe("approved and idempotent Action execution", () => {
  it("rolls back multi-write operations when a transaction fails", () => {
    const question = `事务回滚测试-${crypto.randomUUID()}`;
    expect(() => db.withImmediateTransaction(() => {
      db.createRun(question, "semiconductor");
      throw new Error("forced rollback");
    })).toThrow(/forced rollback/);
    expect(db.listRuns().some((run) => run.question === question)).toBe(false);
  });

  it("rejects unapproved and stale proposals, then executes exactly once", () => {
    const run = db.createRun("Action 审计测试", "semiconductor");
    db.saveInstanceGraph(run.id, {
      business_instance_graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [],
        relations: [],
      },
    });
    const registered = db.upsertSource(run.id, {
      url: "https://example.com/source", title: "受控登记来源", publisher: "Example", published_at: "2026-07-18T00:00:00Z",
      source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "verified",
      locator: "quote:verified statement", captured_at: "2026-07-18T01:00:00Z", content_hash: "a".repeat(64),
      usability_status: "usable", retrieval_status: "captured", source_quote: "verified statement", quote_verified: true,
      final_url: "https://example.com/source", content_mime: "text/html", http_status: 200, snapshot_text: "verified statement".repeat(30),
      failure_category: "", failure_detail: "",
    });
    const created = tools.createStoredActionProposal(run.id, "RegisterSource", {
      sourceId: registered.id,
    });
    const proposal = created.proposal;
    expect(proposal.expected_graph_version).toBe(1);
    expect(() => tools.executeApprovedAction(run.id, proposal.id, 1)).toThrow(/尚未通过人工批准/);

    db.updateWorkItem(proposal.work_item_id, { status: "approved", note: "研究员批准" });
    expect(() => tools.executeApprovedAction(run.id, proposal.id, 0)).toThrow(/图版本冲突/);

    const first = tools.executeApprovedAction(run.id, proposal.id, 1);
    const second = tools.executeApprovedAction(run.id, proposal.id, 1);
    expect(first.status).toBe("executed");
    expect(second.execution_id).toBe(first.execution_id);
    expect(first.graph_version_after).toBe(2);
    const latestGraph = db.latestArtifact(run.id, "instance_graph", ["approved"]);
    expect(latestGraph?.version).toBe(2);
    expect(db.listArtifacts(run.id).filter((artifact) =>
      artifact.kind === "instance_graph" && artifact.status === "approved",
    )).toHaveLength(1);
    const latestGraphPayload = JSON.parse(latestGraph!.json_content);
    expect(latestGraphPayload.business_instance_graph.objects.find(
      (object: any) => object.id === registered.id,
    )?.projection?.origin).toBe("action");
    expect(db.getWorkItem(proposal.work_item_id)?.resolution).toBe("executed");
    expect(db.listArtifacts(run.id).filter((artifact) => artifact.kind === "action_audit").length).toBe(2);
  });

  it("supersedes review items bound to an older artifact attempt", () => {
    const run = db.createRun("工作项版本测试", "semiconductor");
    const first = db.createArtifact(run.id, "stage_03", { status: "needs_review" });
    const oldItem = db.upsertWorkItem({
      run_id: run.id,
      kind: "evidence_review",
      stage: "stage_03",
      target_type: "EvidenceDraft",
      target_id: "EV-1",
      title: "旧版本证据",
      priority: "medium",
      reason: "",
      source_event_id: null,
      artifact_id: first.id,
      attempt: first.version,
      payload_json: "{}",
    });
    expect(db.getWorkItem(oldItem.id)).toMatchObject({ artifact_id: first.id, attempt: first.version, payload_json: "{}" });
    expect(() => db.upsertWorkItem({
      run_id: run.id,
      kind: "evidence_review",
      stage: "stage_03",
      target_type: "EvidenceDraft",
      target_id: "EV-BAD",
      title: "错误绑定",
      priority: "medium",
      reason: "",
      source_event_id: null,
      artifact_id: first.id,
      attempt: first.version + 1,
      payload_json: "{}",
    })).toThrow(/attempt 与 artifact 版本不一致/);
    const second = db.createArtifact(run.id, "stage_03", { status: "needs_review" });
    db.supersedeWorkItemsForArtifact(run.id, "stage_03", second.id, second.version);
    expect(db.getWorkItem(oldItem.id)).toMatchObject({ status: "superseded", resolution: "artifact_regenerated" });
    expect(db.listWorkItems(run.id, "pending")).toHaveLength(0);
    expect(() => db.updateWorkItem(oldItem.id, { status: "approved" })).toThrow(/不允许从 superseded/);
  });

  it("supersedes a pending action proposal when the formal graph changes", () => {
    const run = db.createRun("Action 图版本失效测试", "semiconductor");
    db.saveInstanceGraph(run.id, { business_instance_graph: {
      schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "business_parameters", objects: [], relations: [],
    } });
    const created = tools.createStoredActionProposal(run.id, "RegisterSource", (() => {
      const source = db.upsertSource(run.id, {
        url: "https://example.com/stale-proposal", title: "来源", publisher: "Example", published_at: "2026-07-18T00:00:00Z",
        source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "verified",
        locator: "quote:verified", captured_at: "2026-07-18T01:00:00Z", content_hash: "c".repeat(64),
        usability_status: "usable", failure_category: "", failure_detail: "", final_url: "https://example.com/stale-proposal",
        content_mime: "text/html", http_status: 200, retrieval_status: "captured", snapshot_text: "verified".repeat(30),
        source_quote: "verified", quote_verified: true,
      });
      return { sourceId: source.id };
    })());
    db.updateWorkItem(created.proposal.work_item_id, { status: "approved", note: "先批准但尚未执行" });
    db.saveInstanceGraph(run.id, { business_instance_graph: {
      schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "business_parameters", objects: [], relations: [],
    } });
    expect(db.getWorkItem(created.proposal.work_item_id)?.status).toBe("superseded");
    expect(db.getActionProposal(created.proposal.id)?.status).toBe("superseded");
    expect(() => tools.executeApprovedAction(run.id, created.proposal.id, 1)).toThrow(/尚未通过人工批准/);
  });

  it("creates only endpoint-compatible formal relations through an approved proposal", () => {
    const run = db.createRun("正式本体关系提案测试", "semiconductor");
    db.saveInstanceGraph(run.id, {
      authority_contract: "ontology_authority_graph_v1",
      business_instance_graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [
          { id: "COMPANY-1", type: "Company", properties: { name: "测试公司" } },
          { id: "PRODUCT-1", type: "Product", properties: { name: "测试产品" } },
          { id: "REGION-1", type: "Region", properties: { name: "测试地区" } },
        ],
        relations: [],
      },
    });
    expect(() => tools.createStoredActionProposal(run.id, "LinkOntologyObjects", {
      sourceId: "COMPANY-1",
      relationType: "produces",
      targetId: "REGION-1",
      properties: {},
    })).toThrow(/目标对象.*不符合|端点类型/);

    const created = tools.createStoredActionProposal(run.id, "LinkOntologyObjects", {
      sourceId: "COMPANY-1",
      relationType: "produces",
      targetId: "PRODUCT-1",
      properties: {},
    });
    expect(created.proposal_detail.planned_writes.relations).toEqual([
      expect.objectContaining({
        type: "produces",
        sourceId: "COMPANY-1",
        targetId: "PRODUCT-1",
      }),
    ]);
    db.updateWorkItem(created.proposal.work_item_id, { status: "approved", note: "人工确认公司生产该产品" });
    const executed = tools.executeApprovedAction(
      run.id,
      created.proposal.id,
      created.proposal.expected_graph_version,
    );
    expect(executed.status).toBe("executed");
    const latest = db.latestArtifact(run.id, "instance_graph", ["approved"]);
    const payload = JSON.parse(latest!.json_content);
    expect(payload.business_instance_graph.relations).toEqual([
      expect.objectContaining({
        type: "produces",
        sourceId: "COMPANY-1",
        targetId: "PRODUCT-1",
        properties: expect.objectContaining({ projection_origin: "action" }),
      }),
    ]);
  });
});
