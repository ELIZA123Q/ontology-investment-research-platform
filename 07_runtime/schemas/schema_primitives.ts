import { z } from "zod";

export const markdownSchema = z.string().min(40);
export const nonEmptyStringSchema = z.string().min(1);
export const qualityStatusSchema = z.enum([
  "draft",
  "minimum_pass",
  "high_quality_pass",
  "return_required",
  "stop_with_gap_report",
]);
export const stageStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "complete",
  "blocked",
  "returned",
]);

