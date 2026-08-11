import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EVIDENCE_SOURCE_CATALOG } from "@/src/capabilities/generated-evidence-sources";
import { planEvidenceAcquisition } from "@/src/research/evidence-acquisition-planner";
import { assessEvidenceCredibility, type EvidenceCredibilityInput } from "@/src/research/evidence-credibility";

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function credibleInput(overrides: Partial<EvidenceCredibilityInput> = {}): EvidenceCredibilityInput {
  const quote = "2026年6月集成电路产量517亿块，同比增长18.8%。";
  const body = `国家统计局月度工业生产表。${quote}统计范围为规模以上工业企业。`;
  return {
    sourceId: "nbs-2026-06-integrated-circuit",
    authorityClass: "government_statistics",
    producerId: "国家统计局",
    sourceRole: "primary_producer",
    sourceTier: "S1",
    capture: { body, quote, locator: "规模以上工业主要产品产量/集成电路", contentHash: sha256(body), permissionScope: "public_research_use" },
    timing: { publishedAt: "2026-07-15T02:00:00Z", businessTime: "2026-06-30T00:00:00Z", retrievedAt: "2026-08-11T03:00:00Z", informationCutoff: "2026-08-11T03:01:00Z" },
    methodology: { metricDefinition: "规模以上工业企业集成电路产量", unit: "亿块", population: "年主营业务收入2000万元及以上工业企业", revisionPolicy: "企业范围变化时调整可比口径" },
    lineage: { acquisitionChannel: "official_web", upstreamResolved: true, independentSourceGroup: "nbs-industrial-production" },
    ...overrides,
  };
}

describe("cross-scenario evidence architecture", () => {
  it("keeps free MCP transport separate from evidence authority", () => {
    expect(EVIDENCE_SOURCE_CATALOG.policy).toMatchObject({ channelIsNotSource: true, freeDoesNotMeanFormal: true, searchAndAiAreDiscoveryOnly: true });
    const openbb = EVIDENCE_SOURCE_CATALOG.sources.find((source) => source.id === "openbb_mcp_transport")!;
    const keyvex = EVIDENCE_SOURCE_CATALOG.sources.find((source) => source.id === "keyvex_public_mcp")!;
    expect(openbb).toMatchObject({ authorityClass: "transport_aggregator", evidenceUse: "discovery_only", admissionStatus: "conditional" });
    expect(keyvex).toMatchObject({ authorityClass: "secondary_normalizer", evidenceUse: "corroboration_only", admissionStatus: "pilot" });
    expect(EVIDENCE_SOURCE_CATALOG.sources.filter((source) => source.admissionStatus === "active").every((source) => source.channels.every((channel) => channel.endpoint.startsWith("https://")))).toBe(true);
  });

  it("adapts the fallback chain to industry, company, macro and event evidence needs", () => {
    const industry = planEvidenceAcquisition({
      requirementId: "industry-production", geography: "CN", subjects: ["semiconductor_production"], queryTerms: ["集成电路", "产量", "同比"], requiredIndependentGroups: 2,
      existingConnectors: [{ id: "htsc_research_mcp", subjects: ["semiconductor_production"], sourceRole: "professional_research", sourceGroup: "htsc-research", operationalStatus: "live" }],
    });
    expect(industry.attempts[0]).toMatchObject({ stage: "existing_mcp", sourceId: "htsc_research_mcp" });
    expect(industry.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "nbs_china_official_web", stage: "official_web_or_pdf", expectedUse: "formal_fact" }),
      expect.objectContaining({ sourceId: "miit_china_official_web", stage: "official_web_or_pdf", expectedUse: "formal_fact" }),
    ]));
    expect(industry.attempts.at(-1)).toMatchObject({ stage: "web_discovery", expectedUse: "discovery_only" });

    const company = planEvidenceAcquisition({ requirementId: "company-filing", geography: "CN", subjects: ["company_filings"], queryTerms: ["定期报告", "收入"], requiredIndependentGroups: 2 });
    expect(company.attempts.map((item) => item.sourceId)).toEqual(expect.arrayContaining(["cninfo_official_disclosure", "sse_official_disclosure", "szse_official_disclosure"]));
    const macro = planEvidenceAcquisition({ requirementId: "global-macro", geography: "GLOBAL", subjects: ["macro"], queryTerms: ["GDP", "inflation"], requiredIndependentGroups: 2 });
    expect(macro.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "world_bank_indicators_api", stage: "free_official_api" })]));
    const usEvent = planEvidenceAcquisition({ requirementId: "us-event", geography: "US", subjects: ["events"], queryTerms: ["8-K", "material event"], requiredIndependentGroups: 1 });
    expect(usEvent.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "sec_edgar_official_api", expectedUse: "formal_fact" })]));
  });

  it("uses non-compensating credibility gates instead of an average quality score", () => {
    expect(assessEvidenceCredibility(credibleInput())).toMatchObject({ decision: "formal_fact", claimStrengthCeiling: "direct_fact", hardFailures: [] });
    const measurement = assessEvidenceCredibility(credibleInput({
      authorityClass: "professional_measurement", producerId: "华泰证券研究所", sourceRole: "direct_measurement", sourceTier: "S3",
      lineage: { acquisitionChannel: "htsc_research_mcp", upstreamResolved: true, independentSourceGroup: "htsc-research" },
    }));
    expect(measurement).toMatchObject({ decision: "formal_measurement", claimStrengthCeiling: "bounded_measurement" });
    const search = assessEvidenceCredibility(credibleInput({ authorityClass: "search_ai", producerId: "search-engine", sourceRole: "discovery_only", sourceTier: "S8" }));
    expect(search).toMatchObject({ decision: "discovery_only", claimStrengthCeiling: "context_only" });
    const normalized = assessEvidenceCredibility(credibleInput({ authorityClass: "secondary_normalizer", producerId: "KeyVex", sourceRole: "professional_research", sourceTier: "S4" }));
    expect(normalized).toMatchObject({ decision: "corroboration_only" });
    expect(normalized.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/二级来源/)]));

    const timeTravel = assessEvidenceCredibility(credibleInput({ timing: { ...credibleInput().timing, publishedAt: "2026-08-12T00:00:00Z" } }));
    expect(timeTravel).toMatchObject({ decision: "rejected", claimStrengthCeiling: "none" });
    expect(timeTravel.hardFailures).toEqual(expect.arrayContaining([expect.stringMatching(/截止日/)]));
    const tampered = assessEvidenceCredibility(credibleInput({ capture: { ...credibleInput().capture, contentHash: `sha256:${"0".repeat(64)}` } }));
    expect(tampered).toMatchObject({ decision: "rejected" });
    expect(tampered.dimensions.find((item) => item.id === "integrity")?.status).toBe("failed");
  });
});
