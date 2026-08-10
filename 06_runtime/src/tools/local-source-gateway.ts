import { createHash } from "node:crypto";
import type { SourceCandidate, SourceReference, SourceSnapshot } from "@/src/contracts";
import { LocalSemanticGateway } from "@/src/semantic/local-gateway";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";

const now = () => new Date().toISOString();
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function publisherId(uri: string): string {
  try { return new URL(uri).hostname.replace(/^www\./, "") || "repository"; }
  catch { return "repository"; }
}

function sourceFields(body: string): { uri?: string; locator?: string; quote?: string; sourceType: SourceCandidate["sourceType"]; factType: "reported_fact" | "forecast" } {
  try {
    const parsed = JSON.parse(body) as {
      evidence_claims?: Array<{ statement?: string; locator?: string; claim_type?: string }>;
      evidence_records?: Array<{ claim_text?: string; source_locator?: string; source_authority?: string; statement_nature?: string }>;
    };
    const claim = parsed.evidence_claims?.find((item) => item.statement?.trim());
    const record = parsed.evidence_records?.find((item) => item.claim_text?.trim());
    const nature = claim?.claim_type || record?.statement_nature;
    return {
      uri: record?.source_locator,
      locator: claim?.locator || record?.source_locator,
      quote: claim?.statement || record?.claim_text,
      sourceType: record?.source_authority === "primary" ? "primary" : "secondary",
      factType: nature === "forecast" ? "forecast" : "reported_fact",
    };
  } catch {
    return { sourceType: "secondary", factType: "reported_fact" };
  }
}

export class LocalSourceGateway {
  constructor(readonly semantic: LocalSemanticGateway, readonly provenance: ResearchProvenanceStore) {}

  discover(goal: string, limit = 4): SourceCandidate[] {
    return this.semantic.searchSync({ text: goal, strategies: ["fts", "structured"], kinds: ["source_snapshot"], limit })
      .filter((result) => result.score >= 0.12)
      .flatMap((result) => {
        const asset = this.semantic.getAsset(result.refId);
        if (!asset) return [];
        const fields = sourceFields(asset.body);
        if (!fields.quote || !fields.locator) return [];
        return [{
          id: `source:${asset.id}`,
          uri: fields.uri || `repo://${asset.path}`,
          title: asset.title,
          sourceType: fields.sourceType,
          repositoryPath: asset.path,
          locator: fields.locator,
          discoveryReason: `${result.reason}；资产版本 ${asset.version}`,
          discoveredAt: now(),
        } satisfies SourceCandidate];
      });
  }

  capture(candidate: SourceCandidate): SourceSnapshot {
    if (!candidate.repositoryPath) throw new Error("Local source candidate lacks repository path");
    const result = this.semantic.searchSync({ text: candidate.repositoryPath, strategies: ["structured"], kinds: ["source_snapshot"], limit: 10 });
    const asset = result.map((item) => this.semantic.getAsset(item.refId)).find((item) => item?.path === candidate.repositoryPath);
    if (!asset) throw new Error(`Indexed source asset not found: ${candidate.repositoryPath}`);
    const fields = sourceFields(asset.body);
    if (!fields.quote || !fields.locator) throw new Error("Source capture lacks a locatable quote");
    const capturedAt = now();
    return this.provenance.saveSnapshot({
      candidateId: candidate.id,
      uri: candidate.uri,
      title: candidate.title,
      sourceType: candidate.sourceType,
      repositoryPath: candidate.repositoryPath,
      locator: fields.locator,
      quote: fields.quote,
      body: asset.body,
      contentHash: asset.contentHash,
      capturedAt,
      permissionScope: "public_research_use",
      acquisition: {
        connectorId: "local-governed-assets",
        upstreamSourceId: asset.id,
        requestFingerprint: sha256(JSON.stringify({ repositoryPath: candidate.repositoryPath })),
        requestParameters: { repositoryPath: candidate.repositoryPath },
        rawResponseHash: asset.contentHash,
        retrievedAt: capturedAt,
      },
    });
  }

  toSourceReference(snapshot: SourceSnapshot): SourceReference {
    return {
      sourceId: snapshot.id,
      uri: snapshot.uri,
      title: snapshot.title,
      capturedAt: snapshot.capturedAt,
      locator: snapshot.locator,
      quote: snapshot.quote,
      contentHash: snapshot.contentHash,
      verification: snapshot.verification,
      sourceType: snapshot.sourceType,
      publisherId: snapshot.publisherId || publisherId(snapshot.uri),
      publishedAt: snapshot.publishedAt,
    };
  }
}
