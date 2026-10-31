import type { Building, Repair, Scenario, TestResult } from "@/contracts/types";
import { buildingIssues } from "@/engine";

export const MAX_ATTACK_SIZE = 2;

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNonNeg = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Parses model text as JSON, tolerating a ```json fence. */
export function parseJson(text: string | undefined): Check<unknown> {
  if (!text || !text.trim()) return { ok: false, error: "The model returned an empty response." };
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    return { ok: false, error: "The response was not valid JSON." };
  }
}

/** Validates a model-proposed attack against the real building. */
export function validateAttack(raw: unknown, building: Building, prior: Scenario[], maxSize = MAX_ATTACK_SIZE): Check<Scenario> {
  if (!isObj(raw)) return { ok: false, error: "Expected a JSON object." };
  const ids = raw.blockedConnectionIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) {
    return { ok: false, error: "blockedConnectionIds must be a non-empty array of connection ID strings." };
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length > maxSize) return { ok: false, error: `Block at most ${maxSize} connection(s) per attack.` };
  const known = new Set(building.connections.map((c) => c.id));
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, error: `Unknown connection ID(s): ${unknown.join(", ")}. Use only: ${[...known].join(", ")}.` };
  const sorted = [...unique].sort();
  const key = sorted.join("+");
  if (prior.some((p) => [...p.blockedConnectionIds].sort().join("+") === key)) {
    return { ok: false, error: `Blocking ${key} was already tested. Choose a different disruption.` };
  }
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : `Block ${sorted.join(" + ")}`;
  return { ok: true, value: { id: `AI_ATTACK_${sorted.join("_")}`, name, blockedConnectionIds: sorted } };
}

/** Validates a model-proposed repair's shape, IDs, numbers and budget. The auditor checks whether it works. */
export function validateRepairShape(raw: unknown, building: Building, scenario: Scenario, budget: number): Check<Repair> {
  if (!isObj(raw)) return { ok: false, error: "Expected a JSON object." };
  const kind = raw.kind;
  if (!isFiniteNonNeg(raw.cost)) return { ok: false, error: "cost must be a finite, non-negative number." };
  const cost = Math.round(raw.cost);
  if (cost > budget) return { ok: false, error: `cost £${cost} exceeds the £${budget} budget.` };
  const nodeIds = new Set(building.nodes.map((n) => n.id));

  if (kind === "add_connection") {
    const c = raw.connection;
    if (!isObj(c)) return { ok: false, error: "add_connection needs a connection object." };
    const id = typeof c.id === "string" ? c.id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") : "";
    if (!id) return { ok: false, error: "connection.id must be a non-empty string." };
    if (building.connections.some((x) => x.id === id)) return { ok: false, error: `connection.id ${id} already exists; choose a new ID.` };
    for (const end of ["from", "to"] as const) {
      if (typeof c[end] !== "string" || !nodeIds.has(c[end] as string)) {
        return { ok: false, error: `connection.${end} must be an existing node ID: ${[...nodeIds].join(", ")}.` };
      }
    }
    if (c.from === c.to) return { ok: false, error: "connection must join two different nodes." };
    if (!isFiniteNonNeg(c.length) || c.length === 0) return { ok: false, error: "connection.length must be a positive finite number." };
    if (typeof c.stepFree !== "boolean") return { ok: false, error: "connection.stepFree must be true or false." };
    const from = building.nodes.find((n) => n.id === c.from)!;
    const to = building.nodes.find((n) => n.id === c.to)!;
    const floor = Math.min(from.floor, to.floor);
    const kinds = ["corridor", "door", "stairs", "lift", "ramp"] as const;
    const ck = kinds.includes(c.kind as (typeof kinds)[number]) ? (c.kind as (typeof kinds)[number]) : c.stepFree ? "corridor" : "stairs";
    return {
      ok: true,
      value: {
        kind: "add_connection",
        connection: {
          id, from: from.id, to: to.id, length: c.length, stepFree: ck === "stairs" ? false : c.stepFree, floor, costToAdd: cost, kind: ck,
          ...(ck === "lift" ? { evacuationLift: c.evacuationLift === true } : {}),
        },
        cost,
      },
    };
  }
  if (kind === "unblock_connection") {
    const id = raw.connectionId;
    if (typeof id !== "string" || !building.connections.some((c) => c.id === id)) {
      return { ok: false, error: "connectionId must be an existing connection ID." };
    }
    if (!scenario.blockedConnectionIds.includes(id)) return { ok: false, error: `${id} is not blocked in this scenario.` };
    return { ok: true, value: { kind: "unblock_connection", connectionId: id, cost } };
  }
  return { ok: false, error: 'kind must be "add_connection" or "unblock_connection".' };
}

/* ---------- request-body validation for the API route (do not trust the browser) ---------- */

export function checkBuilding(v: unknown): Check<Building> {
  if (!isObj(v)) return { ok: false, error: "building must be an object." };
  const issues = buildingIssues(v as Building);
  if (issues.length) return { ok: false, error: `Invalid building: ${issues.slice(0, 3).join(" ")}` };
  if ((v as Building).nodes.length > 200 || (v as Building).connections.length > 500) return { ok: false, error: "Building is too large." };
  return { ok: true, value: v as Building };
}

export function checkScenario(v: unknown, building: Building): Check<Scenario> {
  if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.blockedConnectionIds)) {
    return { ok: false, error: "scenario must have id and blockedConnectionIds." };
  }
  const known = new Set(building.connections.map((c) => c.id));
  const bad = (v.blockedConnectionIds as unknown[]).filter((x) => typeof x !== "string" || !known.has(x));
  if (bad.length) return { ok: false, error: "scenario blocks unknown connections." };
  return { ok: true, value: { id: v.id, name: typeof v.name === "string" ? v.name : v.id, blockedConnectionIds: v.blockedConnectionIds as string[] } };
}

export function checkResult(v: unknown): Check<TestResult> {
  if (!isObj(v) || !Array.isArray(v.unreachableOccupantIds) || !isObj(v.paths)) {
    return { ok: false, error: "result must be a TestResult." };
  }
  return { ok: true, value: v as unknown as TestResult };
}
