/**
 * ONTO-PRECHECK-001：Stage03 非权威预检。
 * 对事实侧即可判定的正式规则给出 advisory/blocking_soft 预警；
 * 不改写 Judgment；Stage04 确认时仍由 applyDeterministicRuleEvaluations 权威挡门。
 */
import type { SourceRecord } from "../../schemas/types";
import { STAGE03_PRECHECK_RULES, type Stage03PrecheckRuleId } from "./rule_predicates";

export type Stage03PrecheckSeverity = "advisory" | "blocking_soft";

export type Stage03PrecheckFinding = {
  rule_ref: Stage03PrecheckRuleId;
  severity: Stage03PrecheckSeverity;
  evidence_id: string;
  statement: string;
  message: string;
  /** 研究员文案：将在判断确认时挡门 */
  researcher_hint: string;
};

export type Stage03PrecheckSummary = {
  findings: Stage03PrecheckFinding[];
  by_rule: Record<string, number>;
  blocking_soft_count: number;
  advisory_count: number;
};

type EvidenceLike = {
  id?: string;
  kind?: string;
  statement?: string;
  directness?: string;
  scope_ref?: string;
  observed_at?: string;
  valid_from?: string;
  published_at?: string;
  cutoff_at?: string;
  source_ids?: string[];
  proxy_disclosure?: {
    lag?: string | null;
    scope?: string | null;
    non_substitution?: string | null;
  } | null;
  commercialization_stage?: string | null;
  qualification_scope?: {
    product_spec_ref?: string | null;
    customer_ref?: string | null;
    facility_ref?: string | null;
  } | null;
  semiconductor_measurement?: {
    metric_kind?: string | null;
    facility_ref?: string | null;
    wafer_size?: string | null;
    process_or_product_ref?: string | null;
    batch_stage?: string | null;
    unit?: string | null;
    business_time_basis?: string | null;
  } | null;
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTime(value: unknown): number | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function isFact(draft: EvidenceLike): boolean {
  const kind = String(draft.kind || "fact_draft");
  return kind !== "gap" && kind !== "conflict";
}

function measurementComplete(m: EvidenceLike["semiconductor_measurement"]): boolean {
  if (!m) return false;
  return Boolean(
    hasText(m.metric_kind)
    && hasText(m.facility_ref)
    && hasText(m.wafer_size)
    && hasText(m.process_or_product_ref)
    && hasText(m.batch_stage)
    && hasText(m.unit)
    && hasText(m.business_time_basis),
  );
}

function looksLikeCapacityOrYield(statement: string): boolean {
  // 仅在明确描述产能/良率度量时触发六维字段要求；
  // 排除：否定语境（未发现/不构成）、纯设施引用（晶圆厂）、风险/约束讨论
  const s = statement;
  if (!/产能|良率|yield|capacity|wafer|晶圆/.test(s)) return false;
  // 否定语境：产能受限、未发现产能问题、不影响产能等
  if (/未发现.*产能|产能.*受限|产能.*制约|产能.*不|不构成.*产能/.test(s)) return false;
  // "晶圆厂" 仅是设施/组织引用，不是度量
  if (/晶圆厂/.test(s) && !/晶圆.*产出|晶圆.*产能|晶圆.*良率|晶圆.*wafer|wafer.*output|wafer.*capacity/.test(s)) return false;
  return true;
}

function looksLikeCommercialization(statement: string): boolean {
  return /量产|认证|导入|设计导入|design.?win|pilot|sample|样品|客户验证|商业化/.test(statement);
}

/**
 * 对 Stage03 证据草稿做本体约束预检。cutoff/scope 来自任务或结构默认值。
 */
export function precheckStage03OntologyConstraints(input: {
  evidence_drafts: EvidenceLike[];
  sources?: SourceRecord[];
  default_scope_ref?: string;
  cutoff_at?: string;
}): Stage03PrecheckSummary {
  const findings: Stage03PrecheckFinding[] = [];
  const sources = new Map((input.sources || []).map((item) => [item.id, item]));
  const cutoff = parseTime(input.cutoff_at);
  const expectedScope = String(input.default_scope_ref || "").trim();

  for (const draft of input.evidence_drafts || []) {
    if (!isFact(draft)) continue;
    const evidenceId = String(draft.id || "").trim() || "EV-unknown";
    const statement = String(draft.statement || "").trim() || "未命名事实";

    // semiconductor_proxy_disclosure
    if (draft.directness === "proxy") {
      const missing = !hasText(draft.proxy_disclosure?.lag)
        || !hasText(draft.proxy_disclosure?.scope)
        || !hasText(draft.proxy_disclosure?.non_substitution);
      if (missing) {
        findings.push({
          rule_ref: "semiconductor_proxy_disclosure",
          severity: "blocking_soft",
          evidence_id: evidenceId,
          statement,
          message: "代理证据缺少滞后、适用范围或不可替代直接证据的披露",
          researcher_hint: "将在判断确认时挡门：请补全代理披露，或改标为直接/间接证据",
        });
      }
    }

    // semiconductor_qualification_stage_alignment（事实侧元数据）
    if (looksLikeCommercialization(statement) || draft.commercialization_stage) {
      if (!hasText(draft.commercialization_stage)) {
        findings.push({
          rule_ref: "semiconductor_qualification_stage_alignment",
          severity: "blocking_soft",
          evidence_id: evidenceId,
          statement,
          message: "商业化/认证相关事实缺少结构化阶段字段",
          researcher_hint: "将在判断确认时挡门：请标注 commercialization_stage，并核对产品/客户/设施范围",
        });
      } else if (!draft.qualification_scope
        || !hasText(draft.qualification_scope.product_spec_ref)
        || !hasText(draft.qualification_scope.customer_ref)
        || !hasText(draft.qualification_scope.facility_ref)) {
        findings.push({
          rule_ref: "semiconductor_qualification_stage_alignment",
          severity: "advisory",
          evidence_id: evidenceId,
          statement,
          message: "认证范围（产品规格/客户/设施）不完整，判断阶段可能被阻断",
          researcher_hint: "判断确认前建议补齐 qualification_scope，否则可能无法升级结论强度",
        });
      }
    }

    // semiconductor_capacity_yield_scope_alignment
    const hasMeasurement = Boolean(draft.semiconductor_measurement);
    if (hasMeasurement || looksLikeCapacityOrYield(statement)) {
      if (!measurementComplete(draft.semiconductor_measurement)) {
        findings.push({
          rule_ref: "semiconductor_capacity_yield_scope_alignment",
          severity: "blocking_soft",
          evidence_id: evidenceId,
          statement,
          message: "产能/良率事实缺少设施、晶圆、制程/产品、批次、单位或业务时间六维口径",
          researcher_hint: "将在判断确认时挡门：请补全 semiconductor_measurement 六维字段",
        });
      }
    }

    // evidence_scope_time_alignment（事实侧部分）
    const scopeRef = String(draft.scope_ref || "").trim();
    if (expectedScope && scopeRef && scopeRef !== expectedScope) {
      findings.push({
        rule_ref: "evidence_scope_time_alignment",
        severity: "blocking_soft",
        evidence_id: evidenceId,
        statement,
        message: `事实范围 ${scopeRef} 与任务范围 ${expectedScope} 不一致`,
        researcher_hint: "将在判断确认时挡门：请纠正范围绑定或拆分跨范围判断",
      });
    }
    const factTimes = [draft.observed_at, draft.valid_from, draft.published_at]
      .map(parseTime);
    const declaredCutoff = parseTime(draft.cutoff_at);
    // cutoff_at 是研究边界而非事实发生时间。持久层有的路径写到整秒，
    // 有的路径写到同一秒的 .999；两者语义相同，不能因毫秒精度差异误报越界。
    // 真正的事实时间仍按毫秒严格校验。
    const cutoffBoundaryInvalid = Boolean(cutoff) && (
      declaredCutoff == null
      || Math.floor(declaredCutoff / 1000) > Math.floor(cutoff! / 1000)
    );
    if (cutoff && (factTimes.some((value) => value == null || value > cutoff) || cutoffBoundaryInvalid)) {
      findings.push({
        rule_ref: "evidence_scope_time_alignment",
        severity: "blocking_soft",
        evidence_id: evidenceId,
        statement,
        message: "事实时间晚于研究截止日或缺少可解析时间戳",
        researcher_hint: "将在判断确认时挡门：请核验观测/公布/有效时间不晚于截止日",
      });
    }
    for (const sourceId of draft.source_ids || []) {
      const source = sources.get(String(sourceId));
      if (!source) continue;
      const published = parseTime(source.published_at);
      if (source.usability_status !== "usable"
        || source.retrieval_status !== "captured"
        || !source.quote_verified
        || !source.content_hash
        || (cutoff && (!published || published > cutoff))) {
        findings.push({
          rule_ref: "evidence_scope_time_alignment",
          severity: "advisory",
          evidence_id: evidenceId,
          statement,
          message: `绑定来源 ${sourceId} 尚不可用、引文未核验或晚于截止日`,
          researcher_hint: "判断确认前该来源可能无法计入有效证据；请完成抓取与引文核验",
        });
      }
    }
  }

  const by_rule: Record<string, number> = {};
  for (const rule of STAGE03_PRECHECK_RULES) by_rule[rule] = 0;
  for (const finding of findings) {
    by_rule[finding.rule_ref] = (by_rule[finding.rule_ref] || 0) + 1;
  }

  return {
    findings,
    by_rule,
    blocking_soft_count: findings.filter((item) => item.severity === "blocking_soft").length,
    advisory_count: findings.filter((item) => item.severity === "advisory").length,
  };
}

/** 把预检失败转成证据台「最薄弱环节」可读条目 */
export function precheckFindingsAsWeakLinks(summary: Stage03PrecheckSummary, limit = 3): string[] {
  return summary.findings
    .slice()
    .sort((a, b) => Number(b.severity === "blocking_soft") - Number(a.severity === "blocking_soft"))
    .slice(0, limit)
    .map((item) => item.researcher_hint);
}
