import "server-only";

import { getRun, recordResearchExperienceEvent, upsertSource } from "../adapters/db";
import { normalizeAuthorityType } from "./authority_types";
import { captureSourceSnapshot } from "./source_snapshot";
import { normalizeSourceAcquisitionInput, type SourceAcquisitionInput } from "./source_acquisition_input";

export type { SourceAcquisitionInput } from "./source_acquisition_input";
export { normalizeSourceAcquisitionInput } from "./source_acquisition_input";

export async function acquirePublicSource(runId: string, raw: unknown) {
  if (!getRun(runId)) throw new Error("研究任务不存在");
  const input = normalizeSourceAcquisitionInput(raw);
  const snapshot = await captureSourceSnapshot({
    url: input.url,
    locator: input.locator,
    source_quote: input.source_quote,
  });
  const source = upsertSource(runId, {
    url: input.url,
    title: input.title,
    publisher: input.publisher,
    published_at: new Date(input.published_at).toISOString(),
    source_type: "user_supplied_public_evidence",
    source_tier: input.source_tier as SourceAcquisitionInput["source_tier"] & ("S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8"),
    authority_type: normalizeAuthorityType(input.authority_type),
    source_group: input.source_group || input.publisher,
    search_excerpt: "研究者明确提供；仍须由 Stage03 形成事实草稿并逐项审阅",
    locator: snapshot.locator,
    captured_at: snapshot.captured_at,
    content_hash: snapshot.content_hash,
    usability_status: snapshot.usability_status,
    failure_category: snapshot.failure_category,
    failure_detail: snapshot.failure_detail,
    final_url: snapshot.final_url,
    content_mime: snapshot.content_mime,
    http_status: snapshot.http_status,
    retrieval_status: snapshot.retrieval_status,
    snapshot_text: snapshot.snapshot_text,
    source_quote: snapshot.source_quote,
    quote_verified: snapshot.quote_verified,
  });
  const accepted = source.retrieval_status === "captured"
    && source.usability_status === "usable"
    && Boolean(source.quote_verified)
    && /^[a-f0-9]{64}$/.test(source.content_hash || "");
  recordResearchExperienceEvent({
    runId,
    eventType: "source_acquisition_completed",
    actorType: "human",
    stage: "stage_03",
    targetType: "SourceDocument",
    targetId: source.id,
    outcome: accepted ? "accepted" : "rejected",
    payload: {
      retrieval_status: source.retrieval_status,
      usability_status: source.usability_status,
      quote_verified: Boolean(source.quote_verified),
    },
    dedupeKey: `source_acquisition_completed:${source.id}:${source.content_hash || "no-hash"}`,
  });
  return {
    accepted,
    source: { ...source, snapshot_text: undefined, snapshot_length: source.snapshot_text?.length || 0 },
    boundary: "已取得来源只进入 Source Registry；必须由 Stage03 绑定为事实草稿并经人工批准后，才能参与判断。",
  };
}
