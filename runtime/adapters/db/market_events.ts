import "server-only";
import type { MarketEvent, EventImpact } from "../../engine/types";
import { db } from "./connection";
function mapMarketEvent(row: any): MarketEvent {
  return {
    id: String(row.id),
    dedupe_key: String(row.dedupe_key),
    title: String(row.title),
    summary: String(row.summary),
    url: String(row.url),
    publisher: String(row.publisher || ""),
    occurred_at: row.occurred_at ?? null,
    published_at: row.published_at ?? null,
    event_type: String(row.event_type || "market_update"),
    candidate_labels: parseJsonArray(row.object_labels_json),
    confidence: row.confidence === "high" || row.confidence === "low" ? row.confidence : "medium",
    status: row.status,
    refresh_batch_id: String(row.refresh_batch_id),
    discovered_at: String(row.discovered_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function upsertMarketEvent(input: Omit<MarketEvent, "id" | "status" | "discovered_at">): { event: MarketEvent; inserted: boolean } {
  const existing = db.prepare("SELECT * FROM market_events WHERE dedupe_key=?").get(input.dedupe_key) as any;
  if (existing) return { event: mapMarketEvent(existing), inserted: false };
  const id = crypto.randomUUID();
  const discoveredAt = new Date().toISOString();
  db.prepare("INSERT INTO market_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    input.dedupe_key,
    input.title,
    input.summary,
    input.url,
    input.publisher,
    input.occurred_at,
    input.published_at,
    input.event_type,
    JSON.stringify(input.candidate_labels),
    input.confidence,
    "new",
    input.refresh_batch_id,
    discoveredAt,
  );
  return { event: mapMarketEvent(db.prepare("SELECT * FROM market_events WHERE id=?").get(id)), inserted: true };
}

export function listMarketEvents(limit = 60): MarketEvent[] {
  return (db.prepare("SELECT * FROM market_events ORDER BY COALESCE(published_at,occurred_at,discovered_at) DESC LIMIT ?").all(limit) as any[]).map(mapMarketEvent);
}

export function getMarketEvent(id: string): MarketEvent | undefined {
  const row = db.prepare("SELECT * FROM market_events WHERE id=?").get(id) as any;
  return row ? mapMarketEvent(row) : undefined;
}

export function updateMarketEventStatus(id: string, status: MarketEvent["status"]): MarketEvent {
  db.prepare("UPDATE market_events SET status=? WHERE id=?").run(status, id);
  const event = getMarketEvent(id);
  if (!event) throw new Error("市场事件不存在");
  return event;
}

export function upsertEventImpact(input: Omit<EventImpact, "id" | "created_at" | "status">): EventImpact {
  const existing = db.prepare("SELECT * FROM event_impacts WHERE event_id=? AND run_id=? AND judgment_unit_id IS ? AND judgment_id IS ?")
    .get(input.event_id, input.run_id, input.judgment_unit_id, input.judgment_id) as any;
  if (existing) return { ...existing } as EventImpact;
  const row: EventImpact = { ...input, id: crypto.randomUUID(), status: "suggested", created_at: new Date().toISOString() };
  db.prepare(`INSERT INTO event_impacts(
    id,event_id,run_id,judgment_unit_id,judgment_id,matched_condition,direction,relevance,
    rationale,status,created_at,impact_classification
  ) VALUES(${Array(12).fill("?").join(",")})`).run(
    row.id, row.event_id, row.run_id, row.judgment_unit_id, row.judgment_id, row.matched_condition,
    row.direction, row.relevance, row.rationale, row.status, row.created_at, row.impact_classification,
  );
  return row;
}

export function listEventImpacts(eventId?: string): EventImpact[] {
  const rows = eventId
    ? db.prepare("SELECT * FROM event_impacts WHERE event_id=? ORDER BY relevance DESC").all(eventId)
    : db.prepare("SELECT * FROM event_impacts ORDER BY created_at DESC,relevance DESC").all();
  return (rows as any[]).map((row) => ({
    ...row,
    relevance: Number(row.relevance),
    impact_classification: row.impact_classification || "evidence_update",
  })) as EventImpact[];
}

export function updateEventImpactStatus(id: string, status: EventImpact["status"]): EventImpact {
  db.prepare("UPDATE event_impacts SET status=? WHERE id=?").run(status, id);
  const row = db.prepare("SELECT * FROM event_impacts WHERE id=?").get(id) as any;
  if (!row) throw new Error("事件影响不存在");
  return {
    ...row,
    relevance: Number(row.relevance),
    impact_classification: row.impact_classification || "evidence_update",
  } as EventImpact;
}
