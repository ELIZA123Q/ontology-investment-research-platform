import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { buildResearcherMaterialResult, ResearcherMaterialError, type ResearcherMaterialInput } from "@/src/tools/researcher-material";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const material = (publisherId: string, uri: string, quote: string): ResearcherMaterialInput => ({
  uri,
  title: `${publisherId} 定期披露`,
  publisherId,
  publishedAt: "2026-08-01",
  sourceType: "primary",
  locator: "第 3 页，经营回顾",
  quote,
  context: `披露原文开始。${quote}。披露原文结束。`,
  permissionConfirmed: true,
});

describe("researcher material intake", () => {
  it("builds an auditable user-supplied capture without accepting credentials", () => {
    const result = buildResearcherMaterialResult(material("issuer-a", "https://issuer-a.test/report.pdf", "终端需求同比改善"), "2026-08-11T01:02:03.000Z");
    expect(result.connectorId).toBe("researcher.material");
    expect(result.capture.permissionScope).toBe("user_supplied");
    expect(result.capture.body).toContain(result.capture.quote);
    expect(result.requestParameters).toMatchObject({ captureExtent: "provided_context", submittedBy: "researcher" });
    expect(() => buildResearcherMaterialResult({ ...material("issuer-a", "https://user:secret@issuer-a.test/report", "需求改善"), permissionConfirmed: true })).toThrow(ResearcherMaterialError);
  });

  it("requires an explicit accuracy and permission affirmation and a locatable quote", () => {
    expect(() => buildResearcherMaterialResult({ ...material("issuer-a", "https://issuer-a.test/report", "需求改善"), permissionConfirmed: false })).toThrow(/must be confirmed/);
    expect(() => buildResearcherMaterialResult({ ...material("issuer-a", "https://issuer-a.test/report", "需求改善"), context: "另一段文字" })).toThrow(/quote must be locatable/);
    expect(() => buildResearcherMaterialResult({ ...material("issuer-a", "file:///private/report.pdf", "需求改善") })).toThrow(/public http/);
  });

  it("joins two researcher materials to the governed evidence path and still pauses for evidence confirmation", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("研究员补充材料");
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求和供给变化并形成报告");
    kernel.ingestExternalSource(submitted.task.id, buildResearcherMaterialResult(material("issuer-a", "https://issuer-a.test/report.pdf", "终端需求同比改善")));
    kernel.ingestExternalSource(submitted.task.id, buildResearcherMaterialResult(material("issuer-b", "https://issuer-b.test/report.pdf", "有效供给与产能利用率提升")));
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    expect(store.listPendingApprovals(conversation.id)[0].kind).toBe("evidence_confirmation");
    const evidence = [...store.listArtifacts(submitted.task.id)].reverse().find((artifact) => artifact.title === "证据评估")!;
    expect((evidence.data as { independentPublisherCount: number }).independentPublisherCount).toBe(2);
    expect(evidence.sourceRefs.every((source) => source.verification === "verified")).toBe(true);
  });
});
