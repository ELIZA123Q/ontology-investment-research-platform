import type { SourceCandidate } from "@/src/contracts";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

export interface ResearcherMaterialInput {
  uri: string;
  title: string;
  publisherId?: string;
  publishedAt?: string;
  sourceType?: SourceCandidate["sourceType"];
  locator: string;
  quote: string;
  context?: string;
  permissionConfirmed: boolean;
}

export class ResearcherMaterialError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ResearcherMaterialError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new ResearcherMaterialError(`${field} exceeds ${max} characters`, 413);
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, field, max);
}

function publicUri(value: unknown): string {
  const normalized = text(value, "uri", 2_000);
  let parsed: URL;
  try { parsed = new URL(normalized); }
  catch { throw new ResearcherMaterialError("uri must be a valid public http(s) URL"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new ResearcherMaterialError("uri must be a public http(s) URL without embedded credentials");
  return parsed.toString();
}

function timestamp(value: unknown): string | undefined {
  const normalized = optionalText(value, "publishedAt", 100);
  if (!normalized) return undefined;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw new ResearcherMaterialError("publishedAt must be a valid date or ISO timestamp");
  if (parsed > Date.now() + 86_400_000) throw new ResearcherMaterialError("publishedAt cannot be in the future");
  return new Date(parsed).toISOString();
}

export function buildResearcherMaterialResult(input: unknown, capturedAt = new Date().toISOString()): UnifiedSourceToolResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ResearcherMaterialError("material must be an object");
  const material = input as Partial<ResearcherMaterialInput>;
  if (material.permissionConfirmed !== true) throw new ResearcherMaterialError("research-use permission and excerpt accuracy must be confirmed");
  const uri = publicUri(material.uri);
  const title = text(material.title, "title", 300);
  const locator = text(material.locator, "locator", 1_000);
  const quote = text(material.quote, "quote", 20_000);
  const context = optionalText(material.context, "context", 200_000);
  if (context && !context.includes(quote)) throw new ResearcherMaterialError("quote must be locatable in the provided context");
  const sourceType = material.sourceType || "secondary";
  if (sourceType !== "primary" && sourceType !== "secondary") throw new ResearcherMaterialError("sourceType must be primary or secondary");
  const publisherId = optionalText(material.publisherId, "publisherId", 200) || new URL(uri).hostname.replace(/^www\./, "");
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) throw new ResearcherMaterialError("capturedAt must be a valid timestamp");
  const isoCapturedAt = captured.toISOString();
  return {
    connectorId: "researcher.material",
    operation: "submit_located_excerpt",
    requestParameters: { uri, captureExtent: context ? "provided_context" : "quote_only", submittedBy: "researcher" },
    requestedAt: isoCapturedAt,
    retrievedAt: isoCapturedAt,
    upstream: {
      sourceId: uri,
      uri,
      title,
      publisherId,
      publishedAt: timestamp(material.publishedAt),
      sourceType,
    },
    capture: {
      body: context || quote,
      locator,
      quote,
      permissionScope: "user_supplied",
    },
  };
}
