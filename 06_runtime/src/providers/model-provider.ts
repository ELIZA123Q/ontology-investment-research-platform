export interface ModelRequest {
  system: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface ModelResult {
  text: string;
  model: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  constructor(private readonly config: { apiKey: string; baseUrl: string; model: string; id?: string }) { this.id = config.id || "openai-compatible"; }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: this.config.model, messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }], max_tokens: request.maxOutputTokens || 2000, temperature: 0 }),
    });
    if (!response.ok) throw new Error(`${this.id} returned ${response.status}: ${await response.text()}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: body.choices?.[0]?.message?.content || "", model: this.config.model, provider: this.id, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens } };
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  constructor(private readonly config: { apiKey: string; model: string }) {}

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.config.model, system: request.system, messages: [{ role: "user", content: request.prompt }], max_tokens: request.maxOutputTokens || 2000 }),
    });
    if (!response.ok) throw new Error(`anthropic returned ${response.status}: ${await response.text()}`);
    const body = await response.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    return { text: body.content?.find((part) => part.type === "text")?.text || "", model: this.config.model, provider: this.id, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
  }
}

export function providerFromEnv(): ModelProvider | null {
  const selected = process.env.VNEXT_PROVIDER || "local";
  if (selected === "openai" && process.env.OPENAI_API_KEY) return new OpenAICompatibleProvider({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-5-mini", id: "openai" });
  if (selected === "deepseek" && process.env.DEEPSEEK_API_KEY) return new OpenAICompatibleProvider({ apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", model: process.env.DEEPSEEK_MODEL || "deepseek-chat", id: "deepseek" });
  if (selected === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" });
  return null;
}
