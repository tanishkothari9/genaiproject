/**
 * gemini.ts — Gemini adapter and embeddings.
 *
 * Provides the geminiAdapter (satisfies LLMAdapter in llm.ts via structural
 * typing) and the embed() function, which is strictly Gemini-only.
 *
 * Application code should import generateText / generateJSON / embed from
 * @/lib/llm, not directly from here.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ZodType } from "zod";

// Default to gemini-2.5-flash for quality; override with GEMINI_MODEL (e.g.
// gemini-2.5-flash-lite) when running on a free-tier key with a low daily quota.
const GENERATION_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Copy .env.example to .env.local and add your key."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

const MAX_RETRIES = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Pull the server-suggested retry delay (seconds) out of a 429 error message. */
function retryDelayMs(message: string, attempt: number): number {
  const match = /retry in (\d+(?:\.\d+)?)s/i.exec(message);
  const suggested = match ? Number(match[1]) * 1000 : 0;
  const backoff = 2 ** attempt * 1000; // 2s, 4s, 8s, …
  return Math.min(Math.max(suggested, backoff), 40_000);
}

/**
 * Run a Gemini call, retrying on transient rate-limit (429) errors using the
 * server-suggested delay.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // Retry transient failures: 429 (rate limit) and 503 (model overloaded).
      const retryable =
        message.includes("429") ||
        message.includes("503") ||
        /quota|rate limit|overloaded|high demand|unavailable/i.test(message);
      if (!retryable || attempt === MAX_RETRIES) throw err;
      await sleep(retryDelayMs(message, attempt));
    }
  }
  throw lastError;
}

/** Strip ```json fences and surrounding noise the model sometimes adds. */
function stripFences(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return text.trim();
}

/**
 * Gemini adapter — satisfies the LLMAdapter interface in llm.ts via structural
 * typing. Not intended for direct use by application code; use @/lib/llm instead.
 */
export const geminiAdapter = {
  name: "gemini" as const,

  async generateText(prompt: string): Promise<string> {
    const model = getClient().getGenerativeModel({ model: GENERATION_MODEL });
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text();
  },

  async generateJSON<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const model = getClient().getGenerativeModel({
      model: GENERATION_MODEL,
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    });

    const result = await withRetry(() => model.generateContent(prompt));
    const raw = stripFences(result.response.text());

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 300)}…`);
    }

    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `Gemini JSON failed schema validation: ${validation.error.message}`
      );
    }
    return validation.data;
  },
};

/**
 * Embed an array of texts into vectors (gemini-embedding-001).
 * Returns one number[] per input, in order.
 * Embeddings remain strictly on Gemini and are not part of the fallback chain.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = getClient().getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await withRetry(() =>
    model.batchEmbedContents({
      requests: texts.map((text) => ({
        content: { role: "user", parts: [{ text }] },
      })),
    })
  );

  return result.embeddings.map((e) => e.values);
}
