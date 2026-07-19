import "server-only";

import OpenAI from "openai";
import { zodFunction } from "openai/helpers/zod";
import type { z } from "zod";
import { schemas, type SchemaKind } from "../engine/schemas";
import { ontologyToolDefinitions, runOntologyTool, type OntologyToolName } from "../engine/ontology_tools";
import { captureSourceSnapshot } from "../engine/source_snapshot";

type Citation = { url: string; title: string };
export type ModelResult<T> = {
  data: T;
  raw: string;
  responseId: string;
  usage: unknown;
  toolUsage: unknown;
  citations: Citation[];
};

type GenerateOptions = { webSearch?: boolean; ontologyTools?: boolean; runId?: string };

function boundedTimeout(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), min), max) : fallback;
}

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
  readonly provider = "deepseek";
  readonly model: string;
  readonly reasoning = process.env.DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high";
  readonly role: "producer" | "reviewer";

  constructor(role: "producer" | "reviewer" = "producer") {
    this.role = role;
    this.model = role === "reviewer"
      ? process.env.DEEPSEEK_REVIEW_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-pro"
      : process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
    const apiKey = role === "reviewer" ? process.env.DEEPSEEK_REVIEW_API_KEY || process.env.DEEPSEEK_API_KEY : process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error(`缺少 ${role === "reviewer" ? "DEEPSEEK_REVIEW_API_KEY/DEEPSEEK_API_KEY" : "DEEPSEEK_API_KEY"}，请在 .env.local 中配置`);
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      timeout: boundedTimeout("DEEPSEEK_REQUEST_TIMEOUT_MS", 180_000, 10_000, 600_000),
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
    const submitName = `submit_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const submitTool = zodFunction({
      name: submitName,
      description: `提交最终 ${name} JSON。完成必要的检索和工具调用后必须调用此函数。`,
      parameters: schema,
    });
    const tools: any[] = [];
    if (options.webSearch) tools.push(webSearchTool, fetchPublicPagesTool);
    if (options.ontologyTools) tools.push(...chatOntologyTools());
    tools.push(submitTool);

    const messages: any[] = [
      {
        role: "system",
        content: `${instructions}\n\n你正在使用 DeepSeek V4。最终结果必须是合法 JSON，并通过 ${submitName} 函数提交。不要在普通文本中输出最终结果。Schema 中由 Runtime 回填的 source_id、抓取时间/hash、deterministic_result、冻结产物 hash、reviewer/producer model 等字段必须显式提交 null，不得自行伪造；Runtime 会在保存前覆盖。${options.webSearch ? "需要最新外部事实时，必须先调用 search_public_web；搜索摘要只是候选线索。" : ""}`,
      },
      { role: "user", content: input },
    ];
    const citations: Citation[] = [];
    const toolTrace: Array<Record<string, unknown>> = [];
    let raw = "";
    let lastResponseId = "";
    let lastUsage: unknown = {};
    const generationTimeoutMs = boundedTimeout("DEEPSEEK_GENERATION_TIMEOUT_MS", 480_000, 30_000, 1_200_000);
    const deadline = Date.now() + generationTimeoutMs;

    for (let round = 0; round < 8; round++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`MODEL_TIMEOUT: DeepSeek 结构化生成超过 ${generationTimeoutMs}ms`);
      let response: any;
      try {
        response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          tools,
          tool_choice: "auto",
          reasoning_effort: this.reasoning,
          max_tokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 32768),
          extra_body: { thinking: { type: "enabled" } },
        } as any, { timeout: Math.min(remaining, boundedTimeout("DEEPSEEK_REQUEST_TIMEOUT_MS", 180_000, 10_000, 600_000)) });
      } catch (error) {
        if (Date.now() >= deadline || /timed?\s*out|timeout|abort/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))) {
          throw new Error(`MODEL_TIMEOUT: DeepSeek 第 ${round + 1} 轮未在时限内返回`, { cause: error });
        }
        throw error;
      }
      lastResponseId = response.id || "";
      lastUsage = response.usage || {};
      const message: any = response.choices?.[0]?.message;
      if (!message) throw new Error("DeepSeek 未返回消息");
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
            return {
              data: schema.parse(args),
              raw,
              responseId: lastResponseId,
              usage: lastUsage,
              toolUsage: summarizeToolTrace(toolTrace),
              citations: dedupeCitations(citations),
            };
          } catch (error) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: "提交内容未通过 schema", details: error instanceof Error ? error.message : String(error) }).slice(0, 12000),
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
      }
    }
    throw new Error("DeepSeek 未在工具调用上限内提交合法结构化结果");
  }
}

export class ResearchModelClient extends DeepSeekClient {
  generate(kind: SchemaKind, instructions: string, input: string, options: GenerateOptions = {}): Promise<ModelResult<any>> {
    return this.generateStructured<any>(kind, schemas[kind] as z.ZodType<any>, instructions, input, options);
  }
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
      locator_hint: text ? "请从 content_excerpt 中复制一段逐字 source_quote 作为定位" : url,
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

function summarizeToolTrace(trace: Array<Record<string, unknown>>) {
  const retrievalAudit = trace
    .filter((item) => item.name === "search_public_web" || item.name === "fetch_public_pages")
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
      }));
    })
    .slice(0, 80);
  return {
    tool_calls: trace.length,
    tools: trace.map((item) => item.name),
    web_search_calls: trace.filter((item) => item.name === "search_public_web").length,
    public_page_fetch_calls: trace.filter((item) => item.name === "fetch_public_pages").length,
    ontology_tool_calls: trace.filter((item) => item.name !== "search_public_web" && item.name !== "fetch_public_pages").length,
    retrieval_audit: retrievalAudit,
  };
}
