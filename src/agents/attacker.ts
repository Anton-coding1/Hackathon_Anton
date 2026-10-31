import "server-only";
import type { Building, Scenario, TestResult } from "@/contracts/types";
import { AgentError, generateJson, type Tier } from "./gemini";
import { ATTACK_SCHEMA, ATTACKER_SYSTEM, attackerPrompt } from "./prompts";
import { parseJson, validateAttack } from "./validation";

export type AttackProposal = { scenario: Scenario; reasoning: string; attempts: number };

/**
 * Asks Gemini for a NEW disruption to test. Output is validated against the real
 * building; one retry with the validation error, then a controlled failure.
 */
export async function suggestAttack(building: Building, prior: { scenario: Scenario; result: TestResult }[], maxBlocked = 2, tier: Tier = "lead"): Promise<AttackProposal> {
  const base = `${attackerPrompt(building, prior)}\nBlock at most ${maxBlocked} connection(s).`;
  let prompt = base;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await generateJson(ATTACKER_SYSTEM, prompt, ATTACK_SCHEMA, tier);
    const parsed = parseJson(text);
    const checked = parsed.ok ? validateAttack(parsed.value, building, prior.map((p) => p.scenario), maxBlocked) : parsed;
    if (checked.ok) {
      const reasoning = parsed.ok && typeof (parsed.value as { reasoning?: unknown }).reasoning === "string" ? (parsed.value as { reasoning: string }).reasoning : "";
      return { scenario: checked.value, reasoning: reasoning.slice(0, 400), attempts: attempt };
    }
    lastError = checked.error;
    prompt = `${base}\n\nYour previous answer was invalid: ${lastError} Fix it and answer again.`;
  }
  throw new AgentError(`Gemini's attack was invalid twice: ${lastError}`, "INVALID_OUTPUT");
}
