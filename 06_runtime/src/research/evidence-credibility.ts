import { createHash } from "node:crypto";

export type EvidenceAuthorityClass =
  | "regulator_api" | "government_statistics" | "statutory_disclosure_platform" | "exchange_disclosure_platform"
  | "official_multilateral_api" | "official_data_aggregator" | "issuer_disclosure" | "professional_measurement"
  | "secondary_normalizer" | "commercial_aggregator" | "news" | "search_ai" | "transport_aggregator";
export type EvidenceUseDecision = "formal_fact" | "formal_measurement" | "corroboration_only" | "discovery_only" | "rejected";
export type QualityStatus = "passed" | "attention" | "failed";

export interface EvidenceCredibilityInput {
  sourceId: string;
  authorityClass: EvidenceAuthorityClass;
  producerId?: string;
  sourceRole: "primary_producer" | "direct_measurement" | "first_party_operating" | "professional_research" | "public_narrative" | "discovery_only";
  sourceTier: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
  capture: {
    body: string;
    quote: string;
    locator: string;
    contentHash: string;
    permissionScope: "public_research_use" | "authorized_research_use" | "user_supplied" | "restricted";
  };
  timing: { publishedAt?: string; businessTime?: string; retrievedAt: string; informationCutoff: string };
  methodology: { metricDefinition?: string; unit?: string; population?: string; revisionPolicy?: string };
  lineage: { acquisitionChannel: string; upstreamResolved: boolean; independentSourceGroup?: string };
}

export interface EvidenceCredibilityAssessment {
  assessmentId: string;
  sourceId: string;
  decision: EvidenceUseDecision;
  claimStrengthCeiling: "direct_fact" | "bounded_measurement" | "context_only" | "none";
  dimensions: Array<{ id: "identity" | "integrity" | "timeliness" | "methodology" | "permission" | "independence"; status: QualityStatus; note: string }>;
  hardFailures: string[];
  warnings: string[];
}

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const validTime = (value?: string) => Boolean(value && !Number.isNaN(Date.parse(value)));

export function assessEvidenceCredibility(input: EvidenceCredibilityInput): EvidenceCredibilityAssessment {
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const authoritative = ["regulator_api", "government_statistics", "statutory_disclosure_platform", "exchange_disclosure_platform", "issuer_disclosure"].includes(input.authorityClass);
  const measurement = ["official_multilateral_api", "official_data_aggregator", "professional_measurement"].includes(input.authorityClass);
  const discoveryOnly = input.sourceRole === "discovery_only" || ["search_ai", "transport_aggregator"].includes(input.authorityClass);
  const identityPassed = Boolean(input.producerId?.trim()) && input.lineage.upstreamResolved;
  if (!identityPassed) hardFailures.push("无法确定真实上游生产者");
  const integrityPassed = /^sha256:[a-f0-9]{64}$/u.test(input.capture.contentHash)
    && hash(input.capture.body) === input.capture.contentHash
    && Boolean(input.capture.locator.trim()) && Boolean(input.capture.quote.trim()) && input.capture.body.includes(input.capture.quote);
  if (!integrityPassed) hardFailures.push("正文、哈希、定位或逐字摘录无法复核");
  const cutoffValid = validTime(input.timing.informationCutoff) && validTime(input.timing.retrievedAt)
    && (!input.timing.publishedAt || (validTime(input.timing.publishedAt) && Date.parse(input.timing.publishedAt) <= Date.parse(input.timing.informationCutoff)));
  if (!cutoffValid) hardFailures.push("发布时间无效或晚于研究截止日");
  if (input.capture.permissionScope === "restricted") hardFailures.push("权限范围禁止晋级");
  const methodologyComplete = Boolean(input.methodology.metricDefinition?.trim() && input.methodology.unit?.trim() && input.methodology.population?.trim());
  if ((measurement || input.sourceRole === "direct_measurement") && !methodologyComplete) warnings.push("测量口径、单位或总体说明不完整");
  if (!input.lineage.independentSourceGroup?.trim()) warnings.push("尚未标注独立来源组，不能用于独立交叉验证计数");
  if (input.authorityClass === "official_data_aggregator") warnings.push("聚合平台不等于原始生产者；独立性必须按原始 series source 归并");
  if (["secondary_normalizer", "commercial_aggregator", "news"].includes(input.authorityClass)) warnings.push("二级来源只能交叉核对或发现原文，不能替代关键一手证据");

  let decision: EvidenceUseDecision;
  if (hardFailures.length) decision = "rejected";
  else if (discoveryOnly) decision = "discovery_only";
  else if (authoritative && input.sourceRole === "primary_producer") decision = "formal_fact";
  else if (measurement && input.sourceRole === "direct_measurement" && methodologyComplete) decision = "formal_measurement";
  else decision = "corroboration_only";

  const claimStrengthCeiling = decision === "formal_fact" ? "direct_fact"
    : decision === "formal_measurement" ? "bounded_measurement"
      : ["corroboration_only", "discovery_only"].includes(decision) ? "context_only" : "none";
  const dimensions: EvidenceCredibilityAssessment["dimensions"] = [
    { id: "identity", status: identityPassed ? "passed" : "failed", note: identityPassed ? "生产者与取得通道已分离记录" : "生产者身份或上游血缘缺失" },
    { id: "integrity", status: integrityPassed ? "passed" : "failed", note: integrityPassed ? "正文、哈希、定位和摘录一致" : "快照完整性失败" },
    { id: "timeliness", status: cutoffValid ? "passed" : "failed", note: cutoffValid ? "满足研究截止日" : "存在时间旅行或时间字段无效" },
    { id: "methodology", status: methodologyComplete || !measurement ? "passed" : "attention", note: methodologyComplete ? "测量定义、单位和总体齐全" : measurement ? "测量方法信息不完整" : "非测量类来源不适用完整测量口径" },
    { id: "permission", status: input.capture.permissionScope === "restricted" ? "failed" : "passed", note: input.capture.permissionScope },
    { id: "independence", status: input.lineage.independentSourceGroup?.trim() ? "passed" : "attention", note: input.lineage.independentSourceGroup || "未标注" },
  ];
  return { assessmentId: `credibility:${hash(JSON.stringify({ sourceId: input.sourceId, contentHash: input.capture.contentHash, cutoff: input.timing.informationCutoff })).slice(7, 31)}`, sourceId: input.sourceId, decision, claimStrengthCeiling, dimensions, hardFailures, warnings };
}
