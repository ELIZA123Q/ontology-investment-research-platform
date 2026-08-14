export interface ModelRequest {
  system: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  schemaName?: string;
}

export interface ModelResult {
  text: string;
  model: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ModelProvider {
  readonly id: string;
  readonly modelId?: string;
  /** Defaults to external: only an explicit local deployment may receive restricted context. */
  readonly deployment?: "local" | "external";
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export class ModelProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) { super(message); this.name = "ModelProviderError"; }
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly modelId: string;
  readonly deployment = "external" as const;
  constructor(private readonly config: { apiKey: string; baseUrl: string; model: string; id?: string; structuredOutput?: "json_schema" | "json_object" | "prompt_only"; thinking?: "enabled" | "disabled" }) { this.id = config.id || "openai-compatible"; this.modelId = config.model; }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const structuredSystem = request.responseSchema && this.config.structuredOutput === "json_object"
      ? `${request.system}\n输出必须严格匹配以下 JSON Schema；不得回显输入、增加字段或改变字段类型：${JSON.stringify(request.responseSchema)}`
      : request.system;
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "system", content: structuredSystem }, { role: "user", content: request.prompt }],
        max_tokens: request.maxOutputTokens || 2000,
        temperature: 0,
        ...(this.config.thinking ? { thinking: { type: this.config.thinking } } : {}),
        ...(request.responseSchema && this.config.structuredOutput === "json_schema" ? { response_format: { type: "json_schema", json_schema: { name: request.schemaName || "structured_response", strict: false, schema: request.responseSchema } } } : {}),
        ...(request.responseSchema && this.config.structuredOutput === "json_object" ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) throw new ModelProviderError(`${this.id} returned HTTP ${response.status}${response.headers.get("x-request-id") ? ` (request ${response.headers.get("x-request-id")})` : ""}`, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, response.status);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: body.choices?.[0]?.message?.content || "", model: this.config.model, provider: this.id, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens } };
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly modelId: string;
  readonly deployment = "external" as const;
  constructor(private readonly config: { apiKey: string; model: string }) { this.modelId = config.model; }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.config.model, system: request.system, messages: [{ role: "user", content: request.prompt }], max_tokens: request.maxOutputTokens || 2000 }),
    });
    if (!response.ok) throw new ModelProviderError(`anthropic returned HTTP ${response.status}${response.headers.get("request-id") ? ` (request ${response.headers.get("request-id")})` : ""}`, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, response.status);
    const body = await response.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    return { text: body.content?.find((part) => part.type === "text")?.text || "", model: this.config.model, provider: this.id, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
  }
}

export function providerFromEnv(): ModelProvider | null {
  const selected = process.env.VNEXT_PROVIDER || "local";
  if (selected === "openai" && process.env.OPENAI_API_KEY) return new OpenAICompatibleProvider({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-5-mini", id: "openai", structuredOutput: "json_schema" });
  if (selected === "deepseek" && process.env.DEEPSEEK_API_KEY) return new OpenAICompatibleProvider({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    id: "deepseek",
    structuredOutput: "json_object",
    thinking: process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled",
  });
  if (selected === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" });
  return null;
}
