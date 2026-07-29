import "server-only";
import {
createArtifact,
getRun,
latestArtifact
} from "../../adapters/db";
import { PROMPT_VERSION } from "../prompts";
import { schemas } from "../schemas";
import { parseJson } from "../types";

import { syncStage01ReadableMarkdown } from "../readable_markdown";
import { ensureStage01ContractFields } from "../stage01_contract";
import {
editArtifact,
normalizeBusinessCutoff
} from "../workflow_shared";

export function normalizeStage01Projection(data: any, question: string) {
  const cutoff = normalizeBusinessCutoff(data?.time_scope?.as_of || question);
  if (cutoff && data?.time_scope) data.time_scope.as_of = cutoff;
  delete data.report_type;
  ensureStage01ContractFields(data, question);
  syncStage01ReadableMarkdown(data, question);
  return data;
}

type ControlledScopeInput = {
  normalized_question?: string;
  core_object?: string;
  judgment_action?: string;
  lookback?: string;
  as_of?: string;
  forward?: string;
  boundaries?: string[];
  exclusions?: string[];
};

export function createStage01DeterministicProjection(runId: string, input: ControlledScopeInput = {}) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const sourceArtifact = latestArtifact(runId, "stage_01", ["approved", "needs_review"]);
  const previous = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {};
  const cutoff = normalizeBusinessCutoff(input.as_of || previous.time_scope?.as_of || run.question);
  if (!cutoff) throw new Error("缺少可解析的研究截止日期；请明确到日、月、季度或半年");
  const pick = (value: unknown, fallback: unknown) => String(value || fallback || "").trim();
  const draft = {
    normalized_question: pick(input.normalized_question, previous.normalized_question || run.question),
    core_object: pick(input.core_object, previous.core_object),
    judgment_action: pick(input.judgment_action, previous.judgment_action),
    time_scope: {
      lookback: pick(input.lookback, previous.time_scope?.lookback),
      as_of: cutoff,
      forward: pick(input.forward, previous.time_scope?.forward),
    },
    boundaries: input.boundaries?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.boundaries ?? [],
    exclusions: input.exclusions?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.exclusions ?? [],
    domain_supported: run.domain === "semiconductor",
    document_markdown: "placeholder",
  };
  if (!sourceArtifact && (!draft.core_object || !draft.judgment_action || !draft.time_scope.lookback || !draft.time_scope.forward)) {
    throw new Error("空白运行必须显式填写核心对象、判断动作、回看期和前瞻期；不得用泛化占位语冻结范围");
  }
  if (draft.boundaries.length < 2 || !draft.exclusions.length) throw new Error("受控范围至少需要两条边界和一条排除项");
  const data = normalizeStage01Projection(draft, run.question);
  schemas.stage_01.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_01", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-scope-v1`,
    knowledge_version: "runtime-deterministic-scope-v1",
    input_context: JSON.stringify({ question: run.question, parsed_cutoff: cutoff, controlled_scope_input: input }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-scope-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true }),
  });
}

