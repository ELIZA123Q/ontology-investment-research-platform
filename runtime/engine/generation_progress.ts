export type GenerationProgressPhase =
  | "model_round"
  | "tool_call"
  | "submit_retry"
  | "direct_json"
  | "coverage_pass";

export type GenerationProgressEvent = {
  phase: GenerationProgressPhase;
  round: number;
  max_rounds: number;
  tool_names: string[];
  last_tool?: string;
  message: string;
};

export type GenerationProgressHeartbeat = {
  in_progress: true;
  phase: GenerationProgressPhase;
  round: number;
  max_rounds: number;
  tool_names: string[];
  last_tool?: string;
  heartbeat_at: string;
  started_at: string;
  elapsed_ms: number;
  message: string;
  auto_round?: number;
  max_auto_rounds?: number;
  coverage_rate?: number;
  verification_rate?: number;
  coverage_gap_count?: number;
};

/** Stale if no heartbeat for this long while status=running. */
export const GENERATION_HEARTBEAT_STALE_MS = 3 * 60_000;

export function buildGenerationProgressHeartbeat(
  event: GenerationProgressEvent,
  startedAt: string,
  nowMs = Date.now(),
): GenerationProgressHeartbeat {
  const startedMs = Date.parse(startedAt);
  return {
    in_progress: true,
    phase: event.phase,
    round: event.round,
    max_rounds: event.max_rounds,
    tool_names: event.tool_names,
    last_tool: event.last_tool,
    heartbeat_at: new Date(nowMs).toISOString(),
    started_at: startedAt,
    elapsed_ms: Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : 0,
    message: event.message,
  };
}

export function parseGenerationProgress(toolUsage: string | null | undefined): GenerationProgressHeartbeat | null {
  if (!toolUsage || !toolUsage.trim()) return null;
  try {
    const value = JSON.parse(toolUsage);
    if (!value || typeof value !== "object" || value.in_progress !== true) return null;
    if (typeof value.phase !== "string" || typeof value.message !== "string") return null;
    if (typeof value.round !== "number" || typeof value.max_rounds !== "number") return null;
    if (typeof value.heartbeat_at !== "string" || typeof value.started_at !== "string") return null;
    if (typeof value.elapsed_ms !== "number") return null;
    return {
      in_progress: true,
      phase: value.phase as GenerationProgressPhase,
      round: value.round,
      max_rounds: value.max_rounds,
      tool_names: Array.isArray(value.tool_names) ? value.tool_names.map(String) : [],
      last_tool: value.last_tool ? String(value.last_tool) : undefined,
      heartbeat_at: value.heartbeat_at,
      started_at: value.started_at,
      elapsed_ms: value.elapsed_ms,
      message: value.message,
      auto_round: typeof value.auto_round === "number" ? value.auto_round : undefined,
      max_auto_rounds: typeof value.max_auto_rounds === "number" ? value.max_auto_rounds : undefined,
      coverage_rate: typeof value.coverage_rate === "number" ? value.coverage_rate : undefined,
      verification_rate: typeof value.verification_rate === "number" ? value.verification_rate : undefined,
      coverage_gap_count: typeof value.coverage_gap_count === "number" ? value.coverage_gap_count : undefined,
    };
  } catch {
    return null;
  }
}

export function isGenerationProgressStale(
  progress: GenerationProgressHeartbeat,
  nowMs = Date.now(),
  staleMs = GENERATION_HEARTBEAT_STALE_MS,
): boolean {
  const heartbeatMs = Date.parse(progress.heartbeat_at);
  if (!Number.isFinite(heartbeatMs)) return true;
  return nowMs - heartbeatMs > staleMs;
}

export function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}
