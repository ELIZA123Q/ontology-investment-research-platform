import { SOURCE_DOCUMENT_ATTESTATION_RULES } from "@/src/tools/generated/source-document-attestation-rules";

export interface SourceDocumentAttestation {
  rawContentHash: string;
  byteLength: number;
  mimeType: string;
}

const rules = SOURCE_DOCUMENT_ATTESTATION_RULES.attestation;

/**
 * A document attestation fingerprints the full downloaded byte stream. It is
 * intentionally distinct from the captured excerpt's body/content hash.
 */
export function normalizeSourceDocumentAttestation(value: unknown): SourceDocumentAttestation | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("document attestation must be an object");
  const raw = value as Record<string, unknown>;
  const rawContentHash = String(raw.raw_content_hash || raw.rawContentHash || "").trim();
  const byteLength = Number(raw.byte_length ?? raw.byteLength);
  const mimeType = String(raw.mime_type || raw.mimeType || "").trim().toLowerCase();
  const missing = [
    !rawContentHash ? "raw_content_hash" : undefined,
    raw.byte_length === undefined && raw.byteLength === undefined ? "byte_length" : undefined,
    !mimeType ? "mime_type" : undefined,
  ].filter((item): item is string => Boolean(item));
  if (missing.length) throw new Error(`document attestation requires ${missing.join(", ")}`);
  if (!(new RegExp(rules.hash_pattern).test(rawContentHash))) throw new Error("document attestation rawContentHash must be sha256");
  if (!Number.isSafeInteger(byteLength) || byteLength < rules.minimum_byte_length) throw new Error("document attestation byteLength is invalid");
  if (!(rules.mime_types as readonly string[]).includes(mimeType)) throw new Error(`document attestation MIME type is not allowed: ${mimeType}`);
  return { rawContentHash, byteLength, mimeType };
}
