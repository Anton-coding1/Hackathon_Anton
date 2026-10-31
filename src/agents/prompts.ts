import type { Building, Scenario, TestResult } from "@/contracts/types";

export const PROMPT_VERSION = "exitzero-v1";

export const ATTACKER_SYSTEM = `You are an adversarial building-layout testing agent for ExitZero, a connectivity lab.
Goal: choose ONE new disruption (block 1 connection, or 2 only if no single block is left untested) most likely to leave an occupant with no valid route to an eligible exit.
Think about bridges in the graph, links that are the only step-free path for step-free occupants, and evidence from previous tests.
Rules: reference only the provided connection IDs; do not repeat a tested scenario; do not invent simulation results — a deterministic engine will evaluate your proposal.
Return JSON matching the schema. "reasoning" is one or two short sentences.`;

export const DEFENDER_SYSTEM = `You are a constrained design-repair agent for ExitZero, a connectivity lab.
You receive a building graph, a disruption, and measured failure results from a deterministic engine. Propose ONE modification that may restore an eligible route for every stranded occupant, within the budget.
Allowed: "add_connection" between two EXISTING nodes (new unique ID, length at least the straight-line distance between node positions; set connection.kind to corridor, door, stairs, lift or ramp; a step-free link between floors must be a lift or ramp), or "unblock_connection" for a connection blocked in this scenario (for a recalled lift this means upgrading it with secondary power and evacuation controls).
Lifts that are not evacuation lifts are recalled in a fire alarm; an evacuation lift (kind lift, evacuationLift true) keeps working.
Costs are re-priced by an independent cost model, so propose realistic UK costs.
Prefer add_connection that creates redundancy. Reopening a blocked door only removes this one obstruction and is rejected when the goal is to survive that failure; reopening a recalled lift (secondary power) is a real upgrade.
Remember: step-free occupants can only use stepFree connections and exits marked stepFreeExit.
Never claim success: an independent auditor will verify. If previous proposals were rejected, read the auditor's reasons and change your approach.
Return JSON matching the schema. "reasoning" is one or two short sentences.`;

/** Compact, model-friendly description of the graph. */
export function describeBuilding(b: Building): string {
  const nodes = b.nodes
    .map((n) => `${n.id} [${n.kind}${n.kind === "exit" ? (n.stepFreeExit ? ", step-free exit" : ", NOT step-free") : ""}] "${n.label}" floor ${n.floor} at (${n.position.join(", ")})`)
    .join("\n");
  const conns = b.connections
    .map((c) => `${c.id}: ${c.from} <-> ${c.to}, length ${c.length} m, ${c.kind === "lift" ? (c.evacuationLift ? "EVACUATION lift (works in fire alarm)" : "lift (recalled in fire alarm)") : c.stepFree ? "step-free" : "stairs (not step-free)"}`)
    .join("\n");
  const occ = b.occupants
    .map((o) => `${o.id} "${o.label}" starts at ${o.startNodeId}${o.requiresStepFree ? ", REQUIRES step-free route and step-free exit" : ""}`)
    .join("\n");
  return `BUILDING ${b.name}\nNODES\n${nodes}\nCONNECTIONS (undirected)\n${conns}\nOCCUPANTS\n${occ}`;
}

export function describeResult(r: TestResult): string {
  return `Unreachable: ${r.unreachableOccupantIds.join(", ") || "none"} (${r.reachableCount}/${r.totalCount} reachable)\n${r.explanations.join("\n")}`;
}

export function attackerPrompt(b: Building, prior: { scenario: Scenario; result: TestResult }[]): string {
  const history = prior.length
    ? prior
        .map((p, i) => `#${i + 1} blocked [${p.scenario.blockedConnectionIds.join(", ")}] → unreachable: ${p.result.unreachableOccupantIds.join(", ") || "none"}`)
        .join("\n")
    : "No tests run yet.";
  return `${describeBuilding(b)}\n\nPREVIOUS TESTS (measured by the engine)\n${history}\n\nPropose the next disruption.`;
}

export function defenderPrompt(
  b: Building,
  s: Scenario,
  r: TestResult,
  budget: number,
  feedback: { repair: unknown; reasons: string[] }[],
  constraints?: { allowed?: string[]; rates?: Record<string, number> },
): string {
  const fb = feedback.length
    ? `\n\nPREVIOUS PROPOSALS REJECTED BY THE AUDITOR\n${feedback
        .map((f, i) => `Attempt ${i + 1}: ${JSON.stringify(f.repair)}\nAuditor: ${f.reasons.join(" ")}`)
        .join("\n")}`
    : "";
  const allowed = constraints?.allowed?.length ? `\nDESIGN CONSTRAINTS: allowed repair types: ${constraints.allowed.join(", ")}. Do not propose anything else.` : "";
  const rates = constraints?.rates ? `\nCOST MODEL (GBP): ${Object.entries(constraints.rates).map(([k, v]) => `${k} ${v}`).join("; ")}.` : "";
  return `${describeBuilding(b)}\n\nDISRUPTION ${s.id}: blocked [${s.blockedConnectionIds.join(", ")}]\nMEASURED RESULT\n${describeResult(r)}\n\nBUDGET £${budget}.${rates}${allowed}${fb}\n\nPropose one repair.`;
}

export const ATTACK_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short human-readable scenario name" },
    blockedConnectionIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
    reasoning: { type: "string" },
  },
  required: ["name", "blockedConnectionIds", "reasoning"],
} as const;

export const REPAIR_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["add_connection", "unblock_connection"] },
    connection: {
      type: "object",
      properties: {
        id: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        length: { type: "number" },
        stepFree: { type: "boolean" },
        floor: { type: "integer" },
        kind: { type: "string", enum: ["corridor", "door", "stairs", "lift", "ramp"] },
        evacuationLift: { type: "boolean" },
      },
      required: ["id", "from", "to", "length", "stepFree", "floor", "kind"],
    },
    connectionId: { type: "string" },
    cost: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["kind", "cost", "reasoning"],
} as const;
