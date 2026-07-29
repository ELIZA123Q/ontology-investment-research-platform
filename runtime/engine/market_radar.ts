import "server-only";

import { createHash } from "node:crypto";
import { DeepSeekClient } from "../adapters/deepseek";
import {
  createChildRun,
  getMarketEvent,
  getRun,
  latestArtifact,
  listEventImpacts,
  listRuns,
  setRadarLastRefreshedAt,
  updateEventImpactStatus,
  updateMarketEventStatus,
  upsertEventImpact,
  upsertMarketEvent,
  upsertSource,
  upsertWorkItem,
} from "../adapters/db";
import { parseJson, type ImpactClassification, type ImpactDirection, type MarketEvent } from "./types";
import { radarOutputSchema, type MarketEventDraft } from "./radar_schema";
import { approvedSemanticDataIfPresent } from "./semantic_reads";

export type { MarketEventDraft } from "./radar_schema";

export type RadarRunContext = {
  run_id: string;
  question: string;
  domain: string;
  judgments: Array<{
    id: string;
    judgment_unit_id: string | null;
    conclusion: string;
    tracking_signals: string[];
    invalidation_conditions: string[];
  }>;
};

export interface MarketEventProvider {
  readonly name: string;
  discover(input: { lookbackHours: number; runs: RadarRunContext[] }): Promise<MarketEventDraft[]>;
}

export class DeepSeekMarketEventProvider implements MarketEventProvider {
  readonly name = "deepseek_v4_web_radar";

  async discover(input: { lookbackHours: number; runs: RadarRunContext[] }): Promise<MarketEventDraft[]> {
    const client = new DeepSeekClient();
    const response = await client.generateStructured(
      "market_radar",
      radarOutputSchema,
      [
        "你是投研工作台的市场事件发现器。只返回最近发生、可由公开网页来源核验、可能改变已有研究判断的事件。",
        "必须先调用 search_public_web 检索与输入研究对象、跟踪信号和失效条件相关的最近事件。",
        "每个事件必须给出真实可访问的来源 URL。不要把市场评论或无来源推测写成事件。",
        "影响映射只能引用输入中存在的 run_id、judgment id 和 judgment_unit_id；相关性不足时 impacts 留空。",
        "candidate_labels 只填候选文本标签（如产品名/指标名），不是本体对象 ID，也不表示已写入实例图。",
        "direction 表示事件对原判断的潜在关系，不代表已经形成新证据或新结论。",
        "impact_classification 必须区分：仅新增证据 evidence_update、判断结构变化 structure_revision、范围或问题变化 scope_revision。",
      ].join("\n"),
      JSON.stringify(input, null, 2),
      { webSearch: true },
    );
    return response.data.events;
  }
}

export function radarRunContexts(): RadarRunContext[] {
  return listRuns().slice(0, 12).map((run) => {
    const data: any = approvedSemanticDataIfPresent(run.id, "stage_04") || {};
    return {
      run_id: run.id,
      question: run.question,
      domain: run.domain,
      judgments: (data.judgments || []).map((judgment: any) => ({
        id: String(judgment.id || judgment.judgment_id || ""),
        judgment_unit_id: judgment.judgment_unit_id || judgment.judgment_unit_ref || null,
        conclusion: String(judgment.conclusion || judgment.statement || ""),
        tracking_signals: Array.isArray(judgment.tracking_signals) ? judgment.tracking_signals.map(String) : [],
        invalidation_conditions: Array.isArray(judgment.invalidation_conditions) ? judgment.invalidation_conditions.map(String) : [],
      })).filter((item: any) => item.id),
    };
  });
}

export async function refreshMarketRadar(
  provider: MarketEventProvider = new DeepSeekMarketEventProvider(),
  lookbackHours = 72,
) {
  const contexts = radarRunContexts();
  const knownRuns = new Map(contexts.map((run) => [run.run_id, run]));
  const drafts = await provider.discover({ lookbackHours, runs: contexts });
  const batchId = crypto.randomUUID();
  let inserted = 0;
  let deduplicated = 0;
  let impacts = 0;

  for (const draft of drafts) {
    const dedupeKey = createHash("sha256")
      .update(`${normalizeRadarUrl(draft.url)}|${draft.title.trim().toLowerCase()}|${draft.published_at || draft.occurred_at || ""}`)
      .digest("hex");
    const saved = upsertMarketEvent({
      dedupe_key: dedupeKey,
      title: draft.title,
      summary: draft.summary,
      url: draft.url,
      publisher: draft.publisher,
      occurred_at: draft.occurred_at,
      published_at: draft.published_at,
      event_type: draft.event_type,
      candidate_labels: (draft.candidate_labels?.length ? draft.candidate_labels : draft.object_labels) || [],
      confidence: draft.confidence,
      refresh_batch_id: batchId,
    });
    if (saved.inserted) inserted++; else deduplicated++;

    for (const impact of draft.impacts) {
      const context = knownRuns.get(impact.run_id);
      if (!context) continue;
      const judgment = impact.judgment_id ? context.judgments.find((item) => item.id === impact.judgment_id) : undefined;
      if (impact.judgment_id && !judgment) continue;
      if (impact.judgment_unit_id && !context.judgments.some((item) => item.judgment_unit_id === impact.judgment_unit_id)) continue;
      upsertEventImpact({
        event_id: saved.event.id,
        run_id: impact.run_id,
        judgment_unit_id: impact.judgment_unit_id,
        judgment_id: impact.judgment_id,
        matched_condition: impact.matched_condition,
        direction: impact.direction,
        impact_classification: impact.impact_classification || "evidence_update",
        relevance: impact.relevance,
        rationale: impact.rationale,
      });
      impacts++;
    }
  }
  return {
    batch_id: batchId,
    provider: provider.name,
    discovered: drafts.length,
    inserted,
    deduplicated,
    impacts,
    last_refreshed_at: setRadarLastRefreshedAt(new Date().toISOString(), lookbackHours),
  };
}

function normalizeRadarUrl(raw: string) {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

export function startEventUpdate(eventId: string, requestedRunId?: string, requestedClassification?: ImpactClassification) {
  const event = getMarketEvent(eventId);
  if (!event) throw new Error("市场事件不存在");
  const candidates = listEventImpacts(eventId).filter((impact) => !requestedRunId || impact.run_id === requestedRunId);
  const impact = candidates.sort((a, b) => b.relevance - a.relevance)[0];
  const runId = requestedRunId || impact?.run_id;
  if (!runId || !getRun(runId)) throw new Error("该事件尚未映射到可更新的研究运行");

  const classification = requestedClassification || impact?.impact_classification || "evidence_update";
  const child = createChildRun(runId, eventId, classification);
  const capturedAt = new Date().toISOString();
  upsertSource(child.id, {
    url: event.url,
    title: event.title,
    publisher: event.publisher,
    published_at: event.published_at,
    source_type: "market_event_candidate",
    source_tier: "S8",
    search_excerpt: event.summary,
    locator: event.url,
    captured_at: capturedAt,
    content_hash: createHash("sha256").update(`${event.title}\n${event.summary}\n${event.url}`).digest("hex"),
    usability_status: "candidate",
    failure_category: "",
    failure_detail: "",
  });
  const stage = classification === "evidence_update" ? "stage_03" : classification === "structure_revision" ? "stage_02" : "stage_01";
  upsertWorkItem({
    run_id: child.id,
    kind: "event_review",
    stage,
    target_type: impact?.judgment_id ? "Judgment" : impact?.judgment_unit_id ? "JudgmentUnit" : "ResearchQuestion",
    target_id: impact?.judgment_id || impact?.judgment_unit_id || child.id,
    title: `确认事件对原判断的影响：${event.title}`,
    priority: impact?.direction === "invalidate" ? "high" : "medium",
    reason: impact?.rationale || "事件尚未完成对象级映射，需要研究员确认范围",
    source_event_id: event.id,
    payload_json: JSON.stringify({
      impact_direction: (impact?.direction || "review") as ImpactDirection,
      impact_classification: classification,
      matched_condition: impact?.matched_condition || null,
      parent_run_id: runId,
      parent_manifest_hash: createHash("sha256").update(getRun(runId)!.manifest_json).digest("hex"),
    }),
  });
  updateMarketEventStatus(event.id, "applied");
  if (impact) updateEventImpactStatus(impact.id, "accepted");
  return child;
}

export function marketEventLabel(event: MarketEvent) {
  return event.candidate_labels.length ? event.candidate_labels.join(" · ") : event.event_type;
}
