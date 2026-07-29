import "server-only";

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { dataMappingProfileForConnector } from "../engine/data_mapping_profiles";

/** Stage03 全量接入的一手通道（方法层 B03 已注册）。 */
export const EVIDENCE_MCP_CHANNELS = [
  "cninfo",
  "datayes-stock-finoper-mcp",
  "datayes-stock-info-mcp",
  "datayes-stock-mkt-mcp",
  "datayes-stock-eqhld-mcp",
  "datayes-stock-event-mcp",
  "datayes-macro-mcp",
  "datayes-index-info-mcp",
  "datayes-index-mktanl-mcp",
  "datayes-fund-master-mcp",
  "datayes-fund-perf-mcp",
  "datayes-fund-holding-mcp",
  "datayes-fund-fincap-mcp",
  "datayes-fund-analytics-mcp",
  "china-policy",
  "htsc_research_mcp",
  "caixin-news",
  "jina-reader",
] as const;

export type EvidenceMcpChannel = (typeof EVIDENCE_MCP_CHANNELS)[number];

export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: string;
  timeout?: number;
  disabled?: boolean;
};

export type McpCallProvenance = {
  connector: string;
  upstream_producer: string;
  query_parameters: Record<string, unknown>;
  tool_name: string | null;
  response_fingerprint: string;
  mapping_profile_id: string | null;
  mapping_profile_version: string | null;
  mapping_status: "registered" | "unregistered";
  ontology_target_types: string[];
  field_lineage_note: string;
  access_scope: "public" | "authorized" | "unknown";
  replayability: "replayable" | "time_sensitive" | "non_replayable" | "unknown";
  runtime_wired: true;
};

export type McpEvidenceHit = {
  title: string;
  url: string | null;
  summary: string;
  published_at: string | null;
  authority_type: "official" | "company_disclosure" | "industry_provider" | "public_secondary" | "unknown";
  publisher: string;
  raw_excerpt: string;
};

export type McpEvidenceQueryResult = {
  ok: boolean;
  channel: string;
  error?: string;
  fallback_hint?: string;
  available_tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  results: McpEvidenceHit[];
  provenance: McpCallProvenance | null;
  content_text: string;
};

export type McpToolCaller = (input: {
  channel: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}) => Promise<{
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  contentText: string;
  structured?: unknown;
}>;

const CHANNEL_META: Record<EvidenceMcpChannel, {
  upstream_producer: string;
  authority_type: McpEvidenceHit["authority_type"];
  publisher: string;
  access_scope: McpCallProvenance["access_scope"];
  fallback_hint: string;
  toolHints: string[];
}> = {
  cninfo: {
    upstream_producer: "巨潮资讯网",
    authority_type: "company_disclosure",
    publisher: "巨潮资讯网",
    access_scope: "public",
    fallback_hint: "cninfo MCP 不可用 → 巨潮官网 http://www.cninfo.com.cn → 通用 OPS 公司披露；可用 search_public_web / fetch_public_pages 回退。",
    toolHints: ["announcement", "cninfo", "notice", "list", "search", "公告"],
  },
  "datayes-stock-finoper-mcp": {
    upstream_producer: "通联数据",
    authority_type: "company_disclosure",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "datayes-stock-finoper MCP 不可用 → cninfo 定期报告原文 → 通用 OPS A股披露；可用 search_public_web / fetch_public_pages 回退。",
    toolHints: ["get_data", "finoper_get_data", "income", "balance", "cash", "fin", "statement", "profit", "财务", "利润"],
  },
  "china-policy": {
    upstream_producer: "中央政策数据库",
    authority_type: "official",
    publisher: "中央政策数据库",
    access_scope: "public",
    fallback_hint: "china-policy MCP 不可用 → 中国政府网政策库 → 通用 OPS 中国法规；可用 search_public_web / fetch_public_pages 回退。",
    toolHints: ["policy", "document", "search", "list", "政策"],
  },
  "datayes-stock-info-mcp": {
    upstream_producer: "通联数据",
    authority_type: "company_disclosure",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 stock-info MCP 不可用 → cninfo 定期报告 → 公开网页搜索。",
    toolHints: ["get_data", "stock_info", "company", "profile", "基本信息", "公司", "股东"],
  },
  "datayes-stock-mkt-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 stock-mkt MCP 不可用 → 交易所公开行情 → 公开网页搜索。",
    toolHints: ["get_data", "mkt", "market", "price", "行情", "K线", "价格", "技术指标"],
  },
  "datayes-stock-eqhld-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 stock-eqhld MCP 不可用 → cninfo 定期报告（前十大股东） → 公开网页搜索。",
    toolHints: ["get_data", "eqhld", "holder", "institution", "持仓", "机构", "股东"],
  },
  "datayes-stock-event-mcp": {
    upstream_producer: "通联数据",
    authority_type: "company_disclosure",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 stock-event MCP 不可用 → cninfo 公告原文 → 公开网页搜索。",
    toolHints: ["get_data", "event", "事件", "公告", "新闻", "摘要"],
  },
  "datayes-macro-mcp": {
    upstream_producer: "通联数据",
    authority_type: "official",
    publisher: "通联数据（国家统计局/央行/海关等）",
    access_scope: "authorized",
    fallback_hint: "通联 macro MCP 不可用 → 国家统计局/央行/海关官网 → 公开网页搜索。",
    toolHints: ["get_data", "macro", "GDP", "CPI", "PMI", "宏观", "指标", "经济"],
  },
  "datayes-index-info-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 index-info MCP 不可用 → 交易所指数页面 → 公开网页搜索。",
    toolHints: ["get_data", "index", "成分", "权重", "constituent"],
  },
  "datayes-index-mktanl-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 index-mktanl MCP 不可用 → 交易所行情 → 公开网页搜索。",
    toolHints: ["get_data", "index", "market", "valuation", "行情", "估值", "PE", "PB"],
  },
  "datayes-fund-master-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 fund-master MCP 不可用 → 基金公司官网 → 公开网页搜索。",
    toolHints: ["get_data", "fund", "master", "基金", "基本信息", "fund_info"],
  },
  "datayes-fund-perf-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 fund-perf MCP 不可用 → 基金公司官网 → 公开网页搜索。",
    toolHints: ["get_data", "fund", "perf", "performance", "业绩", "收益", "回报"],
  },
  "datayes-fund-holding-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 fund-holding MCP 不可用 → 基金季报 → 公开网页搜索。",
    toolHints: ["get_data", "fund", "holding", "持仓", "股票", "债券"],
  },
  "datayes-fund-fincap-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 fund-fincap MCP 不可用 → 基金公司官网 → 公开网页搜索。",
    toolHints: ["get_data", "fund", "fincap", "财务", "规模", "净资产"],
  },
  "datayes-fund-analytics-mcp": {
    upstream_producer: "通联数据",
    authority_type: "industry_provider",
    publisher: "通联数据",
    access_scope: "authorized",
    fallback_hint: "通联 fund-analytics MCP 不可用 → 公开网页搜索。",
    toolHints: ["get_data", "fund", "analytics", "分析", "风险", "指标"],
  },
  "htsc_research_mcp": {
    upstream_producer: "华泰证券研究所",
    authority_type: "public_secondary",
    publisher: "华泰证券研究所",
    access_scope: "authorized",
    fallback_hint: "华泰研报 MCP 不可用 → 公开研报平台 → 公开网页搜索。注意：研报观点不代表事实，需交叉核验。",
    toolHints: ["search", "report", "research", "研报", "行业", "公司", "估值"],
  },
  "caixin-news": {
    upstream_producer: "财新传媒",
    authority_type: "public_secondary",
    publisher: "财新传媒",
    access_scope: "authorized",
    fallback_hint: "财新 MCP 不可用 → 公开新闻搜索。",
    toolHints: ["search", "news", "article", "新闻", "文章"],
  },
  "jina-reader": {
    upstream_producer: "目标网页",
    authority_type: "public_secondary",
    publisher: "目标网页自身",
    access_scope: "public",
    fallback_hint: "jina-reader MCP 不可用 → fetch_public_pages（snapshot 直连抓取）。",
    toolHints: ["read", "fetch", "extract", "抓取", "阅读", "提取", "网页"],
  },
};

let cachedConfig: Record<string, McpServerConfig> | null = null;
let injectedCaller: McpToolCaller | null = null;

/** 测试注入；生产路径不要调用。 */
export function setMcpEvidenceCallerForTests(caller: McpToolCaller | null) {
  injectedCaller = caller;
}

export function resetMcpEvidenceConfigCache() {
  cachedConfig = null;
}

export function isEvidenceMcpChannel(value: string): value is EvidenceMcpChannel {
  return (EVIDENCE_MCP_CHANNELS as readonly string[]).includes(value);
}

export function mcpConfigPath() {
  return process.env.MCP_CONFIG_PATH || join(homedir(), ".workbuddy", "mcp.json");
}

export function loadMcpServerConfigs(path = mcpConfigPath()): Record<string, McpServerConfig> {
  if (cachedConfig && path === mcpConfigPath()) return cachedConfig;
  const raw = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, McpServerConfig> };
  const servers = raw.mcpServers || {};
  if (path === mcpConfigPath()) cachedConfig = servers;
  return servers;
}

export function getEvidenceMcpServerConfig(channel: string): McpServerConfig | null {
  try {
    const servers = loadMcpServerConfigs();
    const config = servers[channel];
    if (!config || config.disabled) return null;
    return config;
  } catch {
    return null;
  }
}

function fingerprint(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return `mcp_${Math.abs(hash).toString(16)}_${text.length}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "", null, 2).slice(0, 24_000);
  return content.map((item) => {
    if (!item || typeof item !== "object") return String(item ?? "");
    const row = item as Record<string, unknown>;
    if (typeof row.text === "string") return row.text;
    if (typeof row.data === "string") return row.data;
    return JSON.stringify(row).slice(0, 4_000);
  }).join("\n").slice(0, 24_000);
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
  return [...new Set(matches.map((url) => url.replace(/[.,;]+$/, "")))].slice(0, 12);
}

function pickToolName(
  tools: Array<{ name: string; description?: string }>,
  preferred: string | undefined,
  hints: string[],
): string | null {
  if (preferred && tools.some((tool) => tool.name === preferred)) return preferred;
  if (!tools.length) return null;
  const scored = tools.map((tool) => {
    const hay = `${tool.name} ${tool.description || ""}`.toLowerCase();
    const score = hints.reduce((sum, hint) => sum + (hay.includes(hint.toLowerCase()) ? 1 : 0), 0);
    return { name: tool.name, score };
  }).sort((a, b) => b.score - a.score);
  if (scored[0]?.score) return scored[0].name;
  return tools[0]?.name || null;
}

async function callViaSdk(input: {
  channel: string;
  config: McpServerConfig;
  toolName?: string;
  arguments?: Record<string, unknown>;
}): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }>; contentText: string; structured?: unknown }> {
  const client = new Client({ name: "ontology-research-workbench", version: "0.1.0" });
  const timeoutMs = Math.min(Math.max(Number(input.config.timeout || 60_000), 5_000), 45_000);
  const connectTimeoutMs = Math.min(15_000, timeoutMs);
  let transport: { close?: () => Promise<void> } | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let callTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (callTimer) clearTimeout(callTimer);
    connectTimer = undefined;
    callTimer = undefined;
  };

  try {
    await Promise.race([
      (async () => {
        if (input.config.command) {
          const stdio = new StdioClientTransport({
            command: input.config.command,
            args: input.config.args || [],
            env: { ...process.env, ...(input.config.env || {}) } as Record<string, string>,
          });
          transport = stdio;
          await client.connect(stdio);
        } else if (input.config.url) {
          const url = new URL(input.config.url);
          const requestInit = input.config.headers ? { headers: input.config.headers } : undefined;
          const transportType = String(input.config.type || "streamablehttp").toLowerCase();
          if (transportType === "sse") {
            const sse = new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
            transport = sse;
            await client.connect(sse);
          } else {
            const http = new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
            transport = http;
            await client.connect(http);
          }
        } else {
          throw new Error(`MCP 通道 ${input.channel} 缺少 command 或 url`);
        }
      })(),
      new Promise<never>((_, reject) => {
        connectTimer = setTimeout(() => reject(new Error(`MCP 连接超时 ${connectTimeoutMs}ms`)), connectTimeoutMs);
      }),
    ]);

    const listed = await client.listTools();
    const tools = (listed.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    if (input.arguments?.__list_only === true) {
      return { tools, contentText: "", structured: { tool_name: null, isError: false, list_only: true } };
    }
    const meta = isEvidenceMcpChannel(input.channel) ? CHANNEL_META[input.channel] : null;
    const resolvedName = pickToolName(tools, input.toolName, meta?.toolHints || []);
    if (!resolvedName) {
      return { tools, contentText: "", structured: null };
    }
    if (input.toolName && input.toolName !== resolvedName && !tools.some((tool) => tool.name === input.toolName)) {
      return { tools, contentText: "", structured: { error: `工具 ${input.toolName} 不存在` } };
    }

    const callArgs = { ...(input.arguments || {}) };
    delete callArgs.__list_only;

    const result = await Promise.race([
      client.callTool({
        name: resolvedName,
        arguments: callArgs,
      }),
      new Promise<never>((_, reject) => {
        callTimer = setTimeout(() => reject(new Error(`MCP 调用超时 ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);

    const contentText = contentToText((result as { content?: unknown }).content);
    return {
      tools,
      contentText,
      structured: {
        tool_name: resolvedName,
        isError: Boolean((result as { isError?: boolean }).isError),
        structuredContent: (result as { structuredContent?: unknown }).structuredContent ?? null,
      },
    };
  } finally {
    clearTimers();
    // 不等待 HTTP 会话优雅关闭；残留句柄由调用方/worker 进程生命周期消化。
    void Promise.resolve()
      .then(async () => {
        try { await client.close(); } catch { /* ignore */ }
        try { await transport?.close?.(); } catch { /* ignore */ }
      });
  }
}

function hitsFromText(
  channel: string,
  contentText: string,
): McpEvidenceHit[] {
  const meta = isEvidenceMcpChannel(channel) ? CHANNEL_META[channel] : null;
  const urls = extractUrls(contentText);
  if (urls.length) {
    return urls.map((url, index) => ({
      title: `${meta?.publisher || channel} 结果 ${index + 1}`,
      url,
      summary: contentText.slice(0, 500),
      published_at: null,
      authority_type: meta?.authority_type || "unknown",
      publisher: meta?.publisher || channel,
      raw_excerpt: contentText.slice(0, 8_000),
    }));
  }
  if (!contentText.trim()) return [];
  return [{
    title: `${meta?.publisher || channel} 结构化响应`,
    url: null,
    summary: contentText.slice(0, 500),
    published_at: null,
    authority_type: meta?.authority_type || "unknown",
    publisher: meta?.publisher || channel,
    raw_excerpt: contentText.slice(0, 8_000),
  }];
}

function mappingProvenance(connector: string) {
  const profile = dataMappingProfileForConnector(connector);
  return {
    mapping_profile_id: profile?.id || null,
    mapping_profile_version: profile?.version || null,
    mapping_status: profile ? "registered" as const : "unregistered" as const,
    ontology_target_types: profile
      ? [...new Set(profile.target_mappings.map((mapping) => mapping.target_type))]
      : [],
  };
}

/**
 * 调用一手证据 MCP。失败时返回 ok:false + fallback_hint，不抛到模型环外。
 * 密钥只读自 MCP_CONFIG_PATH / ~/.workbuddy/mcp.json，不写入仓库。
 */
export async function queryEvidenceMcp(input: {
  channel: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
}): Promise<McpEvidenceQueryResult> {
  const channel = String(input.channel || "").trim();
  const meta = isEvidenceMcpChannel(channel) ? CHANNEL_META[channel] : null;
  const fallback = meta?.fallback_hint
    || `${channel} MCP 不可用时回退 search_public_web / fetch_public_pages，并登记 gap。`;

  if (!channel) {
    return {
      ok: false,
      channel,
      error: "缺少 channel",
      fallback_hint: fallback,
      results: [],
      provenance: null,
      content_text: "",
    };
  }

  const queryParameters = {
    channel,
    tool_name: input.tool_name || null,
    arguments: input.arguments || {},
  };

  try {
    const config = getEvidenceMcpServerConfig(channel);
    if (!config && !injectedCaller) {
      return {
        ok: false,
        channel,
        error: `未找到可用 MCP 配置：${channel}`,
        fallback_hint: fallback,
        results: [],
        provenance: null,
        content_text: "",
      };
    }

    const called = injectedCaller
      ? await injectedCaller({
        channel,
        toolName: input.tool_name,
        arguments: input.arguments,
      })
      : await callViaSdk({
        channel,
        config: config!,
        toolName: input.tool_name,
        arguments: input.arguments,
      });

    const contentText = called.contentText || "";
    const structuredTool = called.structured && typeof called.structured === "object"
      ? (called.structured as { tool_name?: string; isError?: boolean })
      : null;
    const toolName = structuredTool?.tool_name || input.tool_name || null;

    if (structuredTool?.isError) {
      return {
        ok: false,
        channel,
        error: contentText.slice(0, 500) || "MCP 工具返回 isError",
        fallback_hint: fallback,
        available_tools: called.tools,
        results: [],
        provenance: {
          connector: channel,
          upstream_producer: meta?.upstream_producer || channel,
          query_parameters: queryParameters,
          tool_name: toolName,
          response_fingerprint: fingerprint(contentText),
          ...mappingProvenance(channel),
          field_lineage_note: "MCP 原始 content；字段血缘待人工核验后写入 EvidenceFact",
          access_scope: meta?.access_scope || "unknown",
          replayability: "time_sensitive",
          runtime_wired: true,
        },
        content_text: contentText,
      };
    }

    if (!contentText.trim() && called.tools?.length && !input.tool_name) {
      return {
        ok: false,
        channel,
        error: "未指定 tool_name，且自动选择未能产出内容；请从 available_tools 选择后重试",
        fallback_hint: fallback,
        available_tools: called.tools,
        results: [],
        provenance: null,
        content_text: "",
      };
    }

    const results = hitsFromText(channel, contentText);
    return {
      ok: results.length > 0,
      channel,
      error: results.length ? undefined : "MCP 返回空内容",
      fallback_hint: results.length ? undefined : fallback,
      available_tools: called.tools,
      results,
      provenance: {
        connector: channel,
        upstream_producer: meta?.upstream_producer || channel,
        query_parameters: queryParameters,
        tool_name: toolName,
        response_fingerprint: fingerprint(contentText || called.structured),
        ...mappingProvenance(channel),
        field_lineage_note: "MCP 原始 content；关键字段写入证据前需映射到上游响应路径",
        access_scope: meta?.access_scope || "unknown",
        replayability: "time_sensitive",
        runtime_wired: true,
      },
      content_text: contentText,
    };
  } catch (error) {
    return {
      ok: false,
      channel,
      error: error instanceof Error ? error.message : String(error),
      fallback_hint: fallback,
      results: [],
      provenance: {
        connector: channel,
        upstream_producer: meta?.upstream_producer || channel,
        query_parameters: queryParameters,
        tool_name: input.tool_name || null,
        response_fingerprint: fingerprint(String(error)),
        ...mappingProvenance(channel),
        field_lineage_note: "调用失败，无可用字段血缘",
        access_scope: meta?.access_scope || "unknown",
        replayability: "unknown",
        runtime_wired: true,
      },
      content_text: "",
    };
  }
}

export async function queryCninfo(args: Record<string, unknown>) {
  const stockCode = String(args.stock_code || args.stockCode || "").trim();
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (stockCode) toolArguments.stock_code = stockCode;
  if (args.category) toolArguments.category = args.category;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;
  if (args.keyword) toolArguments.keyword = args.keyword;
  return queryEvidenceMcp({
    channel: "cninfo",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

export async function queryDatayesFinoper(args: Record<string, unknown>) {
  const stockCode = String(args.stock_code || args.stockCode || args.ticker || "").trim();
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (stockCode) {
    toolArguments.stock_code = stockCode;
    toolArguments.ticker = stockCode;
    if (!toolArguments.tickerSymbol) toolArguments.tickerSymbol = stockCode;
    if (!toolArguments.secID && /^\d{6}$/.test(stockCode)) {
      toolArguments.secID = `${stockCode}.${Number(stockCode) >= 600000 ? "XSHG" : "XSHE"}`;
    }
  }
  if (args.period) toolArguments.period = args.period;
  if (args.statement_type) toolArguments.statement_type = args.statement_type;
  if (args.report_type) toolArguments.report_type = args.report_type;
  if (args.api_name) toolArguments.api_name = args.api_name;

  // 通联 finoper 强制要求 api_name；未提供时只列工具 schema，避免盲打失败。
  if (!toolArguments.api_name && !args.tool_name) {
    const listed = await queryEvidenceMcp({
      channel: "datayes-stock-finoper-mcp",
      arguments: { __list_only: true },
    });
    return {
      ...listed,
      ok: false,
      error: "datayes-stock-finoper 需要 api_name。请查看 available_tools[].inputSchema，选定 api_name 后重试 query_datayes_finoper。",
      fallback_hint: listed.fallback_hint
        || CHANNEL_META["datayes-stock-finoper-mcp"].fallback_hint,
    };
  }

  return queryEvidenceMcp({
    channel: "datayes-stock-finoper-mcp",
    tool_name: args.tool_name ? String(args.tool_name) : "stock_finoper_get_data",
    arguments: toolArguments,
  });
}

export async function queryChinaPolicy(args: Record<string, unknown>) {
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.keyword) toolArguments.keyword = args.keyword;
  if (args.query) toolArguments.query = args.query;
  if (args.domain) toolArguments.domain = args.domain;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;
  return queryEvidenceMcp({
    channel: "china-policy",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/**
 * 通联股票综合数据：行情、公司信息、机构持仓、公司事件。
 * 通过 data_type 参数路由到具体 MCP 通道。
 *   stock_market → datayes-stock-mkt-mcp（K线、行情、技术指标）
 *   stock_info   → datayes-stock-info-mcp（公司基本信息、股东）
 *   stock_holders → datayes-stock-eqhld-mcp（机构持仓）
 *   stock_events → datayes-stock-event-mcp（公司事件）
 */
export async function queryDatayesStock(args: Record<string, unknown>) {
  const dataType = String(args.data_type || "stock_market").trim();
  const channel = dataType === "stock_info" ? "datayes-stock-info-mcp"
    : dataType === "stock_holders" ? "datayes-stock-eqhld-mcp"
    : dataType === "stock_events" ? "datayes-stock-event-mcp"
    : "datayes-stock-mkt-mcp";

  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  const stockCode = String(args.stock_code || args.stockCode || args.ticker || "").trim();
  if (stockCode) {
    toolArguments.stock_code = stockCode;
    toolArguments.ticker = stockCode;
    if (!toolArguments.secID && /^\d{6}$/.test(stockCode)) {
      toolArguments.secID = `${stockCode}.${Number(stockCode) >= 600000 ? "XSHG" : "XSHE"}`;
    }
  }
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;
  if (args.period) toolArguments.period = args.period;
  if (args.keyword) toolArguments.keyword = args.keyword;

  return queryEvidenceMcp({
    channel,
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/**
 * 通联宏观经济数据：GDP、CPI、PMI、贸易等。
 */
export async function queryDatayesMacro(args: Record<string, unknown>) {
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.indicator) toolArguments.indicator = args.indicator;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;
  if (args.keyword) toolArguments.keyword = args.keyword;

  return queryEvidenceMcp({
    channel: "datayes-macro-mcp",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/**
 * 通联指数数据：成分权重、行情估值。
 * data_type: index_info（成分权重）或 index_market（行情估值，默认）。
 */
export async function queryDatayesIndex(args: Record<string, unknown>) {
  const dataType = String(args.data_type || "index_market").trim();
  const channel = dataType === "index_info" ? "datayes-index-info-mcp" : "datayes-index-mktanl-mcp";

  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.index_code) toolArguments.index_code = args.index_code;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;

  return queryEvidenceMcp({
    channel,
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/**
 * 通联基金数据：基本信息、业绩、持仓、财务、分析。
 * data_type: fund_master/fund_perf/fund_holding/fund_fincap/fund_analytics。
 */
export async function queryDatayesFund(args: Record<string, unknown>) {
  const dataType = String(args.data_type || "fund_master").trim();
  const channel = dataType === "fund_perf" ? "datayes-fund-perf-mcp"
    : dataType === "fund_holding" ? "datayes-fund-holding-mcp"
    : dataType === "fund_fincap" ? "datayes-fund-fincap-mcp"
    : dataType === "fund_analytics" ? "datayes-fund-analytics-mcp"
    : "datayes-fund-master-mcp";

  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.fund_code) toolArguments.fund_code = args.fund_code;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;

  return queryEvidenceMcp({
    channel,
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/** 华泰证券研究所研报查询。 */
export async function queryHtscResearch(args: Record<string, unknown>) {
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.keyword) toolArguments.keyword = args.keyword;
  if (args.industry) toolArguments.industry = args.industry;
  if (args.stock_code) toolArguments.stock_code = args.stock_code;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;
  if (args.limit) toolArguments.limit = args.limit;

  return queryEvidenceMcp({
    channel: "htsc_research_mcp",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/** 财新新闻查询。 */
export async function queryCaixinNews(args: Record<string, unknown>) {
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.keyword) toolArguments.keyword = args.keyword;
  if (args.query) toolArguments.query = args.query;
  if (args.start_date) toolArguments.start_date = args.start_date;
  if (args.end_date) toolArguments.end_date = args.end_date;

  return queryEvidenceMcp({
    channel: "caixin-news",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: toolArguments,
  });
}

/** 通过 jina-reader MCP 提取网页内容（优于纯 HTTP 抓取，可获得 AI 友好的结构化文本）。 */
export async function fetchViaJinaReader(args: Record<string, unknown>) {
  const toolArguments: Record<string, unknown> = { ...(args.arguments as object || {}) };
  if (args.url) toolArguments.url = args.url;
  if (args.urls) toolArguments.urls = args.urls;

  // jina-reader 是 SSE 通道，只需要传入 URL
  const urls = Array.isArray(args.urls) ? args.urls.map(String) : args.url ? [String(args.url)] : [];
  if (!urls.length) {
    return {
      ok: false,
      channel: "jina-reader",
      error: "缺少 url 或 urls 参数",
      fallback_hint: "提供公开网页 URL 后重试。",
      results: [],
      provenance: null,
      content_text: "",
    } as McpEvidenceQueryResult;
  }

  return queryEvidenceMcp({
    channel: "jina-reader",
    tool_name: args.tool_name ? String(args.tool_name) : undefined,
    arguments: { ...toolArguments, url: urls[0] },
  });
}
