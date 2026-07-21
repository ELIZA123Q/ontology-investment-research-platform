import "server-only";

export type ModelRole = "producer" | "reviewer";
export type ModelProviderId = "deepseek" | "openai_compatible";

export type ResolvedModelProvider = {
  provider: ModelProviderId;
  role: ModelRole;
  model: string;
  apiKey: string;
  baseURL: string;
  requestTimeoutMs: number;
  generationTimeoutMs: number;
  maxTokens: number;
  reasoningEffort: "high" | "max" | null;
  displayName: string;
};

function boundedTimeout(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), min), max) : fallback;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`缺少 ${name}，请在 .env.local 中配置`);
  return value;
}

/**
 * Resolve producer/reviewer model credentials.
 *
 * - `deepseek` (default): existing DEEPSEEK_* variables
 * - `openai_compatible`: second vendor via OPENAI_COMPAT_* (OpenAI, Qwen, etc.)
 *
 * Reviewer may use a different provider via REVIEW_MODEL_PROVIDER so the five-role
 * evaluation isolation requirement is no longer blocked on a single DeepSeek account.
 */
export function resolveModelProvider(role: ModelRole = "producer"): ResolvedModelProvider {
  const provider = (
    role === "reviewer"
      ? process.env.REVIEW_MODEL_PROVIDER || process.env.RESEARCH_MODEL_PROVIDER
      : process.env.RESEARCH_MODEL_PROVIDER
  )?.trim().toLowerCase() || "deepseek";

  if (provider !== "deepseek" && provider !== "openai_compatible") {
    throw new Error(`不支持的 RESEARCH_MODEL_PROVIDER/REVIEW_MODEL_PROVIDER: ${provider}（允许 deepseek | openai_compatible）`);
  }

  const requestTimeoutMs = boundedTimeout(
    provider === "deepseek" ? "DEEPSEEK_REQUEST_TIMEOUT_MS" : "OPENAI_COMPAT_REQUEST_TIMEOUT_MS",
    180_000,
    10_000,
    600_000,
  );
  const generationTimeoutMs = boundedTimeout(
    provider === "deepseek" ? "DEEPSEEK_GENERATION_TIMEOUT_MS" : "OPENAI_COMPAT_GENERATION_TIMEOUT_MS",
    480_000,
    30_000,
    1_200_000,
  );

  if (provider === "openai_compatible") {
    const apiKey = role === "reviewer"
      ? process.env.OPENAI_COMPAT_REVIEW_API_KEY
        || process.env.OPENAI_COMPAT_API_KEY
        || process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_COMPAT_API_KEY || process.env.OPENROUTER_API_KEY;
    const model = role === "reviewer"
      ? process.env.OPENAI_COMPAT_REVIEW_MODEL || process.env.OPENAI_COMPAT_MODEL
      : process.env.OPENAI_COMPAT_MODEL;
    const defaultBaseURL = process.env.OPENROUTER_API_KEY && !process.env.OPENAI_COMPAT_API_KEY
      ? "https://openrouter.ai/api/v1"
      : "https://api.openai.com/v1";
    return {
      provider,
      role,
      model: required(role === "reviewer" ? "OPENAI_COMPAT_REVIEW_MODEL/OPENAI_COMPAT_MODEL" : "OPENAI_COMPAT_MODEL", model),
      apiKey: required(
        role === "reviewer"
          ? "OPENAI_COMPAT_REVIEW_API_KEY/OPENAI_COMPAT_API_KEY/OPENROUTER_API_KEY"
          : "OPENAI_COMPAT_API_KEY/OPENROUTER_API_KEY",
        apiKey,
      ),
      baseURL: process.env.OPENAI_COMPAT_BASE_URL || defaultBaseURL,
      requestTimeoutMs,
      generationTimeoutMs,
      maxTokens: Number(process.env.OPENAI_COMPAT_MAX_TOKENS || 16384),
      reasoningEffort: null,
      displayName: process.env.OPENAI_COMPAT_DISPLAY_NAME
        || (process.env.OPENROUTER_API_KEY ? "OpenRouter" : "OpenAI-compatible"),
    };
  }

  const apiKey = role === "reviewer"
    ? process.env.DEEPSEEK_REVIEW_API_KEY || process.env.DEEPSEEK_API_KEY
    : process.env.DEEPSEEK_API_KEY;
  const model = role === "reviewer"
    ? process.env.DEEPSEEK_REVIEW_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
    : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  return {
    provider: "deepseek",
    role,
    model,
    apiKey: required(role === "reviewer" ? "DEEPSEEK_REVIEW_API_KEY/DEEPSEEK_API_KEY" : "DEEPSEEK_API_KEY", apiKey),
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    requestTimeoutMs,
    generationTimeoutMs,
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 32768),
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high",
    displayName: "DeepSeek",
  };
}

export function listConfiguredProviders(): ModelProviderId[] {
  const providers = new Set<ModelProviderId>();
  if (process.env.DEEPSEEK_API_KEY) providers.add("deepseek");
  if (process.env.OPENAI_COMPAT_API_KEY || process.env.OPENROUTER_API_KEY) providers.add("openai_compatible");
  return [...providers];
}
