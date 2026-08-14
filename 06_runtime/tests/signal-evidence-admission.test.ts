import { describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { createSignalCaptureRequest } from "@/src/tools/signal-evidence-admission";

const candidate = {
  id: "signal-1", connectorId: "akshare_public", conversationId: "conversation-1", kind: "announcement" as const,
  status: "new" as const, symbol: "688001", title: "公司公告标题", excerpt: "公告标题与摘要仅是候选线索。",
  publisher: "上市公司公告", sourceUri: "https://www.cninfo.com.cn/example.pdf", sourceType: "primary" as const,
  publishedAt: "2026-08-11T01:00:00.000Z", capturedAt: "2026-08-11T02:00:00.000Z",
  matchReason: "精确代码 688001", score: 90, fingerprint: "sha256:signal-1",
};

describe("signal evidence-admission boundary", () => {
  it("turns a signal into a governed capture request rather than a source result", () => {
    const request = createSignalCaptureRequest(candidate, "task-1");
    expect(request).toMatchObject({ status: "capture_required", signalId: candidate.id, taskId: "task-1", source: { uri: candidate.sourceUri, sourceType: "primary" } });
    expect(request.requiredFields).toEqual(expect.arrayContaining(["body", "locator", "quote", "content_hash"]));
    expect(request.allowedNextActions).toContain("capture_primary_original");
    expect(JSON.stringify(request)).not.toContain(candidate.excerpt);
  });

  it("does not create a snapshot, evidence artifact or recompute event from a signal payload", () => {
    const store = new RuntimeStore(":memory:");
    try {
      const kernel = new AgentKernel(store);
      const conversation = store.createConversation("公告线索核验");
      const submitted = kernel.submitGoal(conversation.id, "核验公司公告中的订单变化");
      const stored = store.upsertSignalCandidates([{ ...candidate, conversationId: conversation.id, content: candidate.excerpt }]);
      expect(stored).toBe(1);
      const signal = store.listSignalCandidates({ conversationId: conversation.id })[0];
      const request = createSignalCaptureRequest(signal, submitted.task.id);
      store.appendEvent({ conversationId: conversation.id, taskId: submitted.task.id, type: "signal.capture_required", actorType: "system", actorId: signal.connectorId, payload: { captureRequest: request } });
      expect(store.listArtifacts(submitted.task.id).filter((artifact) => artifact.title === "外部来源快照")).toEqual([]);
      expect(store.listEvents(conversation.id).filter((event) => event.type === "connector.source_ingested")).toEqual([]);
      expect(store.listEvents(conversation.id).filter((event) => event.type === "signal.capture_required")).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
