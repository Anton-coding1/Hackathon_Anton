import "server-only";
import type { Building, Repair, Scenario, TestResult } from "@/contracts/types";
import { AgentError, generateJson } from "./gemini";
import { DEFENDER_SYSTEM, defenderPrompt, REPAIR_SCHEMA } from "./prompts";
import { parseJson, validateRepairShape } from "./validation";

export type RepairProposal = { repair: Repair; reasoning: string; attempts: number };
export type AuditFeedback = { repair: unknown; reasons: string[] };

/**
 * Asks Gemini for one repair. It sees the measured failure and, on later
 * attempts, the auditor's rejection reasons. Gemini never judges its own repair:
 * the caller must run auditRepair() on the result.
 */
export async function suggestRepair(
  building: Building,
  scenario: Scenario,
  result: TestResult,
  budget: number,
  feedback: AuditFeedback[] = [],
): Promise<RepairProposal> {
  const base = defenderPrompt(building, scenario, result, budget, feedback);
  let prompt = base;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await generateJson(DEFENDER_SYSTEM, prompt, REPAIR_SCHEMA);
    const parsed = parseJson(text);
    const checked = parsed.ok ? validateRepairShape(parsed.value, building, scenario, budget) : parsed;
    if (checked.ok) {
      const r = parsed.ok ? (parsed.value as { reasoning?: unknown }).reasoning : undefined;
      return { repair: checked.value, reasoning: typeof r === "string" ? r.slice(0, 400) : "", attempts: attempt };
    }
    lastError = checked.error;
    prompt = `${base}\n\nYour previous answer was invalid: ${lastError} Fix it and answer again.`;
  }
  throw new AgentError(`Gemini's repair was invalid twice: ${lastError}`, "INVALID_OUTPUT");
}
