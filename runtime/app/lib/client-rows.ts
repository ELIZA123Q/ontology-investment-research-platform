import type { ArtifactPayload } from "@/adapters/db_read_models";
import type { ResearchWorkItem, SourceRecord } from "@/engine/types";

/** Slim source row for client boards — never include snapshot_text / search_excerpt. */
export function sourceRowForClient(source: Pick<
  SourceRecord,
  | "id"
  | "title"
  | "publisher"
  | "published_at"
  | "url"
  | "locator"
  | "usability_status"
  | "retrieval_status"
  | "authority_type"
  | "source_tier"
  | "source_group"
  | "quote_verified"
  | "source_quote"
  | "failure_detail"
>) {
  return {
    id: String(source.id),
    title: String(source.title),
    publisher: String(source.publisher),
    published_at: source.published_at ? String(source.published_at) : null,
    url: String(source.url),
    locator: source.locator ? String(source.locator) : undefined,
    usability_status: source.usability_status ? String(source.usability_status) : undefined,
    retrieval_status: source.retrieval_status ? String(source.retrieval_status) : undefined,
    authority_type: source.authority_type ? String(source.authority_type) : undefined,
    source_tier: source.source_tier ? String(source.source_tier) : undefined,
    source_group: source.source_group ? String(source.source_group) : undefined,
    quote_verified: Boolean(source.quote_verified),
    source_quote: source.source_quote ? String(source.source_quote) : undefined,
    failure_detail: source.failure_detail ? String(source.failure_detail) : undefined,
  };
}

export type ClientSourceRow = ReturnType<typeof sourceRowForClient>;

/** Slim work item for review UIs — omit payload_json. */
export function workItemForClient(item: Omit<ResearchWorkItem, "payload_json"> & { payload_json?: string }) {
  return {
    id: String(item.id),
    run_id: String(item.run_id),
    kind: String(item.kind),
    stage: String(item.stage),
    target_type: String(item.target_type),
    target_id: String(item.target_id),
    title: String(item.title),
    status: String(item.status),
    priority: String(item.priority),
    reason: String(item.reason || ""),
    note: String(item.note || ""),
    resolution: String(item.resolution || ""),
    artifact_id: String(item.artifact_id || ""),
    attempt: Number(item.attempt || 0),
    created_at: String(item.created_at || ""),
    updated_at: String(item.updated_at || ""),
    source_event_id: item.source_event_id ? String(item.source_event_id) : null,
  };
}

export type ClientWorkItemRow = ReturnType<typeof workItemForClient>;

/** Artifact fields StageWorkspace / CompareWorkspace actually render. */
export function artifactForWorkspace(artifact: ArtifactPayload): ArtifactPayload {
  return {
    id: artifact.id,
    run_id: artifact.run_id,
    kind: artifact.kind,
    version: artifact.version,
    status: artifact.status,
    json_content: artifact.json_content || "{}",
    markdown_content: artifact.markdown_content || "",
    model_name: artifact.model_name ?? null,
    prompt_version: artifact.prompt_version || "",
    tool_usage: artifact.tool_usage || "",
    error_message: artifact.error_message ?? null,
    created_at: artifact.created_at,
    approved_at: artifact.approved_at ?? null,
  };
}

/** Minimal work-item fields for ResearchGraph action chips. */
export function workItemForGraph(item: Pick<ResearchWorkItem, "id" | "target_id" | "status" | "title" | "reason" | "stage" | "kind">) {
  return {
    id: String(item.id),
    target_id: String(item.target_id),
    status: item.status,
    title: String(item.title),
    reason: String(item.reason || ""),
    stage: String(item.stage),
    kind: item.kind,
  };
}
