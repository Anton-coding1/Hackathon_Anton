import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { AgentError, geminiConfig, suggestAttack, suggestRepair } from "@/agents";
import { checkBuilding, checkResult, checkScenario } from "@/agents/validation";
import { simulate } from "@/engine";
import type { Scenario, TestResult } from "@/contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ok = { success: true; data: unknown; source: "gemini" };
type Err = { success: false; error: string; code?: string };

const fail = (error: string, status = 400, code?: string) => NextResponse.json<Err>({ success: false, error, code }, { status });

type Health = "ok" | "no-key" | "invalid-key" | "model-unavailable" | "unreachable";
let health: { at: number; key: string; model: string; status: Health; detail?: string } | null = null;

/** Real check that the key works and the lead model is enabled for it (cached for 5 minutes). */
async function checkGemini(key: string, model: string): Promise<{ status: Health; detail?: string }> {
  if (health && health.key === key && health.model === model && Date.now() - health.at < 5 * 60_000) return health;
  let status: Health = "ok";
  let detail: string | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await Promise.race([ai.models.get({ model }), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    detail = msg.slice(0, 160);
    status = /timeout|fetch failed|ENOTFOUND|ECONN/i.test(msg) ? "unreachable" : /404|not found/i.test(msg) ? "model-unavailable" : /API key|401|403|PERMISSION|invalid/i.test(msg) ? "invalid-key" : "unreachable";
  }
  health = { at: Date.now(), key, model, status, detail };
  return { status, detail };
}

export async function GET(req: Request) {
  const { configured, model, fastModel, key } = geminiConfig();
  const wantCheck = new URL(req.url).searchParams.get("check") === "1";
  const h = !configured || !key ? { status: "no-key" as Health } : wantCheck ? await checkGemini(key, model) : { status: "ok" as Health };
  return NextResponse.json({ success: true, data: { configured: configured && h.status === "ok", model, fastModel, status: h.status, detail: h.detail } });
}

/**
 * POST { action: "attack", building, prior }
 * POST { action: "defend", building, scenario, result, budget, feedback? }
 * Results that the dashboard shows as facts are recomputed by the engine, never taken from the model.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be JSON.");
  }
  if (JSON.stringify(body).length > 200_000) return fail("Request too large.", 413);

  const b = checkBuilding(body.building);
  if (!b.ok) return fail(b.error);
  const building = b.value;

  try {
    if (body.action === "attack") {
      const priorRaw = Array.isArray(body.prior) ? body.prior.slice(-20) : [];
      // Recompute prior results with the engine rather than trusting the browser.
      const prior: { scenario: Scenario; result: TestResult }[] = [];
      for (const p of priorRaw) {
        const s = checkScenario((p as { scenario?: unknown })?.scenario, building);
        if (s.ok) prior.push({ scenario: s.value, result: simulate(building, s.value) });
      }
      const maxBlocked = body.maxBlocked === 1 ? 1 : 2;
      const tier = body.tier === "fast" ? "fast" : "lead";
      const proposal = await suggestAttack(building, prior, maxBlocked, tier);
      return NextResponse.json<Ok>({ success: true, data: { ...proposal, model: tier === "fast" ? geminiConfig().fastModel : geminiConfig().model }, source: "gemini" });
    }

    if (body.action === "defend") {
      const s = checkScenario(body.scenario, building);
      if (!s.ok) return fail(s.error);
      if (!checkResult(body.result).ok) return fail("result must be a TestResult.");
      const budget = Number(body.budget);
      if (!Number.isFinite(budget) || budget < 0 || budget > 10_000_000) return fail("budget must be a sensible non-negative number.");
      const result = simulate(building, s.value); // measured, not client-supplied
      const feedback = Array.isArray(body.feedback)
        ? body.feedback.slice(-3).map((f) => ({
            repair: (f as { repair?: unknown })?.repair ?? null,
            reasons: Array.isArray((f as { reasons?: unknown })?.reasons) ? ((f as { reasons: unknown[] }).reasons.filter((x) => typeof x === "string").slice(0, 6) as string[]) : [],
          }))
        : [];
      const rawC = (body.constraints ?? {}) as { allowed?: unknown; rates?: unknown };
      const constraints = {
        allowed: Array.isArray(rawC.allowed) ? rawC.allowed.filter((x): x is string => typeof x === "string").slice(0, 6) : undefined,
        rates:
          rawC.rates && typeof rawC.rates === "object"
            ? Object.fromEntries(Object.entries(rawC.rates as Record<string, unknown>).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).slice(0, 12)) as Record<string, number>
            : undefined,
      };
      const tier = body.tier === "fast" ? "fast" : "lead";
      const proposal = await suggestRepair(building, s.value, result, budget, feedback, constraints, tier);
      return NextResponse.json<Ok>({ success: true, data: { ...proposal, model: tier === "fast" ? geminiConfig().fastModel : geminiConfig().model }, source: "gemini" });
    }

    return fail('action must be "attack" or "defend".');
  } catch (err) {
    if (err instanceof AgentError) {
      const status = err.code === "NO_API_KEY" ? 503 : err.code === "RATE_LIMIT" ? 429 : err.code === "TIMEOUT" ? 504 : 502;
      return fail(err.message, status, err.code);
    }
    console.error("agents route error", err);
    return fail("Internal error while running the agent.", 500, "INTERNAL_ERROR");
  }
}
