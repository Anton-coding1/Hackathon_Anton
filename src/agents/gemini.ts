import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/** Lead brain: attacker, defender and floor-plan reading. */
export const DEFAULT_MODEL = "gemini-4-argon";
/** Fast subagent for high-frequency follow-up fixes and cost grounding. */
export const DEFAULT_FAST_MODEL = "gemini-3.8-flash";
export type Tier = "lead" | "fast";

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
  return {
    configured: Boolean(key),
    key,
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    fastModel: process.env.GEMINI_FAST_MODEL?.trim() || DEFAULT_FAST_MODEL,
  };
}

let client: GoogleGenAI | null = null;

/**
 * One structured-JSON Gemini call with a hard timeout. Server-side only.
 * "lead" uses Gemini 4 Argon with medium thinking; "fast" uses a Flash subagent.
 * No temperature/top_p: Argon ignores custom sampling and controls depth via thinking level.
 */
export async function generateJson(system: string, prompt: string, schema: unknown, tier: Tier = "lead"): Promise<string | undefined> {
  const cfg = geminiConfig();
  const { key } = cfg;
  const model = tier === "fast" ? cfg.fastModel : cfg.model;
  if (!key) throw new AgentError("GEMINI_API_KEY is not set on the server.", "NO_API_KEY");
  client ??= new GoogleGenAI({ apiKey: key });
  const TIMEOUT_MS = tier === "fast" ? 25_000 : 55_000;

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
        thinkingConfig: { thinkingLevel: tier === "fast" ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM },
        abortSignal: controller.signal,
      },
    });
    return res.text;
  } catch (err) {
    if (controller.signal.aborted) throw new AgentError(`${model} did not answer within ${TIMEOUT_MS / 1000}s.`, "TIMEOUT");
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|quota|rate/i.test(msg)) throw new AgentError("Gemini quota or rate limit reached. Try again shortly.", "RATE_LIMIT");
    if (/API key|401|403|PERMISSION/i.test(msg)) throw new AgentError("Gemini rejected the API key or model access.", "MODEL_ERROR");
    if (/404|not found/i.test(msg)) throw new AgentError(`Model "${model}" is not available to this key. Set ${tier === "fast" ? "GEMINI_FAST_MODEL" : "GEMINI_MODEL"}.`, "MODEL_ERROR");
    throw new AgentError(`Gemini request failed: ${msg.slice(0, 200)}`, "MODEL_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
