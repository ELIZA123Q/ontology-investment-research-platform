import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveModelProvider, listConfiguredProviders } from "@/adapters/model_provider";

const KEYS = [
  "RESEARCH_MODEL_PROVIDER",
  "REVIEW_MODEL_PROVIDER",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_REVIEW_MODEL",
  "DEEPSEEK_REVIEW_API_KEY",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_MODEL",
  "OPENAI_COMPAT_REVIEW_API_KEY",
  "OPENAI_COMPAT_REVIEW_MODEL",
  "OPENAI_COMPAT_BASE_URL",
  "OPENROUTER_API_KEY",
] as const;

const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of KEYS) snapshot[key] = process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

describe("resolveModelProvider", () => {
  it("defaults to deepseek producer credentials", () => {
    clearKeys();
    process.env.DEEPSEEK_API_KEY = "sk-deepseek";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    const resolved = resolveModelProvider("producer");
    expect(resolved.provider).toBe("deepseek");
    expect(resolved.model).toBe("deepseek-v4-flash");
    expect(resolved.baseURL).toContain("deepseek");
  });

  it("resolves openai_compatible reviewer independently", () => {
    clearKeys();
    process.env.RESEARCH_MODEL_PROVIDER = "deepseek";
    process.env.REVIEW_MODEL_PROVIDER = "openai_compatible";
    process.env.DEEPSEEK_API_KEY = "sk-deepseek";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    process.env.OPENAI_COMPAT_API_KEY = "sk-openai";
    process.env.OPENAI_COMPAT_REVIEW_MODEL = "gpt-4.1-mini";
    process.env.OPENAI_COMPAT_BASE_URL = "https://api.openai.com/v1";
    const reviewer = resolveModelProvider("reviewer");
    expect(reviewer.provider).toBe("openai_compatible");
    expect(reviewer.model).toBe("gpt-4.1-mini");
    expect(reviewer.apiKey).toBe("sk-openai");
  });

  it("rejects unknown providers", () => {
    clearKeys();
    process.env.RESEARCH_MODEL_PROVIDER = "anthropic";
    process.env.DEEPSEEK_API_KEY = "sk";
    expect(() => resolveModelProvider("producer")).toThrow(/不支持的/);
  });

  it("accepts OPENROUTER_API_KEY as openai_compatible fallback", () => {
    clearKeys();
    process.env.REVIEW_MODEL_PROVIDER = "openai_compatible";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENAI_COMPAT_REVIEW_MODEL = "anthropic/claude-3.5-sonnet";
    const reviewer = resolveModelProvider("reviewer");
    expect(reviewer.provider).toBe("openai_compatible");
    expect(reviewer.baseURL).toContain("openrouter");
    expect(reviewer.displayName).toBe("OpenRouter");
  });

  it("lists configured providers without leaking keys", () => {
    clearKeys();
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.OPENAI_COMPAT_API_KEY = "sk-b";
    expect(listConfiguredProviders().sort()).toEqual(["deepseek", "openai_compatible"]);
  });
});
