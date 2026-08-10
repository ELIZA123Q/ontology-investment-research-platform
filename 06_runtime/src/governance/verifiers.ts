import type { AgentId, Artifact, EvidenceFact, ReportSurfaceData, SourceReference, UiSurface } from "@/src/contracts";
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

export function verifyModelDraftSections(data: ReportSurfaceData, sourceRefs: SourceReference[], facts: EvidenceFact[]): VerificationResult {
  const errors: string[] = [];
  const validSources = new Set(sourceRefs.filter((source) => source.verification === "verified" && verifySourceReference(source).passed).map((source) => source.sourceId));
  const validFacts = new Map(facts.filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact]));
  const applications = new Map((data.methodApplications || []).map((application) => [application.id, application]));
  for (const section of data.sections || []) {
    if (!section.modelDraft) continue;
    const authorizedFacts = new Set((section.methodApplicationIds || []).flatMap((id) => applications.get(id)?.evidenceFactIds || []));
    if (!section.sourceIds.length || section.sourceIds.some((id) => !validSources.has(id))) errors.push(`model-drafted section ${section.key} lacks verified source references`);
    if (!section.evidenceFactIds?.length || section.evidenceFactIds.some((id) => !validFacts.has(id) || !authorizedFacts.has(id))) errors.push(`model-drafted section ${section.key} lacks MethodApplication-authorized EvidenceFact references`);
    const factSourceIds = new Set((section.evidenceFactIds || []).map((id) => validFacts.get(id)?.snapshotId).filter(Boolean));
    if (section.sourceIds.some((id) => !factSourceIds.has(id))) errors.push(`model-drafted section ${section.key} source and EvidenceFact lineage do not match`);
    const prose = [...section.paragraphs, ...section.bullets].join("\n");
    if (/<script|javascript:|onerror\s*=|onclick\s*=/i.test(prose)) errors.push(`model-drafted section ${section.key} contains executable markup`);
    if (/买入|卖出|增持|减持|目标价|保证收益|稳赚/i.test(prose)) errors.push(`model-drafted section ${section.key} contains a prohibited investment recommendation`);
  }
  return { verifier: "model-section-boundary", passed: errors.length === 0, errors, warnings: [] };
}

export function verifyUiSurface(surface: UiSurface): VerificationResult {
  const allowed = TRUSTED_COMPONENTS.includes(surface.component);
  const serialized = JSON.stringify(surface.data);
  const unsafe = /<script|javascript:|onerror\s*=|onclick\s*=/i.test(serialized);
  const errors = [...(!allowed ? [`unapproved component: ${surface.component}`] : []), ...(unsafe ? ["surface contains executable markup"] : [])];
  return { verifier: "trusted-ui", passed: errors.length === 0, errors, warnings: [] };
}
