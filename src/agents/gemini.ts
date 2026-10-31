import "server-only";
import { GoogleGenAI } from "@google/genai";

export const DEFAULT_MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 25_000;

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: "NO_API_KEY" | "TIMEOUT" | "RATE_LIMIT" | "MODEL_ERROR" | "INVALID_OUTPUT",
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export function geminiConfig() {
  const key = process.env.GEMINI_API_KEY?.trim();
  return { configured: Boolean(key), key, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
}

let client: GoogleGenAI | null = null;

/** One structured-JSON Gemini call with a hard timeout. Server-side only. */
export async function generateJson(system: string, prompt: string, schema: unknown): Promise<string | undefined> {
  const { key, model } = geminiConfig();
  if (!key) throw new AgentError("GEMINI_API_KEY is not set on the server.", "NO_API_KEY");
  client ??= new GoogleGenAI({ apiKey: key });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        temperature: 0.4,
        abortSignal: controller.signal,
      },
    });
    return res.text;
  } catch (err) {
    if (controller.signal.aborted) throw new AgentError(`Gemini did not answer within ${TIMEOUT_MS / 1000}s.`, "TIMEOUT");
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|quota|rate/i.test(msg)) throw new AgentError("Gemini quota or rate limit reached. Try again shortly.", "RATE_LIMIT");
    if (/API key|401|403|PERMISSION/i.test(msg)) throw new AgentError("Gemini rejected the API key or model access.", "MODEL_ERROR");
    if (/404|not found/i.test(msg)) throw new AgentError(`Model "${model}" is not available to this key. Set GEMINI_MODEL.`, "MODEL_ERROR");
    throw new AgentError(`Gemini request failed: ${msg.slice(0, 200)}`, "MODEL_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
