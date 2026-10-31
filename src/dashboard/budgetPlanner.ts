import type { Building, Repair, Scenario } from "@/contracts/types";
import { certify, occupantWeights, withConnections, type AttackFinding } from "@/engine";
import type { CostEstimate, CostRates } from "@/cost/costModel";
import { fallbackRepair, type RepairKind } from "./fallbackAgents";

export type PlannedFix = { scenario: Scenario; stranded: string[]; repair: Repair; estimate: CostEstimate; reasoning: string; peopleProtected: number };

export type BudgetPlan = {
  /** Fixes chosen for this budget, in the order they should be applied. */
  fixes: PlannedFix[];
  cost: number;
  /** True when, after these fixes, no tested blocked-path scenario traps anyone. */
  everyoneSafe: boolean;
  /** Cost of the cheapest plan found that makes everyone safe (Infinity if none was found). */
  fullCost: number;
  /** Failures still left after the budget runs out. */
  remaining: AttackFinding[];
  /** Weighted people still at risk / at risk before any fix (internal estimate). */
  riskBefore: number;
  riskAfter: number;
};

export function applyRepair(b: Building, r: Repair): Building {
  if (r.kind === "add_connection") return withConnections(b, [r.connection]);
  if (r.kind === "add_connections") return withConnections(b, r.connections);
  if (r.kind === "upgrade_lift") return { ...b, connections: b.connections.map((c) => (r.connectionIds.includes(c.id) ? { ...c, evacuationLift: true } : { ...c })) };
  return b;
}

const recalledLifts = (b: Building) => b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);

/** Weighted number of people trapped, summed over every failing scenario. */
function risk(b: Building, tolerance: number, liftsRecalled: boolean): { value: number; failures: AttackFinding[] } {
  const cert = certify(b, tolerance, liftsRecalled ? recalledLifts(b) : [], { skipEvacuationLifts: true });
  const w = occupantWeights(b);
  const value = cert.failures.reduce((s, f) => s + f.result.unreachableOccupantIds.reduce((t, id) => t + (w[id] ?? 1), 0), 0);
  return { value, failures: cert.failures };
}

/**
 * Best next fix: among the cheapest fixes for the worst current failures, the one
 * that removes the most risk per pound and fits in what is left of the budget.
 */
export function bestNextFix(b: Building, tolerance: number, liftsRecalled: boolean, budgetLeft: number, rates: CostRates, allow: Record<RepairKind, boolean>): PlannedFix | null {
  const before = risk(b, tolerance, liftsRecalled);
  if (before.failures.length === 0) return null;
  const w = occupantWeights(b);
  const people = (ids: string[]) => ids.reduce((s, id) => s + (w[id] ?? 1), 0);
  const seen = new Set<string>();
  const targets = [...before.failures]
    .sort((x, y) => x.scenario.blockedConnectionIds.length - y.scenario.blockedConnectionIds.length || people(y.result.unreachableOccupantIds) - people(x.result.unreachableOccupantIds))
    .filter((f) => {
      const k = f.result.unreachableOccupantIds.join(",") + "|" + f.scenario.blockedConnectionIds.length;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 24);
  let best: (PlannedFix & { score: number }) | null = null;
  const tried = new Set<string>();
  for (const [k, f] of targets.entries()) {
    // Look at the worst six failures first; only dig further if none of their fixes is affordable.
    if (k >= 6 && best) break;
    const fix = fallbackRepair(b, f.scenario, [], budgetLeft, rates, allow);
    if (!fix || fix.repair.cost > budgetLeft) continue;
    const key = JSON.stringify(fix.repair);
    if (tried.has(key)) continue;
    tried.add(key);
    const after = risk(applyRepair(b, fix.repair), tolerance, liftsRecalled);
    const gain = before.value - after.value;
    if (gain <= 0) continue;
    const score = gain / Math.max(fix.repair.cost, 1);
    if (!best || score > best.score) {
      best = { scenario: f.scenario, stranded: f.result.unreachableOccupantIds, repair: fix.repair, estimate: fix.estimate, reasoning: fix.reasoning, peopleProtected: gain, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...rest } = best;
  void _score;
  return rest;
}

/** Greedy best-value plan within the budget, plus what full protection would cost. */
export function planForBudget(b0: Building, tolerance: number, liftsRecalled: boolean, budget: number, rates: CostRates, allow: Record<RepairKind, boolean>): BudgetPlan {
  const run = (limit: number) => {
    let b = b0;
    let spent = 0;
    const fixes: PlannedFix[] = [];
    for (let i = 0; i < 40; i++) {
      const next = bestNextFix(b, tolerance, liftsRecalled, limit - spent, rates, allow);
      if (!next) break;
      fixes.push(next);
      spent += next.repair.cost;
      b = applyRepair(b, next.repair);
    }
    const r = risk(b, tolerance, liftsRecalled);
    return { fixes, spent, r };
  };
  const start = risk(b0, tolerance, liftsRecalled);
  const within = run(budget);
  const everyoneSafe = within.r.failures.length === 0;
  const full = everyoneSafe ? within : run(1e12);
  return {
    fixes: within.fixes,
    cost: within.spent,
    everyoneSafe,
    fullCost: full.r.failures.length === 0 ? full.spent : Number.POSITIVE_INFINITY,
    remaining: within.r.failures,
    riskBefore: start.value,
    riskAfter: within.r.value,
  };
}

/** Cost of the cheapest plan found that makes everyone safe from here (Infinity if none). */
export function costToMakeSafe(b0: Building, tolerance: number, liftsRecalled: boolean, rates: CostRates, allow: Record<RepairKind, boolean>): number {
  let b = b0;
  let spent = 0;
  for (let i = 0; i < 40; i++) {
    const next = bestNextFix(b, tolerance, liftsRecalled, 1e12, rates, allow);
    if (!next) break;
    spent += next.repair.cost;
    b = applyRepair(b, next.repair);
  }
  return risk(b, tolerance, liftsRecalled).failures.length === 0 ? spent : Number.POSITIVE_INFINITY;
}
