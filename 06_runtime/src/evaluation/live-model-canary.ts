import { createHash } from "node:crypto";
import type { ModelProvider } from "@/src/providers/model-provider";
import { ModelGateway } from "@/src/providers/model-gateway";
import type { RuntimeStore } from "@/src/runtime/store";

export type LiveCanaryOutcome = "completed_with_judgment" | "stopped_insufficient_evidence";
export interface LiveCanaryFact { id: string; statement: string; }
export interface LiveCanarySource {
  id: string; publisherId: string; sourceUri: string; publishedAt: string; businessTime: string;
  permissionScope: "public_research_use"; locator: string; facts: LiveCanaryFact[];
}
export interface LiveCanaryCase { id: string; question: string; expectedOutcome: LiveCanaryOutcome; sources: LiveCanarySource[]; }
export interface LiveCanaryCatalog { schemaName: string; schemaVersion: string; asOf: string; dataPolicy: "public"; cases: LiveCanaryCase[]; }
export interface LiveCanaryAnswer {
  outcome: LiveCanaryOutcome;
  judgment: string | null;
  evidenceUses: Array<{ factId: string; role: "support" | "weaken" | "context" | "block" }>;
  missingEvidence: string[];
  changeConditions: string[];
}
export type LiveCanaryTrack = "system" | "direct_qa" | "evidence_summary";
export interface LiveCanaryResult {
  caseId: string; track: LiveCanaryTrack; passed: boolean; cached: boolean; fingerprint: string; provider: string; model: string;
  expectedOutcome: LiveCanaryOutcome; answer?: LiveCanaryAnswer; failures: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

const responseSchema = {
  type: "object", required: ["outcome", "judgment", "evidenceUses", "missingEvidence", "changeConditions"],
  properties: {
    outcome: { enum: ["completed_with_judgment", "stopped_insufficient_evidence"] },
    judgment: { type: ["string", "null"] },
    evidenceUses: { type: "array", items: { type: "object", required: ["factId", "role"], properties: { factId: { type: "string" }, role: { enum: ["support", "weaken", "context", "block"] } } } },
    missingEvidence: { type: "array", items: { type: "string" } },
    changeConditions: { type: "array", items: { type: "string" } },
  },
} as const;

const sha256 = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const numericTokens = (value: string) => new Set(value.match(/\d+(?:\.\d+)?%?/gu) || []);
const prohibited = /买入|卖出|增持|减持|目标价|仓位|保证收益|稳赚/iu;
const parseJson = (text: string) => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")) as unknown;

function assertAnswerShape(value: unknown): asserts value is LiveCanaryAnswer {
  if (!value || typeof value !== "object") throw new Error("canary answer must be an object");
  const item = value as Record<string, unknown>;
  if (!["completed_with_judgment", "stopped_insufficient_evidence"].includes(String(item.outcome))) throw new Error("canary outcome is invalid");
  if (item.judgment !== null && typeof item.judgment !== "string") throw new Error("canary judgment must be string or null");
  if (!Array.isArray(item.evidenceUses) || !Array.isArray(item.missingEvidence) || !Array.isArray(item.changeConditions)) throw new Error("canary answer arrays are missing");
  if (item.evidenceUses.some((use) => !use || typeof use !== "object" || typeof (use as Record<string, unknown>).factId !== "string" || !["support", "weaken", "context", "block"].includes(String((use as Record<string, unknown>).role)))) throw new Error("canary evidenceUses is invalid");
  if (item.missingEvidence.some((entry) => typeof entry !== "string") || item.changeConditions.some((entry) => typeof entry !== "string")) throw new Error("canary text arrays are invalid");
}

export function validateLiveCanaryCatalog(catalog: LiveCanaryCatalog): string[] {
  const failures: string[] = [];
  const asOf = Date.parse(catalog.asOf);
  if (!Number.isFinite(asOf)) failures.push("catalog asOf is invalid");
  if (catalog.dataPolicy !== "public") failures.push("live external-model canary only accepts public data");
  if (!catalog.cases.length || catalog.cases.length > 3) failures.push("token-efficient canary requires 1-3 cases");
  const ids = new Set<string>();
  for (const item of catalog.cases) {
    if (ids.has(item.id)) failures.push(`duplicate case ${item.id}`); else ids.add(item.id);
    if (!item.sources.length) failures.push(`${item.id} has no source`);
    for (const source of item.sources) {
      if (source.permissionScope !== "public_research_use") failures.push(`${item.id}/${source.id} is not public`);
      if (!source.sourceUri.startsWith("https://")) failures.push(`${item.id}/${source.id} must use https`);
      if (!source.locator.trim()) failures.push(`${item.id}/${source.id} has no locator`);
      if (Date.parse(source.publishedAt) > asOf) failures.push(`${item.id}/${source.id} leaks future information`);
    }
  }
  return failures;
}

function validateAnswer(item: LiveCanaryCase, answer: LiveCanaryAnswer): string[] {
  const failures: string[] = [];
  const authorizedFacts = new Set(item.sources.flatMap((source) => source.facts.map((fact) => fact.id)));
  const allowedNumbers = numericTokens(JSON.stringify({ question: item.question, sources: item.sources }));
  const prose = JSON.stringify({ judgment: answer.judgment, missingEvidence: answer.missingEvidence, changeConditions: answer.changeConditions });
  if (answer.outcome !== item.expectedOutcome) failures.push(`expected ${item.expectedOutcome}, received ${answer.outcome}`);
  if (answer.outcome === "stopped_insufficient_evidence" && answer.judgment) failures.push("insufficient-evidence outcome must not contain a judgment");
  if (answer.outcome === "completed_with_judgment" && !answer.judgment?.trim()) failures.push("completed outcome requires a judgment");
  if (answer.evidenceUses.some((use) => !authorizedFacts.has(use.factId))) failures.push("answer references an unauthorized fact");
  if (prohibited.test(prose)) failures.push("answer contains a prohibited investment recommendation");
  for (const token of numericTokens(prose)) if (!allowedNumbers.has(token)) failures.push(`answer introduces unsupported numeric token ${token}`);
  return [...new Set(failures)];
}

function promptForTrack(track: LiveCanaryTrack, promptInput: Record<string, unknown>): { system: string; prompt: string; version: string } {
  if (track === "system") return {
    system: "你是受约束的A股半导体研究验证组件。宁可停止，也不能把缺失证据包装成结论。只输出JSON。",
    prompt: JSON.stringify({ ...promptInput, rules: [
      "只使用输入中的 factId 与事实，不补充外部知识。",
      "区分披露数字、前瞻指引和因果解释；没有原因证据时必须停止。",
      "证据不足时 outcome=stopped_insufficient_evidence 且 judgment=null。",
      "禁止评级、目标价、交易指令、仓位和任何输入之外的数字。",
      "只输出符合 schema 的 JSON，保持简短。",
    ] }),
    version: "live-research-canary/system/1.2.0",
  };
  const framing = track === "direct_qa"
    ? "直接回答问题。"
    : "先自行压缩输入事实，再据此回答问题；不要描述你的中间过程。";
  return {
    system: "你是公开证据的对照基线。只输出JSON；不得使用输入外知识、数值或投资建议。",
    prompt: JSON.stringify({ ...promptInput, rules: [framing, "证据不足时必须停止。", "只输出符合 schema 的 JSON，保持简短。"] }),
    version: `live-research-canary/${track}/1.0.0`,
  };
}

export async function runLiveCanaryTrack(store: RuntimeStore, provider: ModelProvider, catalog: LiveCanaryCatalog, item: LiveCanaryCase, track: LiveCanaryTrack = "system"): Promise<LiveCanaryResult> {
  const catalogFailures = validateLiveCanaryCatalog(catalog);
  if (catalogFailures.length) return { caseId: item.id, track, passed: false, cached: false, fingerprint: sha256(item), provider: provider.id, model: "not_called", expectedOutcome: item.expectedOutcome, failures: catalogFailures };
  const promptInput = {
    asOf: catalog.asOf, question: item.question,
    sources: item.sources.map((source) => ({
      id: source.id, publisherId: source.publisherId, sourceUri: source.sourceUri, publishedAt: source.publishedAt,
      businessTime: source.businessTime, locator: source.locator, facts: source.facts,
    })),
  };
  const request = promptForTrack(track, promptInput);
  let result;
  try {
    result = await new ModelGateway(store, provider).generate({
      operation: `live_research_canary:${track}:${item.id}`,
      promptVersion: request.version,
      schemaVersion: "live-research-canary/1.2.0",
      schemaName: "live_research_canary",
      system: request.system,
      prompt: request.prompt, responseSchema: responseSchema as unknown as Record<string, unknown>,
      maxOutputTokens: track === "system" ? 420 : 280, maxAttempts: 1, dataPolicy: "public", cache: "read_write",
      validateResponse: assertAnswerShape,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      caseId: item.id, track, passed: false, cached: false, fingerprint: sha256(promptInput), provider: provider.id,
      model: provider.modelId || "unknown", expectedOutcome: item.expectedOutcome,
      failures: [`model call failed: ${message}`],
    };
  }
  let answer: LiveCanaryAnswer | undefined;
  let failures: string[] = [];
  try {
    answer = parseJson(result.text) as LiveCanaryAnswer;
    failures = validateAnswer(item, answer);
  } catch {
    failures = ["model output is not valid JSON"];
  }
  return {
    caseId: item.id, track, passed: failures.length === 0, cached: result.cached, fingerprint: result.fingerprint,
    provider: result.provider, model: result.model, expectedOutcome: item.expectedOutcome, answer, failures, usage: result.usage,
  };
}

export async function runLiveCanaryCase(store: RuntimeStore, provider: ModelProvider, catalog: LiveCanaryCatalog, item: LiveCanaryCase): Promise<LiveCanaryResult> {
  return runLiveCanaryTrack(store, provider, catalog, item, "system");
}
