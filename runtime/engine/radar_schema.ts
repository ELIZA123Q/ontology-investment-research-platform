import { z } from "zod";
import { modelOptional } from "./model_schema_helpers";

export const radarOutputSchema = z.object({
  events: z.array(z.object({
    title: z.string().min(4),
    summary: z.string().min(12),
    url: z.string().url(),
    publisher: z.string(),
    occurred_at: z.string().nullable(),
    published_at: z.string().nullable(),
    event_type: z.string(),
    candidate_labels: modelOptional(z.array(z.string())),
    object_labels: modelOptional(z.array(z.string())), // 兼容旧字段名
    confidence: z.enum(["high", "medium", "low"]),
    impacts: z.array(z.object({
      run_id: z.string(),
      judgment_unit_id: z.string().nullable(),
      judgment_id: z.string().nullable(),
      matched_condition: z.string().nullable(),
      direction: z.enum(["support", "weaken", "invalidate", "review", "context"]),
      impact_classification: z.enum(["evidence_update", "structure_revision", "scope_revision"]),
      relevance: z.number().min(0).max(1),
      rationale: z.string(),
    })),
  })).max(12),
});

export type RadarOutput = z.infer<typeof radarOutputSchema>;
export type MarketEventDraft = RadarOutput["events"][number];
