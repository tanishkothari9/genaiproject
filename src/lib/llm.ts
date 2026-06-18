/**
 * llm.ts — Provider-agnostic LLM interface with automatic fallback.
 *
 * Exposes the same generateText / generateJSON / embed signatures app-wide.
 * Generation falls back through: Gemini → Anthropic Claude → Groq (default).
 * Embeddings are strictly Gemini-only (gemini-embedding-001).
 *
 * Override fallback order with LLM_PROVIDER_ORDER=gemini,claude,groq in .env.local.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ZodType } from "zod";
import { geminiAdapter } from "@/lib/gemini";

/** Contract every provider adapter must satisfy. */
export interface LLMAdapter {
  readonly name: string;
  generateText(prompt: string): Promise<string>;
  generateJSON<T>(prompt: string, schema: ZodType<T>): Promise<T>;
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        message.includes("429") ||
        message.includes("529") ||
        message.includes("503") ||
        /rate.?limit|overload|quota/i.test(message);
      if (!retryable || attempt === MAX_RETRIES) throw err;
      await sleep(Math.min(2 ** attempt * 1_000, 30_000));
    }
  }
  throw lastError;
}

function stripFences(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return text.trim();
}

// ─── Anthropic Claude adapter ─────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-3-5-haiku-latest";

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey });
}

const claudeAdapter: LLMAdapter = {
  name: "claude",

  async generateText(prompt: string): Promise<string> {
    const client = getAnthropicClient();
    const msg = await withRetry(() =>
      client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      })
    );
    const block = msg.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Claude returned no text content.");
    }
    return block.text;
  },

  async generateJSON<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const client = getAnthropicClient();
    const msg = await withRetry(() =>
      client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nRespond with valid JSON only. Do not include markdown fences or any explanation.`,
          },
        ],
      })
    );
    const block = msg.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Claude returned no text content.");
    }
    const raw = stripFences(block.text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 300)}…`);
    }

    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`Claude JSON failed schema validation: ${validation.error.message}`);
    }
    return validation.data;
  },
};

// ─── Groq adapter (OpenAI-compatible) ────────────────────────────────────────

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function getGroqClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set.");
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
}

const groqAdapter: LLMAdapter = {
  name: "groq",

  async generateText(prompt: string): Promise<string> {
    const client = getGroqClient();
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
      })
    );
    const content = completion.choices[0]?.message.content;
    if (content === null || content === undefined) {
      throw new Error("Groq returned empty response.");
    }
    return content;
  },

  async generateJSON<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const client = getGroqClient();
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      })
    );
    const raw = completion.choices[0]?.message.content ?? "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Groq returned invalid JSON: ${raw.slice(0, 300)}…`);
    }

    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`Groq JSON failed schema validation: ${validation.error.message}`);
    }
    return validation.data;
  },
};

// ─── Provider chain ───────────────────────────────────────────────────────────

const DEFAULT_PROVIDER_ORDER = "gemini,claude,groq";

const ADAPTER_REGISTRY: Record<string, LLMAdapter> = {
  gemini: geminiAdapter,
  claude: claudeAdapter,
  groq: groqAdapter,
};

function buildProviderChain(): LLMAdapter[] {
  const order = (process.env.LLM_PROVIDER_ORDER ?? DEFAULT_PROVIDER_ORDER)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return order.reduce<LLMAdapter[]>((acc, name) => {
    const adapter = ADAPTER_REGISTRY[name];
    if (adapter !== undefined) acc.push(adapter);
    return acc;
  }, []);
}

async function withFallback<T>(
  operation: (adapter: LLMAdapter) => Promise<T>
): Promise<T> {
  const chain = buildProviderChain();
  if (chain.length === 0) {
    throw new Error(
      "No LLM providers configured. Set LLM_PROVIDER_ORDER in .env.local."
    );
  }

  let lastError: unknown;
  for (const adapter of chain) {
    try {
      return await operation(adapter);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] "${adapter.name}" failed — trying next provider. Reason: ${message}`);
    }
  }
  throw lastError;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Generate freeform text. Falls back through the configured provider chain. */
export async function generateText(prompt: string): Promise<string> {
  return withFallback((adapter) => adapter.generateText(prompt));
}

/**
 * Generate JSON and validate it against a Zod schema.
 * Falls back through the configured provider chain.
 */
export async function generateJSON<T>(prompt: string, schema: ZodType<T>): Promise<T> {
  return withFallback((adapter) => adapter.generateJSON(prompt, schema));
}

/** Embed texts into vectors. Strictly Gemini-only — not part of the fallback chain. */
export { embed } from "@/lib/gemini";
