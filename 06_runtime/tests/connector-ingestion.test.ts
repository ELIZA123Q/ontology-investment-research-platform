import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";
import { assertConnectorRequestAuthorized, ConnectorIngestionError, validateConnectorEnvelope } from "@/src/tools/connector-ingestion";
import { POST as ingestRoute } from "@/app/vnext/connectors/ingest/route";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

function source(connectorId: string, publisherId: string, index: number, quote: string): UnifiedSourceToolResult {
  const body = `第 ${index} 份来源。${quote}。结束。`;
  return {
    connectorId, operation: "capture_url", requestParameters: { url: `https://${publisherId}/report-${index}` },
    requestedAt: `2026-08-09T04:00:0${index}.000Z`, retrievedAt: `2026-08-09T04:00:1${index}.000Z`,
    upstream: { sourceId: `${publisherId}:report-${index}`, uri: `https://${publisherId}/report-${index}`, title: `来源 ${index}`, publisherId, publishedAt: `2026-08-0${index}T00:00:00.000Z`, sourceType: "primary" },
    capture: { body, locator: `p${index}`, quote, permissionScope: "public_research_use" },
  };
}

describe("connector ingestion boundary", () => {
  it("requires a server-side token, allowlists connector IDs and rejects credential fields", () => {
    expect(() => assertConnectorRequestAuthorized(new Request("http://local/ingest"), "secret-token")).toThrow(ConnectorIngestionError);
    expect(() => assertConnectorRequestAuthorized(new Request("http://local/ingest", { headers: { authorization: "Bearer secret-token" } }), "secret-token")).not.toThrow();
    const valid = { taskId: "task-1", kind: "source_capture", result: source("web.capture", "issuer-a.test", 1, "终端需求同比改善") };
    expect(validateConnectorEnvelope(valid, "web.capture,financial.mcp.wind")).toMatchObject({ taskId: "task-1", kind: "source_capture" });
    expect(() => validateConnectorEnvelope(valid, "financial.mcp.wind")).toThrow(/not allowed/);
    expect(() => validateConnectorEnvelope({ ...valid, result: { ...valid.result, requestParameters: { api_key: "must-not-persist" } } }, "web.capture")).toThrow(/Credential field is forbidden/);
  });

  it("enforces authentication and connector allowlisting at the HTTP boundary", async () => {
    const priorToken = process.env.VNEXT_CONNECTOR_INGEST_TOKEN;
    const priorIds = process.env.VNEXT_CONNECTOR_IDS;
    process.env.VNEXT_CONNECTOR_INGEST_TOKEN = "server-secret";
    process.env.VNEXT_CONNECTOR_IDS = "web.capture";
    try {
      const unauthorized = await ingestRoute(new Request("http://local/vnext/connectors/ingest", { method: "POST", body: JSON.stringify({}) }));
      expect(unauthorized.status).toBe(401);
      const forbidden = await ingestRoute(new Request("http://local/vnext/connectors/ingest", {
        method: "POST", headers: { authorization: "Bearer server-secret", "content-type": "application/json" },
        body: JSON.stringify({ taskId: "task-1", kind: "source_capture", result: source("pdf.capture", "issuer.test", 1, "需求改善") }),
      }));
      expect(forbidden.status).toBe(403);
    } finally {
      if (priorToken === undefined) delete process.env.VNEXT_CONNECTOR_INGEST_TOKEN; else process.env.VNEXT_CONNECTOR_INGEST_TOKEN = priorToken;
      if (priorIds === undefined) delete process.env.VNEXT_CONNECTOR_IDS; else process.env.VNEXT_CONNECTOR_IDS = priorIds;
    }
  });

  it("ingests external captures idempotently and recomputes only evidence and downstream nodes", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("外部实时来源");
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求、供给与传导机制并形成报告");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const stalePublishApproval = store.listPendingApprovals(conversation.id)[0];
    expect(stalePublishApproval.kind).toBe("publish_confirmation");

    const first = kernel.ingestExternalSource(submitted.task.id, source("web.capture", "issuer-a.test", 1, "终端需求同比改善"));
    expect(kernel.ingestExternalSource(submitted.task.id, source("web.capture", "issuer-a.test", 1, "终端需求同比改善")).id).toBe(first.id);
    const second = kernel.ingestExternalSource(submitted.task.id, source("pdf.capture", "issuer-b.test", 2, "有效供给与产能利用率提升"));
    expect(second.id).not.toBe(first.id);
    expect(store.getApproval(stalePublishApproval.id)?.status).toBe("rejected");
    expect(store.getTask(submitted.task.id)?.status).toBe("queued");
    expect(store.listEvents(conversation.id).filter((event) => event.type === "connector.source_ingested")).toHaveLength(2);
    expect(store.listEvents(conversation.id).filter((event) => event.type === "connector.evidence_recompute_queued")).toHaveLength(1);

    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    expect(store.listPendingApprovals(conversation.id)[0].kind).toBe("evidence_confirmation");
    const evaluated = [...store.listArtifacts(submitted.task.id)].reverse().find((artifact) => artifact.title === "证据评估")!;
    expect((evaluated.data as { sufficient: boolean; independentPublisherCount: number }).sufficient).toBe(true);
    expect((evaluated.data as { independentPublisherCount: number }).independentPublisherCount).toBeGreaterThanOrEqual(2);
    expect((evaluated.data as { facts: unknown[] }).facts.length).toBeGreaterThanOrEqual(2);
    expect(evaluated.sourceRefs.map((item) => item.publisherId)).toEqual(expect.arrayContaining(["issuer-a.test", "issuer-b.test"]));
  });

  it("refuses to mutate a published task", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("已发布研究");
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求并形成简报");
    kernel.decideApproval(submitted.approval!.id, "approved");
    kernel.executeTask(submitted.task.id);
    kernel.decideApproval(store.listPendingApprovals(conversation.id)[0].id, "approved");
    kernel.executeTask(submitted.task.id);
    expect(store.getTask(submitted.task.id)?.status).toBe("completed");
    expect(() => kernel.ingestExternalSource(submitted.task.id, source("web.capture", "issuer-a.test", 1, "新增需求信号"))).toThrow(/create an update branch/);
  });
});
