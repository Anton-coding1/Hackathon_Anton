import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { geminiConfig } from "@/agents";
import { DEFAULT_RATES, RATE_LABELS, sanitiseRates, type CostRates, type RateKey } from "@/cost/costModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; rates: CostRates } | null = null;
const TTL = 60 * 60 * 1000;

/**
 * GET /api/cost → current UK construction unit rates.
 * Uses Gemini with Google Search grounding so prices come from live web sources
 * (cited). Falls back to labelled built-in rates if Gemini is unavailable.
 */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (cache && !refresh && Date.now() - cache.at < TTL) return NextResponse.json({ success: true, data: cache.rates });
  const { key, fastModel: model } = geminiConfig();
  if (!key) return NextResponse.json({ success: true, data: DEFAULT_RATES, note: "GEMINI_API_KEY not set; using built-in indicative rates." });

  const keys = Object.keys(RATE_LABELS) as RateKey[];
  const prompt = `Find current (${new Date().toISOString().slice(0, 7)}) typical UK construction costs in GBP, excluding VAT, for retrofit work in an existing commercial building. Use recent UK sources (cost guides, quantity surveyor publications, supplier price lists).
Return ONLY a JSON object with these numeric keys (midpoint estimates, whole pounds):
${keys.map((k) => `- ${k}: ${RATE_LABELS[k]}`).join("\n")}
Also include "notes": one sentence on assumptions.`;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], abortSignal: controller.signal },
    });
    clearTimeout(t);
    const text = res.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in response");
    const parsed = JSON.parse(match[0]);
    const { rates, replaced } = sanitiseRates(parsed);
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
      .filter((s) => s.url)
      .slice(0, 8);
    const data: CostRates = {
      currency: "GBP",
      source: "gemini-search",
      model,
      asOf: new Date().toISOString().slice(0, 10),
      rates,
      sources,
      notes: [typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "", replaced.length ? `Out-of-range values replaced with defaults: ${replaced.join(", ")}.` : ""]
        .filter(Boolean)
        .join(" "),
    };
    cache = { at: Date.now(), rates: data };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: true, data: DEFAULT_RATES, note: `Live pricing failed (${msg.slice(0, 120)}); using built-in indicative rates.` });
  }
}
