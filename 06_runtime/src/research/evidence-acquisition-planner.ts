import { EVIDENCE_SOURCE_CATALOG } from "@/src/capabilities/generated-evidence-sources";

export interface ExistingEvidenceConnector {
  id: string;
  subjects: string[];
  sourceRole: "primary_producer" | "direct_measurement" | "professional_research" | "discovery_only";
  sourceGroup: string;
  operationalStatus: "live" | "limited" | "unavailable";
}

export interface EvidenceAcquisitionNeed {
  requirementId: string;
  geography: string;
  subjects: string[];
  queryTerms: string[];
  requiredIndependentGroups: number;
  existingConnectors?: ExistingEvidenceConnector[];
  failedSourceIds?: string[];
}

export interface EvidenceAcquisitionAttempt {
  stage: "existing_mcp" | "free_official_api" | "official_web_or_pdf" | "public_mcp_pilot" | "web_discovery";
  sourceId: string;
  sourceName: string;
  channel: string;
  endpoint: string;
  query: string;
  expectedUse: string;
  sourceGroup: string;
  admissionStatus: string;
  stopCondition: string;
}

export interface EvidenceAcquisitionPlan {
  requirementId: string;
  attempts: EvidenceAcquisitionAttempt[];
  requiredIndependentGroups: number;
  policy: string[];
}

const authorityRank: Record<string, number> = {
  regulator_api: 0, government_statistics: 0, statutory_disclosure_platform: 0, exchange_disclosure_platform: 0,
  official_multilateral_api: 1, official_data_aggregator: 2, secondary_normalizer: 4, commercial_aggregator: 5, transport_aggregator: 6,
};

export function planEvidenceAcquisition(need: EvidenceAcquisitionNeed): EvidenceAcquisitionPlan {
  const failed = new Set(need.failedSourceIds || []);
  const attempts: EvidenceAcquisitionAttempt[] = [];
  for (const connector of need.existingConnectors || []) {
    if (connector.operationalStatus !== "live" || !connector.subjects.some((subject) => need.subjects.includes(subject))) continue;
    attempts.push({
      stage: "existing_mcp", sourceId: connector.id, sourceName: connector.id, channel: "mcp", endpoint: `mcp://${connector.id}`,
      query: need.queryTerms.join(" "), expectedUse: connector.sourceRole === "professional_research" ? "bounded_measurement_or_context" : "formal_if_upstream_resolved",
      sourceGroup: connector.sourceGroup, admissionStatus: "active", stopCondition: "取得可定位快照；仍需检查是否满足独立来源组",
    });
  }
  const candidates = EVIDENCE_SOURCE_CATALOG.sources
    .filter((source) => !failed.has(source.id) && source.geographies.some((item) => item === need.geography || item === "GLOBAL") && source.subjects.some((subject) => need.subjects.includes(subject)))
    .flatMap((source) => source.channels.map((channel) => ({ source, channel })))
    .sort((left, right) => (authorityRank[left.source.authorityClass] ?? 9) - (authorityRank[right.source.authorityClass] ?? 9));
  for (const { source, channel } of candidates) {
    const kind = channel.kind;
    const stage: EvidenceAcquisitionAttempt["stage"] = kind === "official_api" ? "free_official_api"
      : kind.startsWith("official_") ? "official_web_or_pdf"
        : kind.includes("mcp") ? "public_mcp_pilot" : "official_web_or_pdf";
    attempts.push({
      stage, sourceId: source.id, sourceName: source.name, channel: kind, endpoint: channel.endpoint,
      query: `${need.queryTerms.join(" ")} site:${source.producerDomain}`,
      expectedUse: source.evidenceUse, sourceGroup: source.id, admissionStatus: source.admissionStatus,
      stopCondition: "原文已冻结、可信性门通过且独立来源组达到要求",
    });
  }
  attempts.push({
    stage: "web_discovery", sourceId: "open_web_search", sourceName: "互联网检索", channel: "web_search", endpoint: "https://www.google.com/search",
    query: need.queryTerms.join(" "), expectedUse: "discovery_only", sourceGroup: "unresolved", admissionStatus: "discovery_only",
    stopCondition: "只能发现入口；必须打开生产者原文并重新捕获，搜索摘要不得晋级",
  });
  const unique = [...new Map(attempts.map((attempt) => [`${attempt.stage}:${attempt.sourceId}:${attempt.channel}`, attempt])).values()];
  return {
    requirementId: need.requirementId, attempts: unique, requiredIndependentGroups: need.requiredIndependentGroups,
    policy: ["通道不是来源", "免费不等于可信", "搜索与AI摘要只用于发现", "访问失败记录为gap而非反向证据", "达到独立来源组与反证要求后才停止补证"],
  };
}
