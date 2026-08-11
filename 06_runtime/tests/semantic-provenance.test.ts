import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { LocalSemanticGateway } from "@/src/semantic/local-gateway";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { LocalSourceGateway } from "@/src/tools/local-source-gateway";
import { verifyEvidenceFactPromotion, verifySourceSnapshot } from "@/src/governance/provenance-verifier";

const directories: string[] = [];
const stores: RuntimeStore[] = [];

function fixture(): { root: string; store: RuntimeStore; semantic: LocalSemanticGateway; provenance: ResearchProvenanceStore; sources: LocalSourceGateway; capturePath: string } {
  const root = mkdtempSync(join(tmpdir(), "vnext-semantic-"));
  directories.push(root);
  mkdirSync(join(root, "01_semantic_knowledge/01_ontology"), { recursive: true });
  mkdirSync(join(root, "01_semantic_knowledge/02_dictionary"), { recursive: true });
  mkdirSync(join(root, "01_semantic_knowledge/01_ontology/source_captures"), { recursive: true });
  writeFileSync(join(root, "01_semantic_knowledge/registry.yaml"), "schema_name: semantic\n");
  writeFileSync(join(root, "01_semantic_knowledge/01_ontology/hbm.yaml"), "id: HBM\nlabel: 高带宽存储\nrelation: AI算力需求\n");
  const capturePath = join(root, "01_semantic_knowledge/01_ontology/source_captures/SR-01.json");
  writeFileSync(capturePath, JSON.stringify({
    evidence_claims: [{ statement: "HBM 需求同比增长 40%", locator: "page 3", claim_type: "reported_fact" }],
    evidence_records: [{ claim_text: "HBM 需求同比增长 40%", source_locator: "https://example.test/report.pdf#page=3", source_authority: "primary" }],
  }, null, 2));
  const store = new RuntimeStore(":memory:");
  stores.push(store);
  const semantic = new LocalSemanticGateway(store.db, root);
  const provenance = new ResearchProvenanceStore(store.db);
  return { root, store, semantic, provenance, sources: new LocalSourceGateway(semantic, provenance), capturePath };
}

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("semantic assets and research provenance", () => {
  it("indexes governed assets with stable ids and content-derived versions", () => {
    const { semantic, root } = fixture();
    expect(semantic.buildIndex().indexed).toBeGreaterThanOrEqual(2);
    const first = semantic.searchSync({ text: "HBM AI算力", strategies: ["fts", "structured"], kinds: ["ontology"], limit: 5 });
    expect(first[0]).toMatchObject({ kind: "ontology", version: 1 });
    semantic.buildIndex();
    expect(semantic.searchSync({ text: "HBM", strategies: ["fts"], kinds: ["ontology"], limit: 1 })[0]?.version).toBe(1);
    writeFileSync(join(root, "01_semantic_knowledge/01_ontology/hbm.yaml"), "id: HBM\nlabel: 高带宽存储\nrelation: AI推理需求\n");
    semantic.buildIndex();
    const revised = semantic.searchSync({ text: "AI推理", strategies: ["fts", "structured"], kinds: ["ontology"], limit: 1 });
    expect(revised[0]).toMatchObject({ refId: first[0].refId, version: 2 });
  });

  it("requires capture verification before deterministic EvidenceFact promotion", () => {
    const { semantic, provenance, sources } = fixture();
    semantic.buildIndex();
    const candidates = sources.discover("研究 HBM 需求同比增长");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ sourceType: "primary", locator: "page 3" });
    const snapshot = sources.capture(candidates[0]);
    expect(verifySourceSnapshot(snapshot).passed).toBe(true);
    expect(snapshot.verification).toBe("verified");
    const fact = provenance.promoteFact({ snapshotId: snapshot.id, statement: snapshot.quote, factType: "reported_fact", confidence: "high" });
    expect(fact.status).toBe("verified");
    expect(provenance.lineage(fact.id).upstream).toEqual([expect.objectContaining({ fromId: snapshot.id, predicate: "derived_from" })]);
    expect(() => provenance.promoteFact({ snapshotId: snapshot.id, statement: "改写后的无依据事实", factType: "reported_fact", confidence: "high" })).toThrow(/equal the located quote/);
  });

  it("rejects a snapshot whose quote or hash cannot be verified", () => {
    const { semantic, provenance, sources } = fixture();
    semantic.buildIndex();
    const valid = sources.capture(sources.discover("HBM 需求")[0]);
    const tampered = { ...valid, quote: "正文中不存在", contentHash: "sha256:tampered" };
    expect(verifySourceSnapshot(tampered).passed).toBe(false);
    expect(verifyEvidenceFactPromotion(tampered, { statement: tampered.quote, factType: "reported_fact", confidence: "high" }).passed).toBe(false);
    expect(provenance.listFacts()).toEqual([]);
  });
});
