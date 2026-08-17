import { createHash } from "node:crypto";
import type { EvidenceFact, SourceSnapshot } from "@/src/contracts/evidence";
import type { VerificationResult } from "@/src/governance/verifiers";
import { normalizeSourceDocumentAttestation } from "@/src/tools/source-document-attestation";

const hashBody = (body: string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;

export function verifySourceSnapshot(snapshot: SourceSnapshot): VerificationResult {
  const errors: string[] = [];
  if (!snapshot.uri.trim()) errors.push("source uri is required");
  if (!snapshot.locator.trim()) errors.push("source locator is required");
  if (!snapshot.quote.trim()) errors.push("source quote is required");
  if (snapshot.quote.trim() && !snapshot.body.includes(snapshot.quote)) errors.push("quote cannot be located in captured body");
  if (hashBody(snapshot.body) !== snapshot.contentHash) errors.push("captured body hash mismatch");
  if (!snapshot.acquisition.connectorId.trim()) errors.push("connector id is required");
  if (!snapshot.acquisition.upstreamSourceId.trim()) errors.push("upstream source id is required");
  if (!snapshot.acquisition.requestFingerprint.startsWith("sha256:")) errors.push("request fingerprint is required");
  if (snapshot.acquisition.rawResponseHash !== snapshot.contentHash) errors.push("raw response hash mismatch");
  try {
    const attestation = normalizeSourceDocumentAttestation(snapshot.documentAttestation);
    if (attestation && attestation.rawContentHash === snapshot.contentHash) errors.push("document raw hash must not be reused as captured excerpt body hash");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (Number.isNaN(Date.parse(snapshot.acquisition.retrievedAt))) errors.push("retrieval timestamp is invalid");
  if (snapshot.permissionScope === "restricted") errors.push("restricted capture cannot be promoted");
  return { verifier: "source-snapshot", passed: errors.length === 0, errors, warnings: [] };
}

export function verifyEvidenceFactPromotion(
  snapshot: SourceSnapshot,
  candidate: Pick<EvidenceFact, "statement" | "factType" | "confidence">,
): VerificationResult {
  const snapshotResult = verifySourceSnapshot(snapshot);
  const errors = [...snapshotResult.errors];
  if (snapshot.verification !== "verified") errors.push("snapshot is not verified");
  if (!candidate.statement.trim()) errors.push("fact statement is required");
  if (candidate.statement.trim() !== snapshot.quote.trim()) errors.push("v1 promotion requires the fact statement to equal the located quote");
  return {
    verifier: "evidence-fact-promotion",
    passed: errors.length === 0,
    errors,
    warnings: candidate.factType === "forecast" ? ["forecast must not be expressed as an observed fact"] : [],
  };
}
