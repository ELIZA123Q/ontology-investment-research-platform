export type RuntimeFailureCategory =
  | "model_output_error"
  | "source_acquisition_failure"
  | "method_not_applicable"
  | "evidence_insufficient"
  | "budget_exceeded"
  | "contract_implementation_error";

export function compactStructuredArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactStructuredArtifact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "document_markdown")
      .map(([key, item]) => [key, compactStructuredArtifact(item)]),
  );
}

/**
 * Stage04/05 上游默认投喂证据压缩视图：Bundle + Summary + Record 样例，
 * 保留准备说明摘录；每 JU 保留更多 support/counter/gap，避免 04 裁决信息面过瘦。
 */
export function compactStage03ForUpstream(value: unknown, samplePerUnit = 6): unknown {
  const base = compactStructuredArtifact(value) as Record<string, unknown> | unknown;
  if (!base || typeof base !== "object" || Array.isArray(base)) return base;
  const data = { ...(base as Record<string, unknown>) };
  const prep = String(data.preparation_markdown || data.document_markdown || "").trim();
  delete data.preparation_markdown;
  delete data.instance_manifest_yaml;
  delete data.document_markdown;
  if (prep) {
    data.preparation_excerpt = prep.length > 8_000
      ? `${prep.slice(0, 8_000)}\n…[preparation truncated for upstream]`
      : prep;
  }

  const drafts = Array.isArray(data.evidence_drafts) ? (data.evidence_drafts as any[]) : [];
  const draftById = new Map(drafts.map((d) => [String(d.id), d]));
  const bundles = Array.isArray(data.evidence_bundles) ? (data.evidence_bundles as any[]) : [];
  const keepIds = new Set<string>();

  const rankDraft = (draft: any): number => {
    const kind = String(draft?.kind || "");
    const dir = String(draft?.direction || "");
    const directness = String(draft?.directness || "");
    let score = 0;
    if (kind === "counter" || kind === "conflict" || dir === "weaken") score += 100;
    if (kind === "gap") score += 80;
    if (directness === "direct") score += 40;
    if (directness === "indirect") score += 20;
    // 较新 published / 更长 quote 略优先
    const quoteLen = String(draft?.statement || "").length;
    score += Math.min(20, Math.floor(quoteLen / 40));
    return score;
  };
  const pickRanked = (ids: string[], limit: number) => {
    const ranked = ids
      .map((id) => draftById.get(String(id)))
      .filter(Boolean)
      .sort((a, b) => rankDraft(b) - rankDraft(a) || String(a.id).localeCompare(String(b.id)));
    return ranked.slice(0, limit).map((d) => String(d.id));
  };

  if (bundles.length) {
    for (const bundle of bundles) {
      const support = pickRanked(bundle.support_evidence_ids || [], samplePerUnit);
      const counter = pickRanked(bundle.counter_evidence_ids || [], Math.max(samplePerUnit, 4));
      const gaps = pickRanked(bundle.gap_ids || [], Math.max(samplePerUnit, 4));
      for (const id of [...support, ...counter, ...gaps]) keepIds.add(String(id));
    }
  } else {
    const byUnit = new Map<string, any[]>();
    for (const draft of drafts) {
      const units = Array.isArray(draft?.judgment_unit_ids) && draft.judgment_unit_ids.length
        ? draft.judgment_unit_ids.map(String)
        : ["_"];
      for (const unit of units) {
        const list = byUnit.get(unit) || [];
        list.push(draft);
        byUnit.set(unit, list);
      }
    }
    for (const list of byUnit.values()) {
      const counters = list.filter((d) => String(d?.kind) === "counter" || String(d?.direction) === "weaken");
      const gaps = list.filter((d) => String(d?.kind) === "gap");
      const support = list.filter((d) => !counters.includes(d) && !gaps.includes(d));
      for (const draft of [
        ...[...support].sort((a, b) => rankDraft(b) - rankDraft(a)).slice(0, samplePerUnit),
        ...[...counters].sort((a, b) => rankDraft(b) - rankDraft(a)).slice(0, Math.max(samplePerUnit, 4)),
        ...[...gaps].sort((a, b) => rankDraft(b) - rankDraft(a)).slice(0, Math.max(samplePerUnit, 4)),
      ]) {
        keepIds.add(String(draft.id));
      }
    }
  }
  data.evidence_drafts = drafts.filter((d) => keepIds.has(String(d.id)));
  data.evidence_compression = {
    mode: "bundle_summary_samples",
    sample_per_unit: samplePerUnit,
    retained_draft_ids: [...keepIds],
    preparation_excerpt_chars: String(data.preparation_excerpt || "").length,
    ranking: "counter_gap_direct_first",
    note: "04 消费 bundles/summaries + 每 JU 按反证/缺口/直接性排序的多样本 Record + preparation_excerpt；完整 preparation 见 Stage03 产物",
  };
  return data;
}


export function classifyRuntimeFailure(error: unknown): RuntimeFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/JOB_BUDGET_EXCEEDED|JOB_HARD_TIMEOUT/i.test(message)) return "budget_exceeded";
  if (/MODEL_TIMEOUT|DeepSeek.*超时/i.test(message)) return "model_output_error";
  // Zod issue JSON 常含 path "precondition_checks" 与 values "fail"；旧正则会误判为 method_not_applicable，
  // 进而把可重试的模型契约错误打成 waiting_for_input，阻断重新生成。
  if (isZodIssuePayload(message)) return "model_output_error";
  if (/证据不足|缺少有效来源|insufficient evidence|source_ids|判断超过证据上限|证据上限/i.test(message)) return "evidence_insufficient";
  if (/方法不适用|method not applicable|方法.*不适用/i.test(message)) return "method_not_applicable";
  // 模型 API 连接失败仍归 model_output_error，但文案在 formatRuntimeFailureMessage 中单独说明。
  if (/Connection error|ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|network error|socket hang up/i.test(message)) {
    return "model_output_error";
  }
  if (/web_search|fetch_public|query_cninfo|query_datayes|query_china_policy|mcp|来源取得|网页抓取|Bing/i.test(message)) return "source_acquisition_failure";
  if (
    /structured_schema_contract|optional\(\) without \.nullable\(\)|Zod field at/i.test(message)
    || /schema|contract|合同|不存在的判断|未绑定|结构校验|validation|确定性本体规则|直接连接|端点类型/i.test(message)
  ) return "contract_implementation_error";
  return "model_output_error";
}

/** 识别 schema.parse / safeParse 抛出的 Zod issues 序列化文本。 */
function isZodIssuePayload(message: string): boolean {
  if (/"code"\s*:\s*"(invalid_value|invalid_type|invalid_union|too_big|too_small|invalid_enum_value)"/.test(message)) {
    return true;
  }
  return /Invalid (option|discriminator|input)|No matching discriminator|Too big:|Too small:|expected array|expected string|expected object/i.test(message);
}

/** 把 SDK 英文短错误翻成可操作的中文说明。 */
export function formatRuntimeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/Connection error|ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|socket hang up/i.test(raw)) {
    return (
      "无法连接模型 API（Connection error）。请确认："
      + "1) 本机终端能访问 DEEPSEEK_BASE_URL；"
      + "2) 系统代理/VPN 正常；"
      + "3) 用本机终端执行 npm run dev:singleton，不要在受限沙箱里启动。"
      + ` 原始错误: ${raw}`
    );
  }
  return raw;
}
