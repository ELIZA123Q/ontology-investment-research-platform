import "server-only";

import OpenAI from "openai";
import { assertModelStructuredSchema } from "../engine/model_schema_helpers";
import { z } from "zod";
import { zodFunction } from "openai/helpers/zod";
import { schemas, type SchemaKind } from "../engine/schemas";
import { ontologyToolDefinitions, runOntologyTool, type OntologyToolName } from "../engine/ontology_tools";
import { captureSourceSnapshot } from "../engine/source_snapshot";
import { resolveModelProvider, type ModelRole, type ResolvedModelProvider } from "./model_provider";
import type { GenerationProgressEvent } from "../engine/generation_progress";
import {
  queryChinaPolicy,
  queryCninfo,
  queryDatayesFinoper,
  queryDatayesStock,
  queryDatayesMacro,
  queryDatayesIndex,
  queryDatayesFund,
  queryHtscResearch,
  queryCaixinNews,
  type McpEvidenceQueryResult,
} from "./mcp_evidence";

type Citation = { url: string; title: string };
export type ModelResult<T> = {
  data: T;
  raw: string;
  responseId: string;
  usage: unknown;
  toolUsage: unknown;
  citations: Citation[];
};

export type GenerateOptions = {
  webSearch?: boolean;
  ontologyTools?: boolean;
  /** 覆盖工具环最大轮次；未设时读 MODEL_TOOL_ROUNDS(_WEB)，再回落默认。 */
  maxToolRounds?: number;
  runId?: string;
  validateOutput?: (data: unknown) => void;
  /** Soft-normalize near-miss model JSON before schema validation. */
  repairOutput?: (data: unknown) => unknown;
  onProgress?: (progress: GenerationProgressEvent) => void;
};

/**
 * 工具环轮次。
 * 测试友好默认：web=8 / 其他=6（原生产 32/20）。恢复时设
 * MODEL_TOOL_ROUNDS_WEB=32 MODEL_TOOL_ROUNDS=20，或把下方默认改回。
 */
export function resolveMaxToolRounds(options: Pick<GenerateOptions, "webSearch" | "maxToolRounds">): number {
  if (typeof options.maxToolRounds === "number" && Number.isFinite(options.maxToolRounds) && options.maxToolRounds > 0) {
    return Math.min(40, Math.max(1, Math.floor(options.maxToolRounds)));
  }
  const envName = options.webSearch ? "MODEL_TOOL_ROUNDS_WEB" : "MODEL_TOOL_ROUNDS";
  const fromEnv = Number(process.env[envName] || process.env.MODEL_MAX_TOOL_ROUNDS || "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(40, Math.max(1, Math.floor(fromEnv)));
  }
  return options.webSearch ? 8 : 6;
}

export function accumulateTokenUsage(
  accumulated: unknown,
  current: unknown,
): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const prior = accumulated && typeof accumulated === "object" ? accumulated as Record<string, unknown> : {};
  const next = current && typeof current === "object" ? current as Record<string, unknown> : {};
  const priorInput = Number(prior.prompt_tokens ?? prior.input_tokens ?? 0) || 0;
  const priorOutput = Number(prior.completion_tokens ?? prior.output_tokens ?? 0) || 0;
  const nextInput = Number(next.prompt_tokens ?? next.input_tokens ?? 0) || 0;
  const nextOutput = Number(next.completion_tokens ?? next.output_tokens ?? 0) || 0;
  const promptTokens = Math.max(0, priorInput) + Math.max(0, nextInput);
  const completionTokens = Math.max(0, priorOutput) + Math.max(0, nextOutput);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

export { resolveModelProvider, listConfiguredProviders } from "./model_provider";
export type { ModelProviderId, ModelRole, ResolvedModelProvider } from "./model_provider";

const webSearchTool = {
  type: "function" as const,
  function: {
    name: "search_public_web",
    description: "检索公开网页与新闻线索。返回标题、URL、摘要和发布时间；检索结果仍需审阅，不能自动升级为正式证据。",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        queries: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
        limit_per_query: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["queries", "limit_per_query"],
      additionalProperties: false,
    },
  },
};

const fetchPublicPagesTool = {
  type: "function" as const,
  function: {
    name: "fetch_public_pages",
    description: "抓取已知的公开网页 URL 并返回可定位正文摘录、最终 URL 与内容 hash。用于直接核验公司公告、官方统计和研究机构页面；网址必须是 http/https 公开地址。",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        urls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
      },
      required: ["urls"],
      additionalProperties: false,
    },
  },
};

const queryCninfoTool = {
  type: "function" as const,
  function: {
    name: "query_cninfo",
    description: "通过巨潮 cninfo MCP 查询 A 股公司公告/定期报告线索（一手公司披露通道）。返回标题、可选 URL、摘要与留痕 provenance；仍须用 fetch_public_pages 核验公开原文后再写 source_quote。MCP 失败时按 fallback_hint 回退 Bing/公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        stock_code: { type: "string", description: "证券代码，如 000001 或 688981" },
        category: { type: "string", description: "公告类别（可选）" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        keyword: { type: "string" },
        tool_name: { type: "string", description: "可选：指定 MCP 工具名；不确定时可先省略以查看 available_tools" },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["stock_code"],
      additionalProperties: false,
    },
  },
};

const queryDatayesFinoperTool = {
  type: "function" as const,
  function: {
    name: "query_datayes_finoper",
    description: "通过通联 datayes-stock-finoper MCP 查询 A 股财务三表（一手结构化财务通道）。若未知 api_name，先不传 api_name 以获取 available_tools[].inputSchema，再带 api_name 重试。返回结构化摘录与 provenance；关键数字须与法定公告交叉核验。失败时回退 cninfo/公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        stock_code: { type: "string", description: "证券代码" },
        period: { type: "string", description: "报表期，如 2025Q4 / 2024" },
        statement_type: { type: "string", description: "报表类型：利润表/资产负债表/现金流量表等" },
        report_type: { type: "string", description: "合并/母公司等口径" },
        api_name: { type: "string", description: "通联 finoper API 名；未知时先省略以拉取 inputSchema" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["stock_code"],
      additionalProperties: false,
    },
  },
};

const queryChinaPolicyTool = {
  type: "function" as const,
  function: {
    name: "query_china_policy",
    description: "通过 china-policy MCP 查询中央政策原文线索（一手官方政策通道）。返回标题、可选 URL、摘要与 provenance；须核验原文后再引用。失败时回退政府网/公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        query: { type: "string" },
        domain: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

const queryDatayesStockTool = {
  type: "function" as const,
  function: {
    name: "query_datayes_stock",
    description: "通过通联数据 MCP 查询 A 股综合数据。data_type: stock_market（行情/K线/技术指标，默认）、stock_info（公司基本信息/股东）、stock_holders（机构持仓）、stock_events（公司事件摘要）。返回结构化数据与 provenance；须与法定公告交叉核验。失败时回退 cninfo/公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        stock_code: { type: "string", description: "证券代码，如 000001 或 688981" },
        data_type: { type: "string", description: "数据类型：stock_market（行情）、stock_info（公司信息）、stock_holders（机构持仓）、stock_events（公司事件）" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        period: { type: "string" },
        keyword: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["stock_code"],
      additionalProperties: false,
    },
  },
};

const queryDatayesMacroTool = {
  type: "function" as const,
  function: {
    name: "query_macro_data",
    description: "通过通联数据 MCP 查询宏观经济指标（GDP、CPI、PMI、贸易、工业、消费等）。返回结构化时间序列与 provenance。失败时回退统计局/央行/海关官网或公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        indicator: { type: "string", description: "指标名称，如 GDP、CPI、PMI" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        keyword: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

const queryDatayesIndexTool = {
  type: "function" as const,
  function: {
    name: "query_market_index",
    description: "通过通联数据 MCP 查询指数数据。data_type: index_market（行情估值/PE/PB，默认）、index_info（成分股与权重）。返回结构化数据与 provenance。失败时回退交易所公开行情或公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        index_code: { type: "string", description: "指数代码" },
        data_type: { type: "string", description: "数据类型：index_market（行情估值）、index_info（成分权重）" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

const queryDatayesFundTool = {
  type: "function" as const,
  function: {
    name: "query_fund_data",
    description: "通过通联数据 MCP 查询基金数据。data_type: fund_master（基本信息，默认）、fund_perf（业绩）、fund_holding（持仓）、fund_fincap（财务规模）、fund_analytics（风险分析）。返回结构化数据与 provenance。失败时回退基金公司官网或公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        fund_code: { type: "string", description: "基金代码" },
        data_type: { type: "string", description: "数据类型：fund_master/fund_perf/fund_holding/fund_fincap/fund_analytics" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

const queryHtscResearchTool = {
  type: "function" as const,
  function: {
    name: "query_research_reports",
    description: "通过华泰证券研究所 MCP 查询研报、行业观点和估值模型。注意：研报观点不代表事实，必须交叉核验；引用时标记为 public_secondary，不得伪装为一手公司披露。失败时回退公开研报平台或公开网页。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        industry: { type: "string", description: "行业" },
        stock_code: { type: "string", description: "关联证券代码" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        limit: { type: "integer", description: "返回篇数上限，默认 5" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

const queryCaixinNewsTool = {
  type: "function" as const,
  function: {
    name: "query_caixin_news",
    description: "通过财新 MCP 查询财经新闻。返回标题、摘要、发布时间。用作线索参考，正式取证仍需核验原始来源。失败时回退公开新闻搜索。",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        query: { type: "string", description: "自由查询文本" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
};

function chatOntologyTools() {
  return ontologyToolDefinitions.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    },
  }));
}

export class DeepSeekClient {
  private client: OpenAI;
  private config: ResolvedModelProvider;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: "high" | "max" | null;
  readonly role: ModelRole;

  constructor(role: ModelRole = "producer") {
    this.config = resolveModelProvider(role);
    this.role = role;
    this.provider = this.config.provider;
    this.model = this.config.model;
    this.reasoning = this.config.reasoningEffort;
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.requestTimeoutMs,
      maxRetries: 1,
    });
  }

  async generateStructured<T>(
    name: string,
    schema: z.ZodType<T>,
    instructions: string,
    input: string,
    options: GenerateOptions = {},
  ): Promise<ModelResult<T>> {
    assertModelStructuredSchema(name, schema);
    const submitName = `submit_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const submitTool = zodFunction({
      name: submitName,
      description: `提交最终 ${name} JSON。完成必要的检索和工具调用后必须调用此函数。`,
      parameters: schema,
    });
    const tools: any[] = [];
    if (options.webSearch) {
      tools.push(
        queryCninfoTool,
        queryDatayesFinoperTool,
        queryDatayesStockTool,
        queryDatayesMacroTool,
        queryDatayesIndexTool,
        queryDatayesFundTool,
        queryChinaPolicyTool,
        queryHtscResearchTool,
        queryCaixinNewsTool,
        webSearchTool,
        fetchPublicPagesTool,
      );
    }
    if (options.ontologyTools) tools.push(...chatOntologyTools());
    tools.push(submitTool);

    const messages: any[] = [
      {
        role: "system",
        content: `${instructions}\n\n你正在使用 ${this.config.displayName}。最终结果必须是合法 JSON，并通过 ${submitName} 函数提交。不要在普通文本中输出最终结果。Schema 中由 Runtime 回填的 source_id、抓取时间/hash、deterministic_result、冻结产物 hash、reviewer/producer model 等字段必须显式提交 null，不得自行伪造；Runtime 会在保存前覆盖。${options.webSearch ? "取证通道优先级：A股公告→query_cninfo（巨潮）；财务三表→query_datayes_finoper（通联）；行情/信息/持仓/事件→query_datayes_stock；宏观→query_macro_data；指数→query_market_index；基金→query_fund_data；政策→query_china_policy；研报→query_research_reports（华泰）；新闻→query_caixin_news（财新）。Bing search_public_web 仅作补充线索。MCP 与搜索摘要都只是候选，须经 fetch_public_pages 或可核验摘录后再写 source_quote；MCP 失败时按 fallback_hint 回退，不得伪装成已核验事实。" : ""}`,
      },
      { role: "user", content: input },
    ];
    const citations: Citation[] = [];
    const toolTrace: Array<Record<string, unknown>> = [];
    let raw = "";
    let lastResponseId = "";
    let lastUsage: unknown = {};
    let lastSubmitError = "";
    const generationTimeoutMs = this.config.generationTimeoutMs;
    const deadline = Date.now() + generationTimeoutMs;
    // Stage 02/03/04 长跑是常态：工具轮次用满整体预算，不再为“直接 JSON 降级”预留 30% 而提前掐断。
    // 直接 JSON 仅在工具轮次自然结束后、仍有剩余时间时作为结构修复手段，而不是超时逃生舱。
    const maxRounds = resolveMaxToolRounds(options);
    const submitNudgeFrom = Math.max(0, maxRounds - Math.min(3, Math.max(1, Math.ceil(maxRounds / 3))));
    let consecutiveRoundTimeouts = 0;
    const emitProgress = (progress: GenerationProgressEvent) => {
      try { options.onProgress?.(progress); } catch { /* progress must not abort generation */ }
    };
    for (let round = 0; round < maxRounds; round++) {
      const remaining = deadline - Date.now();
      if (remaining <= 5_000) {
        lastSubmitError = `整体生成时限将尽（${generationTimeoutMs}ms）`;
        break;
      }
      const toolNames = toolTrace.map((item) => String(item.name));
      emitProgress({
        phase: "model_round",
        round: round + 1,
        max_rounds: maxRounds,
        tool_names: toolNames,
        last_tool: toolNames.at(-1),
        message: `等待模型第 ${round + 1}/${maxRounds} 轮`,
      });
      let response: any;
      const requestBudgetMs = Math.min(remaining, this.config.requestTimeoutMs);
      const controller = new AbortController();
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const requestBody: Record<string, unknown> = {
          model: this.model,
          messages,
          tools,
          tool_choice: "auto",
          max_tokens: this.config.maxTokens,
        };
        if (this.config.provider === "deepseek" && this.reasoning) {
          requestBody.reasoning_effort = this.reasoning;
          requestBody.extra_body = { thinking: { type: "enabled" } };
        }
        response = await Promise.race([
          this.client.chat.completions.create(requestBody as any, { timeout: requestBudgetMs, signal: controller.signal }),
          new Promise<never>((_, reject) => {
            hardTimer = setTimeout(() => {
              controller.abort();
              reject(new Error(`MODEL_TIMEOUT: ${this.config.displayName} 第 ${round + 1} 轮超过硬时限 ${requestBudgetMs}ms`));
            }, requestBudgetMs);
          }),
        ]);
        consecutiveRoundTimeouts = 0;
      } catch (error) {
        if (/timed?\s*out|timeout|abort/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))) {
          consecutiveRoundTimeouts += 1;
          lastSubmitError = `工具模式第 ${round + 1} 轮超时`;
          // 单轮变慢不视为失败：有剩余预算时继续催提交，连续超时两次才退出工具环。
          if (consecutiveRoundTimeouts < 2 && deadline - Date.now() > Math.min(30_000, this.config.requestTimeoutMs / 2)) {
            messages.push({
              role: "user",
              content: `上一轮模型请求超时。不要因耗时放弃；请立即调用 ${submitName} 提交当前可核验结果；证据不足时明确登记 gap，禁止继续无节制扩展检索。`,
            });
            continue;
          }
          break;
        }
        throw error;
      } finally {
        if (hardTimer) clearTimeout(hardTimer);
      }
      lastResponseId = response.id || "";
      lastUsage = accumulateTokenUsage(lastUsage, response.usage);
      const message: any = response.choices?.[0]?.message;
      if (!message) throw new Error(`${this.config.displayName} 未返回消息`);
      raw += `${message.reasoning_content || ""}${message.content || ""}`;
      messages.push(message);
      const calls: any[] = message.tool_calls || [];
      if (!calls.length) {
        messages.push({ role: "user", content: `不要输出普通文本。请立即调用 ${submitName} 提交符合 schema 的 JSON。` });
        continue;
      }

      for (const call of calls) {
        const toolName = String(call.function?.name || "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(call.function?.arguments || "{}")); } catch { args = {}; }

        if (toolName === submitName) {
          try {
            const candidate = options.repairOutput ? options.repairOutput(args) : args;
            const parsed = schema.parse(candidate);
            options.validateOutput?.(parsed);
            return {
              data: parsed,
              raw,
              responseId: lastResponseId,
              usage: lastUsage,
              toolUsage: summarizeToolTrace(toolTrace),
              citations: dedupeCitations(citations),
            };
          } catch (error) {
            lastSubmitError = error instanceof Error ? error.message : String(error);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: "提交内容未通过结构或语义校验", details: error instanceof Error ? error.message : String(error) }).slice(0, 12000),
            });
            emitProgress({
              phase: "submit_retry",
              round: round + 1,
              max_rounds: maxRounds,
              tool_names: toolTrace.map((item) => String(item.name)),
              last_tool: toolTrace.length ? String(toolTrace.at(-1)?.name) : undefined,
              message: `提交未通过校验，正在重试（第 ${round + 1} 轮）`,
            });
            continue;
          }
        }

        let result: unknown;
        try {
          if (toolName === "search_public_web") {
            result = await searchPublicWeb(args, citations);
          } else if (toolName === "fetch_public_pages") {
            result = await fetchPublicPages(args, citations);
          } else if (toolName === "query_cninfo") {
            result = await enrichMcpResult(await queryCninfo(args), citations);
          } else if (toolName === "query_datayes_finoper") {
            result = await enrichMcpResult(await queryDatayesFinoper(args), citations);
          } else if (toolName === "query_china_policy") {
            result = await enrichMcpResult(await queryChinaPolicy(args), citations);
          } else if (toolName === "query_datayes_stock") {
            result = await enrichMcpResult(await queryDatayesStock(args), citations);
          } else if (toolName === "query_macro_data") {
            result = await enrichMcpResult(await queryDatayesMacro(args), citations);
          } else if (toolName === "query_market_index") {
            result = await enrichMcpResult(await queryDatayesIndex(args), citations);
          } else if (toolName === "query_fund_data") {
            result = await enrichMcpResult(await queryDatayesFund(args), citations);
          } else if (toolName === "query_research_reports") {
            result = await enrichMcpResult(await queryHtscResearch(args), citations);
          } else if (toolName === "query_caixin_news") {
            result = await enrichMcpResult(await queryCaixinNews(args), citations);
          } else if (options.ontologyTools && options.runId) {
            result = runOntologyTool(options.runId, toolName as OntologyToolName, args);
          } else {
            result = { error: `不可用工具 ${toolName}` };
          }
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        toolTrace.push({ name: toolName, arguments: args, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24000) });
        const names = toolTrace.map((item) => String(item.name));
        emitProgress({
          phase: "tool_call",
          round: round + 1,
          max_rounds: maxRounds,
          tool_names: names,
          last_tool: toolName,
          message: progressMessageForTool(toolName),
        });
      }
      if (round >= submitNudgeFrom) {
        const calledMcp = toolTrace.some((item) => MCP_TOOL_NAMES.has(String(item.name)));
        messages.push({
          role: "user",
          content: calledMcp
            ? `工具调用仅剩 ${maxRounds - round - 1} 轮。停止无节制 Bing 扩检索；对仍无法核验的要求明确登记 gap，并尽快调用 ${submitName} 提交。`
            : `工具调用仅剩 ${maxRounds - round - 1} 轮。尚未调用一手 MCP（query_cninfo / query_datayes_* / query_china_policy 等）。请先补至少一轮相关 MCP，再对仍无法核验的要求登记 gap，并调用 ${submitName} 提交；Bing 不得代替一手通道。`,
        });
      }
    }
    const directRemaining = deadline - Date.now();
    if (directRemaining > 15_000) {
      emitProgress({
        phase: "direct_json",
        round: maxRounds,
        max_rounds: maxRounds,
        tool_names: toolTrace.map((item) => String(item.name)),
        last_tool: toolTrace.length ? String(toolTrace.at(-1)?.name) : undefined,
        message: "工具轮次结束，正在直接补交结构化 JSON",
      });
      try {
        const direct = await this.generateDirectJson(
          name,
          schema,
          instructions,
          input,
          toolTrace,
          options.validateOutput,
          Math.min(directRemaining, this.config.requestTimeoutMs),
          options.repairOutput,
        );
        return {
          ...direct,
          raw: `${raw}${direct.raw}`,
          citations: dedupeCitations(citations),
          usage: accumulateTokenUsage(lastUsage, direct.usage),
          toolUsage: { ...summarizeToolTrace(toolTrace), structured_submission_mode: "direct_json_fallback" },
        };
      } catch (error) {
        lastSubmitError = `${lastSubmitError ? `${lastSubmitError}；` : ""}直接 JSON 补交失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const toolSummary = toolTrace.map((item) => String(item.name)).join(", ");
    throw new Error(
      `${Date.now() >= deadline ? "MODEL_TIMEOUT: " : ""}${this.config.displayName} 未提交合法结构化结果`
      + `${toolSummary ? `；已调用: ${toolSummary.slice(0, 1000)}` : "；未调用任何可执行工具"}`
      + `${lastSubmitError ? `；最后一次校验错误: ${lastSubmitError.slice(0, 4000)}` : "；未调用最终提交工具"}`,
    );
  }

  private async generateDirectJson<T>(
    name: string,
    schema: z.ZodType<T>,
    instructions: string,
    input: string,
    toolTrace: Array<Record<string, unknown>>,
    validateOutput: GenerateOptions["validateOutput"],
    timeoutMs: number,
    repairOutput?: GenerateOptions["repairOutput"],
  ): Promise<ModelResult<T>> {
    const schemaJson = JSON.stringify(z.toJSONSchema(schema));
    const toolContext = toolTrace.length
      ? JSON.stringify(toolTrace.map((item) => ({ name: item.name, result: item.result })).slice(-20)).slice(0, 60_000)
      : "没有已完成的工具结果；不得因此编造来源或事实，证据不够时应输出 gap/J0。";
    const controller = new AbortController();
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response: any = await Promise.race([
        this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: `${instructions}\n\n请直接返回一个 JSON 对象，不要使用 Markdown 代码块或附加说明。返回值必须符合以下 JSON Schema，且仍须遵守所有事实、方法、本体和时间边界：\n${schemaJson}`,
            },
            { role: "user", content: `${input}\n\n已完成工具结果（只可作为候选上下文，仍不得越过来源约束）：\n${toolContext}` },
          ],
          response_format: { type: "json_object" },
          max_tokens: this.config.maxTokens,
        } as any, { timeout: timeoutMs, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          hardTimer = setTimeout(() => {
            controller.abort();
            reject(new Error(`MODEL_TIMEOUT: ${this.config.displayName} 直接 JSON 降级超过 ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      const message = response.choices?.[0]?.message;
      const raw = String(message?.content || "").trim();
      if (!raw) throw new Error("直接 JSON 降级未返回正文");
      const parsed = parseDirectJson(raw, schema, repairOutput);
      validateOutput?.(parsed);
      return {
        data: parsed,
        raw,
        responseId: response.id || "",
        usage: response.usage || {},
        toolUsage: { structured_submission_mode: "direct_json_fallback" },
        citations: [],
      };
    } catch (error) {
      if (/timed?\s*out|timeout|abort/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))) {
        throw new Error(`MODEL_TIMEOUT: ${this.config.displayName} 直接 JSON 补交未在剩余时限内返回`, { cause: error });
      }
      throw error;
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
    }
  }
}

/** Alias kept for call sites that still import DeepSeekClient; factory is preferred. */
export class ResearchModelClient extends DeepSeekClient {
  generate(kind: SchemaKind, instructions: string, input: string, options: GenerateOptions = {}): Promise<ModelResult<any>> {
    return this.generateStructured<any>(kind, schemas[kind] as z.ZodType<any>, instructions, input, options);
  }
}

export function createResearchModelClient(role: ModelRole = "producer"): ResearchModelClient {
  return new ResearchModelClient(role);
}

export function parseDirectJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  repairOutput?: (data: unknown) => unknown,
): T {
  const normalized = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`直接 JSON 降级返回无法解析: ${error instanceof Error ? error.message : String(error)}`);
  }
  const candidate = repairOutput ? repairOutput(value) : value;
  return schema.parse(candidate);
}

async function enrichMcpResult(result: McpEvidenceQueryResult, citations: Citation[]) {
  const enrichedResults = [];
  for (const hit of result.results.slice(0, 6)) {
    if (hit.url) {
      citations.push({ url: hit.url, title: hit.title });
      const retrieved = await retrieveSearchPage(hit.url);
      enrichedResults.push({
        ...hit,
        ...retrieved,
        authority_type: hit.authority_type,
        publisher: hit.publisher,
        mcp_channel: result.channel,
      });
    } else {
      enrichedResults.push({
        ...hit,
        retrieval_status: "limited",
        content_excerpt: hit.raw_excerpt.slice(0, 8_000),
        locator_hint: "无公开 URL：只能把 MCP 结构化摘录登记为线索/limited，不得假装 quote_verified；优先补公开原文 URL。",
        mcp_channel: result.channel,
      });
    }
  }
  return {
    ok: result.ok,
    channel: result.channel,
    error: result.error,
    fallback_hint: result.fallback_hint,
    available_tools: result.available_tools,
    provenance: result.provenance,
    results: enrichedResults,
    content_excerpt: result.content_text.slice(0, 8_000),
  };
}

async function searchPublicWeb(args: Record<string, unknown>, citations: Citation[]) {
  const queries = Array.isArray(args.queries) ? args.queries.map(String).filter(Boolean).slice(0, 4) : [];
  const limit = Math.min(Math.max(Number(args.limit_per_query || 5), 1), 8);
  const groups = await Promise.all(queries.map(async (query) => {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { "user-agent": "OntologyResearchWorkbench/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`公开检索失败 (${response.status})`);
    const xml = await response.text();
    const items = parseRss(xml)
      .filter((item) => searchResultIsRelevant(query, item))
      .slice(0, Math.min(limit, 5));
    return Promise.all(items.map(async (item) => ({ ...item, query, ...(await retrieveSearchPage(item.url)) })));
  }));
  const results = groups.flat();
  for (const result of results) citations.push({ url: result.url, title: result.title });
  return { results };
}

async function fetchPublicPages(args: Record<string, unknown>, citations: Citation[]) {
  const urls = Array.isArray(args.urls) ? [...new Set(args.urls.map(String).filter(Boolean))].slice(0, 6) : [];
  const results = await Promise.all(urls.map(async (url) => {
    const retrieved = await retrieveSearchPage(url);
    citations.push({ url, title: url });
    return { url, ...retrieved };
  }));
  return { results };
}

const SEARCH_STOP_WORDS = new Set([
  "about", "after", "before", "current", "data", "evidence", "future", "latest", "market", "news",
  "official", "price", "report", "research", "trend", "update", "whether", "with", "year",
  "截至", "未来", "是否", "形成", "可持续", "方向", "判断", "验证", "最新", "报告", "数据", "市场",
]);

function queryTokens(value: string) {
  const latin = (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])
    .filter((token) => !SEARCH_STOP_WORDS.has(token) && !/^20\d{2}$/.test(token));
  const han = (value.match(/[\p{Script=Han}]{2,}/gu) || []).flatMap((chunk) => {
    const tokens: string[] = [];
    for (let index = 0; index < chunk.length - 1; index += 1) tokens.push(chunk.slice(index, index + 2));
    return tokens;
  }).filter((token) => !SEARCH_STOP_WORDS.has(token));
  return [...new Set([...latin, ...han])].slice(0, 40);
}

export function searchResultIsRelevant(
  query: string,
  result: { title?: string; summary?: string },
) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const haystack = `${result.title || ""} ${result.summary || ""}`.toLowerCase();
  const matches = tokens.filter((token) => haystack.includes(token));
  // A search hit must share at least one domain-bearing term with the query.
  // This rejects generic/year-only RSS noise before it can consume retrieval
  // budget or appear in the model's candidate set.
  return matches.length > 0;
}

async function retrieveSearchPage(url: string) {
  try {
    // Reuse the source snapshot path so every redirect is revalidated and
    // search-page retrieval cannot bypass the source acquisition SSRF rules.
    const snapshot = await captureSourceSnapshot({ url });
    const text = snapshot.snapshot_text || "";
    return {
      retrieval_status: snapshot.retrieval_status,
      final_url: snapshot.final_url || url,
      content_excerpt: text.slice(0, 8_000),
      locator_hint: text
        ? "必须从 content_excerpt 连续复制 ≥20 字作为 source_quote；禁止改写或自行插入逗号"
        : url,
      content_hash: snapshot.content_hash,
      retrieval_error: snapshot.failure_detail || undefined,
    };
  } catch (error) {
    return { retrieval_status: "failed", final_url: url, content_excerpt: "", locator_hint: url, retrieval_error: error instanceof Error ? error.message : String(error) };
  }
}

function parseRss(xml: string) {
  const items: Array<{ title: string; url: string; summary: string; published_at: string | null }> = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const title = xmlField(body, "title");
    const url = xmlField(body, "link");
    if (!title || !url) continue;
    items.push({
      title,
      url,
      summary: xmlField(body, "description"),
      published_at: xmlField(body, "pubDate") || null,
    });
  }
  return items;
}

function xmlField(body: string, tag: string) {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml((match?.[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]+>/g, " ").trim());
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function dedupeCitations(citations: Citation[]) {
  return [...new Map(citations.map((item) => [item.url, item])).values()];
}

const MCP_TOOL_NAMES = new Set([
  "query_cninfo", "query_datayes_finoper", "query_datayes_stock",
  "query_macro_data", "query_market_index", "query_fund_data",
  "query_china_policy", "query_research_reports", "query_caixin_news",
]);

function progressMessageForTool(toolName: string): string {
  if (toolName === "search_public_web") return "已完成公开网页检索";
  if (toolName === "fetch_public_pages") return "已抓取公开页面正文";
  if (toolName === "query_cninfo") return "已查询巨潮 cninfo MCP";
  if (toolName === "query_datayes_finoper") return "已查询通联财务 MCP";
  if (toolName === "query_datayes_stock") return "已查询通联股票 MCP";
  if (toolName === "query_macro_data") return "已查询通联宏观 MCP";
  if (toolName === "query_market_index") return "已查询通联指数 MCP";
  if (toolName === "query_fund_data") return "已查询通联基金 MCP";
  if (toolName === "query_china_policy") return "已查询中央政策 MCP";
  if (toolName === "query_research_reports") return "已查询华泰研报 MCP";
  if (toolName === "query_caixin_news") return "已查询财新新闻 MCP";
  if (toolName.startsWith("query_") || toolName.includes("ontology") || toolName.includes("object")) {
    return `已调用本体工具 ${toolName}`;
  }
  return `已调用工具 ${toolName}`;
}

function summarizeToolTrace(trace: Array<Record<string, unknown>>) {
  const retrievalAudit = trace
    .filter((item) => (
      item.name === "search_public_web"
      || item.name === "fetch_public_pages"
      || MCP_TOOL_NAMES.has(String(item.name))
    ))
    .flatMap((item) => {
      const result = item.result && typeof item.result === "object" ? item.result as any : {};
      return (Array.isArray(result.results) ? result.results : []).map((entry: any) => ({
        tool: item.name,
        query: entry.query || null,
        url: entry.url || null,
        title: entry.title || null,
        retrieval_status: entry.retrieval_status || "unknown",
        final_url: entry.final_url || null,
        content_hash: entry.content_hash || null,
        retrieval_error: entry.retrieval_error || null,
        mcp_channel: entry.mcp_channel || result.channel || null,
        authority_type: entry.authority_type || null,
        provenance_fingerprint: result.provenance?.response_fingerprint || null,
      }));
    })
    .slice(0, 80);
  return {
    tool_calls: trace.length,
    tools: trace.map((item) => item.name),
    web_search_calls: trace.filter((item) => item.name === "search_public_web").length,
    public_page_fetch_calls: trace.filter((item) => item.name === "fetch_public_pages").length,
    mcp_evidence_calls: trace.filter((item) => MCP_TOOL_NAMES.has(String(item.name))).length,
    ontology_tool_calls: trace.filter((item) => (
      item.name !== "search_public_web"
      && item.name !== "fetch_public_pages"
      && !MCP_TOOL_NAMES.has(String(item.name))
    )).length,
    retrieval_audit: retrievalAudit,
  };
}
