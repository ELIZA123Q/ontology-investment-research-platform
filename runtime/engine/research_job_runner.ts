import "server-only";
import { createHash } from "node:crypto";
import {
  enqueueResearchJob,
  getResearchJobStore,
  type ResearchJobStore,
} from "../adapters/research_jobs";
import {
  getArtifact,
  getRun,
  latestArtifact,
  listSources,
  updateArtifactIfStatus,
} from "../adapters/db";
import { generationLeaseMs, researchJobLeaseMs } from "../adapters/model_provider";
import type { Artifact, ArtifactKind, ResearchJob, StageKind } from "./types";
import { STAGES } from "./types";
import { classifyRuntimeFailure, generateArtifact, shouldRetryRuntimeFailure } from "./workflow";
import { stage03AutoSupplementMaxRounds } from "./evidence_auto_supplement";
import { budgetViolationMessage, evaluateResearchJobBudget, parseResearchJobBudget } from "./research_job_budget";

type GenerationJobPayload = {
  run_id: string;
  kind: ArtifactKind;
  mode: "regenerate" | "evidence_supplement";
  max_auto_rounds: number | null;
  initial_source_ids: string[];
};

type GenerationExecutor = (
  runId: string,
  kind: ArtifactKind,
  options: Parameters<typeof generateArtifact>[2],
) => Promise<Artifact>;

const dependencyStages: Partial<Record<ArtifactKind, StageKind[]>> = {
  stage_01: [],
  stage_02: ["stage_01"],
  stage_03: ["stage_01", "stage_02"],
  stage_04: ["stage_02", "stage_03"],
  stage_05: ["stage_01", "stage_03", "stage_04"],
  baseline: ["stage_03"],
  independent_review: ["stage_02", "stage_03", "stage_04"],
};

function artifactHash(artifact: Artifact) {
  return `sha256:${createHash("sha256").update(artifact.json_content).digest("hex")}`;
}

function parseGenerationPayload(job: ResearchJob): GenerationJobPayload {
  const parsed = JSON.parse(job.payload_json || "{}") as Partial<GenerationJobPayload>;
  if (!parsed.run_id || !parsed.kind || !STAGES.includes(parsed.kind as StageKind) && !["baseline", "independent_review"].includes(parsed.kind)) {
    throw new Error("JOB_PAYLOAD_INVALID: 生成任务缺少有效 run_id/kind");
  }
  return {
    run_id: String(parsed.run_id),
    kind: parsed.kind,
    mode: parsed.mode === "evidence_supplement" ? "evidence_supplement" : "regenerate",
    max_auto_rounds: Number.isFinite(parsed.max_auto_rounds) ? Number(parsed.max_auto_rounds) : null,
    initial_source_ids: Array.isArray(parsed.initial_source_ids) ? parsed.initial_source_ids.map(String) : [],
  };
}

function assertGenerationPrerequisites(runId: string, kind: ArtifactKind) {
  if (!getRun(runId)) throw new Error("研究任务不存在");
  if (kind === "independent_review" && !latestArtifact(runId, "stage_04", ["approved"])) {
    throw new Error("请先确认阶段 04，再运行独立审阅");
  }
  if (kind === "baseline" && !latestArtifact(runId, "stage_03", ["approved"])) {
    throw new Error("请先确认阶段 03 并冻结证据，再生成同证据基线");
  }
  if (kind.startsWith("stage_")) {
    const stage = Number(kind.slice(-2));
    if (stage > 1 && !latestArtifact(runId, STAGES[stage - 2], ["approved"])) {
      throw new Error(`请先确认阶段 ${String(stage - 1).padStart(2, "0")}`);
    }
  }
}

function frozenInputs(runId: string, kind: ArtifactKind) {
  return (dependencyStages[kind] || []).map((stage) => {
    const artifact = latestArtifact(runId, stage, ["approved"]);
    if (!artifact) throw new Error(`${stage} 缺少已确认输入`);
    return { artifact_id: artifact.id, artifact_hash: artifactHash(artifact), kind: artifact.kind };
  });
}

function generationDedupeKey(input: {
  runId: string;
  kind: ArtifactKind;
  mode: string;
  inputs: Array<{ artifact_id: string; artifact_hash: string }>;
  initialSourceIds: string[];
}) {
  const digest = createHash("sha256").update(JSON.stringify({ inputs: input.inputs, sources: input.initialSourceIds })).digest("hex").slice(0, 20);
  return `generate:${input.runId}:${input.kind}:${input.mode}:${digest}`;
}

export function enqueueArtifactGeneration(input: {
  runId: string;
  kind: ArtifactKind;
  mode?: "regenerate" | "evidence_supplement";
  maxAutoRounds?: number;
}) {
  assertGenerationPrerequisites(input.runId, input.kind);
  const inputs = frozenInputs(input.runId, input.kind);
  const mode = input.mode || "regenerate";
  const initialSourceIds = listSources(input.runId).map((source) => source.id).sort();
  const maxAutoRounds = input.kind === "stage_03"
    ? Math.max(1, Math.floor(input.maxAutoRounds ?? stage03AutoSupplementMaxRounds()))
    : 1;
  return enqueueResearchJob({
    runId: input.runId,
    jobType: "generate_artifact",
    stage: input.kind,
    dedupeKey: generationDedupeKey({ runId: input.runId, kind: input.kind, mode, inputs, initialSourceIds }),
    maxAttempts: 3,
    budget: {
      max_auto_rounds: maxAutoRounds,
      max_sources: Number(process.env.RESEARCH_JOB_MAX_SOURCES || 40),
      max_tokens: Number(process.env.RESEARCH_JOB_MAX_TOKENS || 1_000_000),
      max_cost_usd: process.env.RESEARCH_JOB_MAX_COST_USD ? Number(process.env.RESEARCH_JOB_MAX_COST_USD) : null,
      input_usd_per_million_tokens: process.env.RESEARCH_INPUT_USD_PER_MILLION_TOKENS ? Number(process.env.RESEARCH_INPUT_USD_PER_MILLION_TOKENS) : null,
      output_usd_per_million_tokens: process.env.RESEARCH_OUTPUT_USD_PER_MILLION_TOKENS ? Number(process.env.RESEARCH_OUTPUT_USD_PER_MILLION_TOKENS) : null,
      hard_timeout_ms: generationLeaseMs(),
    },
    inputArtifacts: inputs,
    payload: {
      run_id: input.runId,
      kind: input.kind,
      mode,
      max_auto_rounds: maxAutoRounds,
      initial_source_ids: initialSourceIds,
    },
  });
}

export function verifyFrozenJobInputs(
  job: ResearchJob,
  resolveArtifact: (id: string) => Artifact | undefined = getArtifact,
): { ok: true } | { ok: false; reason: string } {
  const recordedHash = `sha256:${createHash("sha256").update(`${job.input_artifacts_json || "[]"}\n${job.payload_json || "{}"}`).digest("hex")}`;
  if (recordedHash !== job.input_hash) {
    return { ok: false, reason: "任务输入 hash 不匹配，拒绝执行可能被修改的 payload" };
  }
  const inputs = JSON.parse(job.input_artifacts_json || "[]") as Array<{ artifact_id?: string; artifact_hash?: string }>;
  for (const input of inputs) {
    const artifact = input.artifact_id ? resolveArtifact(String(input.artifact_id)) : undefined;
    if (!artifact) return { ok: false, reason: `冻结输入不存在：${input.artifact_id || "未登记"}` };
    if (artifactHash(artifact) !== input.artifact_hash) {
      return { ok: false, reason: `冻结输入已变化：${artifact.kind} v${artifact.version}` };
    }
  }
  return { ok: true };
}

export async function executeClaimedGenerationJob(
  job: ResearchJob,
  store: ResearchJobStore,
  execute: GenerationExecutor = generateArtifact,
): Promise<ResearchJob | undefined> {
  if (!job.lease_token || job.status !== "running") throw new Error("任务尚未取得运行租约");
  const token = job.lease_token;
  const payload = parseGenerationPayload(job);
  const leaseMs = researchJobLeaseMs();
  const budget = parseResearchJobBudget(job);
  const startedMs = Date.now();
  const frozen = verifyFrozenJobInputs(job);
  if (!frozen.ok) {
    return store.finish(job.id, token, { reason: frozen.reason }, "waiting_for_input");
  }

  if (job.artifact_id) {
    updateArtifactIfStatus(job.artifact_id, "running", {
      status: "failed",
      error_message: "[model_output_error] JOB_LEASE_RECOVERED: worker 中断后从阶段起点重试",
    });
  }

  let leaseLost = false;
  const heartbeat = () => {
    if (!store.heartbeat(job.id, token, leaseMs)) leaseLost = true;
  };
  const timer = setInterval(heartbeat, Math.max(1_000, Math.floor(leaseMs / 3)));
  timer.unref?.();
  try {
    const execution = execute(payload.run_id, payload.kind, {
      mode: payload.mode,
      maxAutoRounds: payload.max_auto_rounds ?? undefined,
      maxSourceCount: budget.max_sources ?? undefined,
      executionLease: {
        assertActive() {
          if (leaseLost || !store.hasActiveLease(job.id, token)) {
            throw new Error("GENERATION_LEASE_LOST: job 租约已被其他 worker 取代");
          }
        },
        onArtifactCreated(artifactId) {
          if (!store.bindArtifact(job.id, token, artifactId)) {
            throw new Error("GENERATION_LEASE_LOST: 无法绑定新产物");
          }
        },
      },
    });
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    // The original promise keeps its rejection handler after the race settles;
    // a fenced old execution may unwind later without becoming unhandled.
    const guardedExecution = execution.catch((error) => { throw error; });
    const artifact = await Promise.race([
      guardedExecution,
      new Promise<never>((_, reject) => {
        hardTimer = setTimeout(
          () => reject(new Error(`JOB_HARD_TIMEOUT: 超过任务硬时限 ${budget.hard_timeout_ms}ms`)),
          budget.hard_timeout_ms,
        );
      }),
    ]).finally(() => { if (hardTimer) clearTimeout(hardTimer); });
    const currentSourceIds = new Set(listSources(payload.run_id).map((source) => source.id));
    const initialSourceIds = new Set(payload.initial_source_ids);
    const newSourceCount = [...currentSourceIds].filter((id) => !initialSourceIds.has(id)).length;
    const budgetResult = evaluateResearchJobBudget({
      job,
      artifact,
      totalSourceCount: currentSourceIds.size,
      newSourceCount,
      elapsedMs: Date.now() - startedMs,
    });
    if (!budgetResult.ok) {
      const warning = budgetViolationMessage(budgetResult.violations);
      let priorTool: Record<string, unknown> = {};
      try { priorTool = JSON.parse(artifact.tool_usage || "{}"); } catch { priorTool = {}; }
      updateArtifactIfStatus(artifact.id, "needs_review", {
        // 预算是在模型完成、产物已通过生成合同后才可准确结算的。
        // 此时把已付费的完整产物改成 failed 只会诱发重复生成；预算警告
        // 应作为人工审阅信息保留，不能冒充研究质量结论。
        status: "needs_review",
        tool_usage: JSON.stringify({
          ...priorTool,
          budget_warning: warning,
          budget: budgetResult,
        }),
        error_message: null,
      });
      return store.finish(job.id, token, {
        reason: `JOB_BUDGET_EXCEEDED: ${warning}`,
        failure_category: "budget_exceeded",
        artifact_id: artifact.id,
        artifact_version: artifact.version,
        new_source_count: newSourceCount,
        total_source_count: currentSourceIds.size,
        elapsed_ms: budgetResult.elapsed_ms,
        token_usage: budgetResult.usage,
        budget_warning: warning,
      }, "waiting_for_review");
    }
    const finished = store.finish(job.id, token, {
      artifact_id: artifact.id,
      artifact_version: artifact.version,
      new_source_count: newSourceCount,
      total_source_count: currentSourceIds.size,
      elapsed_ms: budgetResult.elapsed_ms,
      token_usage: budgetResult.usage,
    }, "waiting_for_review");
    if (!finished) {
      updateArtifactIfStatus(artifact.id, "needs_review", {
        status: "failed",
        error_message: "[model_output_error] GENERATION_LEASE_LOST: 完成写回时 job 租约已失效",
      });
    }
    return finished;
  } catch (error) {
    if (!store.hasActiveLease(job.id, token)) return undefined;
    const category = classifyRuntimeFailure(error);
    if (category === "evidence_insufficient" || category === "method_not_applicable" || category === "budget_exceeded") {
      const boundArtifactId = store.get(job.id)?.artifact_id;
      if (boundArtifactId) {
        updateArtifactIfStatus(boundArtifactId, "running", {
          status: "failed",
          error_message: `[${category}] ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return store.finish(job.id, token, {
        reason: error instanceof Error ? error.message : String(error),
        failure_category: category,
      }, "waiting_for_input");
    }
    return store.fail(job.id, token, error instanceof Error ? error.message : String(error), {
      retryable: shouldRetryRuntimeFailure(error),
      retryDelayMs: 15_000,
    });
  } finally {
    clearInterval(timer);
  }
}

export async function runNextResearchJob(options: {
  workerId?: string;
  store?: ResearchJobStore;
  execute?: GenerationExecutor;
} = {}) {
  const store = options.store || getResearchJobStore();
  const job = store.claimNext({
    workerId: options.workerId || `worker-${process.pid}`,
    leaseMs: researchJobLeaseMs(),
    jobTypes: ["generate_artifact"],
  });
  if (!job) return undefined;
  return executeClaimedGenerationJob(job, store, options.execute || generateArtifact);
}

export async function runResearchWorkerLoop(options: { workerId?: string; pollMs?: number; signal?: AbortSignal } = {}) {
  while (!options.signal?.aborted) {
    const result = await runNextResearchJob({ workerId: options.workerId });
    if (!result) await new Promise((resolve) => setTimeout(resolve, Math.max(250, options.pollMs || 2_000)));
  }
}
