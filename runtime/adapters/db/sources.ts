import "server-only";
import type { SourceRecord } from "../../engine/types";
import { db } from "./connection";
export function listSources(runId: string): SourceRecord[] {
  return db.prepare("SELECT * FROM source WHERE run_id=? ORDER BY accessed_at DESC").all(runId) as SourceRecord[];
}
export function quarantineUnboundWebCitations(runId: string, boundSourceIds: Iterable<string>): number {
  const bound = [...new Set([...boundSourceIds].map(String).filter(Boolean))];
  const exclusion = bound.length ? ` AND id NOT IN (${bound.map(() => "?").join(",")})` : "";
  const result = db.prepare(`UPDATE source SET
    usability_status='rejected',
    failure_category='source_acquisition_failure',
    failure_detail='Web search candidate was not bound to any approved Stage03 evidence draft; retained for retrieval audit only'
    WHERE run_id=? AND source_type='web_citation'${exclusion}`).run(runId, ...bound);
  return Number(result.changes || 0);
}
export function upsertSource(runId: string, input: Omit<SourceRecord, "id" | "run_id" | "normalized_url" | "accessed_at">): SourceRecord {
  const normalized = normalizeUrl(input.url);
  const prior = db.prepare("SELECT * FROM source WHERE run_id=? AND normalized_url=?").get(runId, normalized) as SourceRecord | undefined;
  if (prior) {
    const priorUsable = prior.usability_status === "usable"
      && prior.retrieval_status === "captured"
      && Boolean(prior.quote_verified);
    const nextUsable = (input.usability_status ?? prior.usability_status) === "usable"
      && (input.retrieval_status ?? prior.retrieval_status) === "captured"
      && Boolean(input.quote_verified === undefined ? prior.quote_verified : input.quote_verified);
    // 已核验可用的来源不得被同 URL 的未核验写入降级（含雷达候选与补证后写）。
    if (priorUsable && !nextUsable) {
      return prior;
    }
    db.prepare(`UPDATE source SET
      title=?,publisher=?,published_at=?,source_type=?,source_tier=?,authority_type=?,source_group=?,search_excerpt=?,locator=?,captured_at=?,content_hash=?,
      usability_status=?,failure_category=?,failure_detail=?,final_url=?,content_mime=?,http_status=?,retrieval_status=?,
      snapshot_text=?,source_quote=?,quote_verified=? WHERE id=?`).run(
      input.title, input.publisher, input.published_at, input.source_type,
      input.source_tier || prior.source_tier || "S8",
      input.authority_type || prior.authority_type || "unknown",
      input.source_group || prior.source_group || sourceGroupFromUrl(input.url, input.publisher), input.search_excerpt,
      input.locator ?? prior.locator ?? input.url,
      input.captured_at ?? prior.captured_at ?? new Date().toISOString(),
      input.content_hash ?? prior.content_hash ?? "",
      input.usability_status ?? prior.usability_status ?? "candidate",
      input.failure_category ?? prior.failure_category ?? "",
      input.failure_detail ?? prior.failure_detail ?? "",
      input.final_url ?? prior.final_url ?? input.url,
      input.content_mime ?? prior.content_mime ?? "",
      input.http_status ?? prior.http_status ?? null,
      input.retrieval_status ?? prior.retrieval_status ?? "not_attempted",
      input.snapshot_text ?? prior.snapshot_text ?? "",
      input.source_quote ?? prior.source_quote ?? "",
      input.quote_verified === undefined ? (prior.quote_verified ? 1 : 0) : (input.quote_verified ? 1 : 0), prior.id,
    );
    return db.prepare("SELECT * FROM source WHERE id=?").get(prior.id) as SourceRecord;
  }
  const accessedAt = new Date().toISOString();
  const row: SourceRecord = {
    id: crypto.randomUUID(),
    run_id: runId,
    normalized_url: normalized,
    accessed_at: accessedAt,
    ...input,
    locator: input.locator || input.url,
    captured_at: input.captured_at || accessedAt,
    content_hash: input.content_hash || "",
    usability_status: input.usability_status || "candidate",
    failure_category: input.failure_category || "",
    failure_detail: input.failure_detail || "",
    final_url: input.final_url || input.url,
    content_mime: input.content_mime || "",
    http_status: input.http_status ?? null,
    retrieval_status: input.retrieval_status || "not_attempted",
    source_tier: input.source_tier || "S8",
    authority_type: input.authority_type || "unknown",
    source_group: input.source_group || sourceGroupFromUrl(input.url, input.publisher),
    snapshot_text: input.snapshot_text || "",
    source_quote: input.source_quote || "",
    quote_verified: input.quote_verified ? 1 : 0,
  };
  db.prepare(`INSERT INTO source(
    id,run_id,normalized_url,url,title,publisher,published_at,accessed_at,source_type,search_excerpt,
    source_tier,authority_type,source_group,locator,captured_at,content_hash,usability_status,failure_category,failure_detail,
    final_url,content_mime,http_status,retrieval_status,snapshot_text,source_quote,quote_verified
  ) VALUES(${Array(26).fill("?").join(",")})`).run(
    row.id,
    row.run_id,
    row.normalized_url,
    row.url,
    row.title,
    row.publisher,
    row.published_at,
    row.accessed_at,
    row.source_type,
    row.search_excerpt,
    row.source_tier || "S8",
    row.authority_type || "unknown",
    row.source_group || sourceGroupFromUrl(row.url, row.publisher),
    row.locator || row.url,
    row.captured_at || accessedAt,
    row.content_hash || "",
    row.usability_status || "candidate",
    row.failure_category || "",
    row.failure_detail || "",
    row.final_url || row.url,
    row.content_mime || "",
    row.http_status ?? null,
    row.retrieval_status || "not_attempted",
    row.snapshot_text || "",
    row.source_quote || "",
    row.quote_verified ? 1 : 0,
  );
  return row;
}
function sourceGroupFromUrl(rawUrl: string, publisher: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return publisher.trim().toLowerCase();
  }
}
export function normalizeUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => u.searchParams.delete(k));
  u.hostname = u.hostname.toLowerCase();
  return u.toString().replace(/\/$/, "");
}
