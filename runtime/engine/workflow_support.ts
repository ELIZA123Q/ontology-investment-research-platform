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

export function classifyRuntimeFailure(error: unknown): RuntimeFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/JOB_BUDGET_EXCEEDED|JOB_HARD_TIMEOUT/i.test(message)) return "budget_exceeded";
  if (/MODEL_TIMEOUT|DeepSeek.*超时/i.test(message)) return "model_output_error";
  if (/证据不足|缺少有效来源|insufficient evidence|source_ids|判断超过证据上限|证据上限/i.test(message)) return "evidence_insufficient";
  if (/方法.*不适用|method.*not applicable|precondition.*fail/i.test(message)) return "method_not_applicable";
  // 模型 API 连接失败仍归 model_output_error，但文案在 formatRuntimeFailureMessage 中单独说明。
  if (/Connection error|ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|network error|socket hang up/i.test(message)) {
    return "model_output_error";
  }
  if (/web_search|fetch_public|来源取得|网页抓取|Bing/i.test(message)) return "source_acquisition_failure";
  if (
    /structured_schema_contract|optional\(\) without \.nullable\(\)|Zod field at/i.test(message)
    || /schema|contract|合同|不存在的判断|未绑定|结构校验|validation|确定性本体规则|直接连接|端点类型/i.test(message)
  ) return "contract_implementation_error";
  return "model_output_error";
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
