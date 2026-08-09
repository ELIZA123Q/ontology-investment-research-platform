import type { AgentId, Artifact, SourceReference, UiSurface } from "@/src/contracts";
import { getAgent, TRUSTED_COMPONENTS } from "@/src/capabilities/registry";

export interface VerificationResult {
  verifier: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function verifyArtifactWrite(agentId: AgentId, artifactKind: Artifact["kind"]): VerificationResult {
  const allowed = getAgent(agentId).canWriteArtifactKinds.includes(artifactKind);
  return { verifier: "artifact-capability", passed: allowed, errors: allowed ? [] : [`${agentId} cannot write ${artifactKind}`], warnings: [] };
}

export function verifySourceReference(source: SourceReference): VerificationResult {
  const errors: string[] = [];
  if (!source.uri) errors.push("source uri is required");
  if (!source.locator) errors.push("source locator is required");
  if (!source.quote.trim()) errors.push("source quote is required");
  if (!source.contentHash) errors.push("source content hash is required");
  return { verifier: "source-provenance", passed: errors.length === 0, errors, warnings: source.verification === "verified" ? [] : ["source is not verified"] };
}

export function verifyReportClaims(data: unknown, sourceRefs: SourceReference[]): VerificationResult {
  const claims = typeof data === "object" && data && "claims" in data && Array.isArray((data as { claims: unknown[] }).claims)
    ? (data as { claims: Array<{ text?: string; sourceIds?: string[] }> }).claims : [];
  const validIds = new Set(sourceRefs.filter((source) => verifySourceReference(source).passed && source.verification === "verified").map((source) => source.sourceId));
  const errors = claims.flatMap((claim, index) => !claim.sourceIds?.length || !claim.sourceIds.every((id) => validIds.has(id)) ? [`claim ${index + 1} lacks verified provenance`] : []);
  return { verifier: "claim-provenance", passed: errors.length === 0, errors, warnings: claims.length ? [] : ["artifact contains no formal claims"] };
}

export function verifyUiSurface(surface: UiSurface): VerificationResult {
  const allowed = TRUSTED_COMPONENTS.includes(surface.component);
  const serialized = JSON.stringify(surface.data);
  const unsafe = /<script|javascript:|onerror\s*=|onclick\s*=/i.test(serialized);
  const errors = [...(!allowed ? [`unapproved component: ${surface.component}`] : []), ...(unsafe ? ["surface contains executable markup"] : [])];
  return { verifier: "trusted-ui", passed: errors.length === 0, errors, warnings: [] };
}
