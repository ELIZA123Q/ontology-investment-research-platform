import { createHash } from "node:crypto";
import type { PointInTimeEvidenceEnvelope, SourceCandidate, SourceSnapshot } from "@/src/contracts";
import { normalizeSourceDocumentAttestation, type SourceDocumentAttestation } from "@/src/tools/source-document-attestation";

type JsonScalar = string | number | boolean | null;

export interface UnifiedSourceToolResult {
  connectorId: string;
  operation: string;
  requestParameters: Record<string, JsonScalar | JsonScalar[]>;
  requestedAt: string;
  retrievedAt: string;
  upstream: {
    sourceId: string;
    uri: string;
    title: string;
    publisherId?: string;
    publishedAt?: string;
    sourceType: SourceCandidate["sourceType"];
  };
  capture: {
    body: string;
    locator: string;
    quote: string;
    permissionScope: SourceSnapshot["permissionScope"];
    documentAttestation?: SourceDocumentAttestation;
  };
}

export interface AdaptedSourceResult {
  candidate: SourceCandidate;
  snapshot: Omit<SourceSnapshot, "id" | "verification">;
  pointInTime: PointInTimeEvidenceEnvelope;
}

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requireTimestamp(value: string, field: string): string {
  requireText(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

/**
 * Converts a connector response into the common provenance boundary. The
 * connector records how bytes were obtained; the upstream publisher remains
 * the source. Persisting the returned snapshot is still the responsibility of
 * ResearchProvenanceStore and the CaptureSource ontology Action.
 */
export function adaptSourceToolResult(result: UnifiedSourceToolResult): AdaptedSourceResult {
  const connectorId = requireText(result.connectorId, "connectorId");
  const operation = requireText(result.operation, "operation");
  const upstreamSourceId = requireText(result.upstream.sourceId, "upstream.sourceId");
  const uri = requireText(result.upstream.uri, "upstream.uri");
  const title = requireText(result.upstream.title, "upstream.title");
  const body = requireText(result.capture.body, "capture.body");
  const locator = requireText(result.capture.locator, "capture.locator");
  const quote = requireText(result.capture.quote, "capture.quote");
  const requestedAt = requireTimestamp(result.requestedAt, "requestedAt");
  const retrievedAt = requireTimestamp(result.retrievedAt, "retrievedAt");
  const publisherId = requireText(result.upstream.publisherId || "", "upstream.publisherId");
  const publishedAt = requireTimestamp(result.upstream.publishedAt || "", "upstream.publishedAt");
  if (Date.parse(retrievedAt) < Date.parse(requestedAt)) throw new Error("retrievedAt cannot precede requestedAt");
  if (!body.includes(quote)) throw new Error("capture.quote cannot be located in capture.body");

  const requestFingerprint = sha256(canonicalize({ connectorId, operation, requestParameters: result.requestParameters }));
  const contentHash = sha256(body);
  const documentAttestation = normalizeSourceDocumentAttestation(result.capture.documentAttestation);
  const candidateId = `source:${sha256(`${connectorId}:${upstreamSourceId}`).slice(7, 31)}`;
  const candidate: SourceCandidate = {
    id: candidateId,
    uri,
    title,
    sourceType: result.upstream.sourceType,
    locator,
    discoveryReason: `由 ${connectorId} 获取；上游来源 ${upstreamSourceId}；请求 ${requestFingerprint}`,
    discoveredAt: retrievedAt,
  };
  return {
    candidate,
    snapshot: {
      candidateId,
      uri,
      title,
      sourceType: result.upstream.sourceType,
      locator,
      quote,
      body,
      contentHash,
      capturedAt: retrievedAt,
      publishedAt,
      publisherId,
      permissionScope: result.capture.permissionScope,
      documentAttestation,
      acquisition: {
        connectorId,
        upstreamSourceId,
        requestFingerprint,
        requestParameters: result.requestParameters,
        rawResponseHash: contentHash,
        retrievedAt,
      },
    },
    pointInTime: {
      connectorId, operation, subjectRef: upstreamSourceId, publisherId, sourceUri: uri,
      publishedAt, businessTime: publishedAt, capturedAt: retrievedAt, asOf: retrievedAt,
      permissionScope: result.capture.permissionScope, rawResponseFingerprint: contentHash,
    },
  };
}
