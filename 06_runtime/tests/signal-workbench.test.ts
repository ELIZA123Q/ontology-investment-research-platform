import { afterEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { buildHomeView } from "@/src/ui/view-models";

const stores: RuntimeStore[] = [];
const makeStore = () => { const store = new RuntimeStore(":memory:"); stores.push(store); return store; };
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("research signal workbench", () => {
  it("creates editable tracking defaults without persisting a fake watchlist", () => {
    const store = makeStore();
    const conversation = store.createConversation("先进封装需求判断");
    expect(store.getTrackingProfile(conversation.id)).toMatchObject({ enabled: true, symbols: [], keywords: ["先进封装需求判断"] });
    const saved = store.putTrackingProfile({ conversationId: conversation.id, enabled: true, symbols: ["600519", "600519"], keywords: ["飞天茅台", "飞天茅台"] });
    expect(saved).toMatchObject({ symbols: ["600519"], keywords: ["飞天茅台"] });
    expect(() => store.putTrackingProfile({ conversationId: conversation.id, enabled: true, symbols: ["SH600519"], keywords: [] })).toThrow(/six digits/);
  });

  it("deduplicates, ranks and decides signal candidates separately from evidence", () => {
    const store = makeStore();
    const conversation = store.createConversation("贵州茅台");
    const base = {
      connectorId: "akshare_public",
      conversationId: conversation.id,
      kind: "news" as const,
      symbol: "600519",
      title: "贵州茅台最新新闻",
      excerpt: "候选材料，尚未成为证据。",
      content: "候选材料，尚未成为证据。",
      publisher: "公开财经媒体",
      sourceUri: "https://example.com/news/1",
      sourceType: "secondary" as const,
      publishedAt: "2026-08-11T01:00:00.000Z",
      capturedAt: "2026-08-11T02:00:00.000Z",
      matchReason: "精确代码 600519",
      score: 60,
      fingerprint: "sha256:signal-1",
    };
    store.upsertSignalCandidates([base, { ...base, score: 80 }]);
    const feed = store.listSignalCandidates({ status: "new" });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ score: 80, status: "new" });
    expect(store.listArtifacts("missing")).toEqual([]);
    expect(store.decideSignalCandidate(feed[0].id, "seen")).toMatchObject({ status: "seen" });
  });

  it("projects tracking, feed and refresh state on the home view", () => {
    const store = makeStore();
    const conversation = store.createConversation("公司公告跟踪");
    store.putTrackingProfile({ conversationId: conversation.id, enabled: true, symbols: ["600519"], keywords: ["贵州茅台"] });
    const run = store.createSignalRefreshRun([conversation.id]);
    store.updateSignalRefreshRun(run.id, { status: "completed", candidateCount: 0 });
    const view = buildHomeView(store);
    expect(view.tracking).toHaveLength(1);
    expect(view.signalFeed).toEqual([]);
    expect(view.signalRefresh).toMatchObject({ status: "completed" });
  });
});
