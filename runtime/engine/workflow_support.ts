export type RuntimeFailureCategory =
  | "model_output_error"
  | "source_acquisition_failure"
  | "method_not_applicable"
  | "evidence_insufficient"
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
  if (/MODEL_TIMEOUT|DeepSeek.*超时/i.test(message)) return "model_output_error";
  if (/证据不足|缺少有效来源|insufficient evidence|source_ids|判断超过证据上限|证据上限/i.test(message)) return "evidence_insufficient";
  if (/方法.*不适用|method.*not applicable|precondition.*fail/i.test(message)) return "method_not_applicable";
  if (/web_search|fetch|network|timeout|ECONN|ENOTFOUND|来源取得|网页/i.test(message)) return "source_acquisition_failure";
  if (/schema|contract|合同|不存在的判断|未绑定|结构校验|validation|确定性本体规则|直接连接|端点类型/i.test(message)) return "contract_implementation_error";
  return "model_output_error";
}
