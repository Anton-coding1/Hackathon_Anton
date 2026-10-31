import type { Building, Repair, Scenario } from "@/contracts/types";
import { certify, occupantWeights, simulate, validateRepair, withConnections, type AttackFinding } from "@/engine";
import type { CostEstimate, CostRates } from "@/cost/costModel";
import { fallbackRepair, fixReason, repairCandidates, repairKind, type RepairKind } from "./fallbackAgents";

export type PlannedFix = {
  scenario: Scenario;
  stranded: string[];
  repair: Repair;
  estimate: CostEstimate;
  reasoning: string;
  peopleProtected: number;
  /** People this change gets out of the target scenario on its own. */
  rescued: string[];
  /** People in the target scenario who still need a further change (a combined fix). */
  stillTrapped: string[];
};

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

/** The scenario as it stands after the repair (an upgraded lift is no longer recalled). */
function repairedScenario(s: Scenario, r: Repair): Scenario {
  if (r.kind === "upgrade_lift") return { ...s, blockedConnectionIds: s.blockedConnectionIds.filter((id) => !r.connectionIds.includes(id)) };
  if (r.kind === "unblock_connection") return { ...s, blockedConnectionIds: s.blockedConnectionIds.filter((id) => id !== r.connectionId) };
  return s;
}

/** Who a repair gets out of one scenario, who is still trapped, and who it would newly trap. */
function effectOn(b: Building, s: Scenario, r: Repair) {
  const before = simulate(b, s).unreachableOccupantIds;
  const after = simulate(applyRepair(b, r), repairedScenario(s, r)).unreachableOccupantIds;
  return {
    before,
    rescued: before.filter((id) => !after.includes(id)),
    still: before.filter((id) => after.includes(id)),
    newly: after.filter((id) => !before.includes(id)),
  };
}

const recalledLifts = (b: Building) => b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);

/** Weighted number of people trapped, summed over every failing scenario. */
function risk(b: Building, tolerance: number, liftsRecalled: boolean): { value: number; failures: AttackFinding[] } {
  const cert = certify(b, tolerance, liftsRecalled ? recalledLifts(b) : [], { skipEvacuationLifts: true });
  const w = occupantWeights(b);
  const value = cert.failures.reduce((s, f) => s + f.result.unreachableOccupantIds.reduce((t, id) => t + (w[id] ?? 1), 0), 0);
  return { value, failures: cert.failures };
}

function orderedTargets(b: Building, failures: AttackFinding[]) {
  const w = occupantWeights(b);
  const people = (ids: string[]) => ids.reduce((s, id) => s + (w[id] ?? 1), 0);
  const seen = new Set<string>();
  return [...failures]
    .sort((x, y) => x.scenario.blockedConnectionIds.length - y.scenario.blockedConnectionIds.length || people(y.result.unreachableOccupantIds) - people(x.result.unreachableOccupantIds))
    .filter((f) => {
      const k = f.result.unreachableOccupantIds.join(",") + "|" + f.scenario.blockedConnectionIds.length;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * Best next fix: the change that removes the most risk per pound and fits what is left.
 * First it looks for single changes that fully solve one of the worst failures. If no single
 * change can (e.g. fire blocks the only step-free exit AND the lifts are recalled), it falls
 * back to partial changes that rescue some of the people, so combined fixes are still found.
 */
export function bestNextFix(b: Building, tolerance: number, liftsRecalled: boolean, budgetLeft: number, rates: CostRates, allow: Record<RepairKind, boolean>): PlannedFix | null {
  const before = risk(b, tolerance, liftsRecalled);
  if (before.failures.length === 0) return null;
  const targets = orderedTargets(b, before.failures).slice(0, 24);
  let best: (PlannedFix & { score: number }) | null = null;
  const tried = new Set<string>();
  const consider = (f: AttackFinding, repair: Repair, estimate: CostEstimate, reasoning: string) => {
    const key = JSON.stringify(repair);
    if (tried.has(key)) return;
    tried.add(key);
    const after = risk(applyRepair(b, repair), tolerance, liftsRecalled);
    const gain = before.value - after.value;
    if (gain <= 0) return;
    const score = gain / Math.max(repair.cost, 1);
    if (!best || score > best.score) {
      const e = effectOn(b, f.scenario, repair);
      best = { scenario: f.scenario, stranded: e.before, repair, estimate, reasoning, peopleProtected: gain, rescued: e.rescued, stillTrapped: e.still, score };
    }
  };

  // 1. Single changes that fully fix one of the worst failures.
  for (const [k, f] of targets.entries()) {
    if (k >= 6 && best) break;
    const fix = fallbackRepair(b, f.scenario, [], budgetLeft, rates, allow);
    if (!fix || fix.repair.cost > budgetLeft) continue;
    consider(f, fix.repair, fix.estimate, fix.reasoning);
  }

  // 2. No single change works: try partial changes that get some of the trapped people out.
  if (!best) {
    for (const f of targets.slice(0, 4)) {
      let evaluated = 0;
      for (const { repair, estimate } of repairCandidates(b, f.scenario, rates, allow)) {
        if (evaluated >= 10) break;
        if (repair.cost > budgetLeft) break;
        if (!allow[repairKind(repair)] || validateRepair(b, f.scenario, repair).length) continue;
        const e = effectOn(b, f.scenario, repair);
        if (e.rescued.length === 0 || e.newly.length) continue;
        evaluated++;
        consider(f, repair, estimate, fixReason(repair, "Part of the cheapest combined fix"));
      }
    }
  }

  if (!best) return null;
  const { score: _score, ...rest } = best as PlannedFix & { score: number };
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

export type MinimumPlan = { repairs: { repair: Repair; estimate: CostEstimate; reasoning: string }[]; cost: number; everyoneSafe: boolean; pruned: number };

/**
 * The minimum-cost set of changes the search can find that gets everyone out:
 * greedy best value until nobody is trapped, then drop any change that turns out
 * not to be needed (most expensive first).
 */
export function minimumPlan(b0: Building, tolerance: number, liftsRecalled: boolean, rates: CostRates, allow: Record<RepairKind, boolean>): MinimumPlan {
  let b = b0;
  const picked: MinimumPlan["repairs"] = [];
  for (let i = 0; i < 40; i++) {
    const next = bestNextFix(b, tolerance, liftsRecalled, 1e12, rates, allow);
    if (!next) break;
    picked.push({ repair: next.repair, estimate: next.estimate, reasoning: next.reasoning });
    b = applyRepair(b, next.repair);
  }
  const safe = (list: MinimumPlan["repairs"]) => risk(list.reduce((x, r) => applyRepair(x, r.repair), b0), tolerance, liftsRecalled).failures.length === 0;
  const everyoneSafe = safe(picked);
  let kept = picked;
  if (everyoneSafe) {
    for (const r of [...picked].sort((x, y) => y.repair.cost - x.repair.cost)) {
      const without = kept.filter((x) => x !== r);
      if (safe(without)) kept = without;
    }
  }
  return { repairs: kept, cost: kept.reduce((s, r) => s + r.repair.cost, 0), everyoneSafe, pruned: picked.length - kept.length };
}

/**
 * Which planned change to build next, and the blocked-path scenario that shows why it is needed.
 * `enabling` means it rescues nobody on its own yet but is needed together with a later change.
 */
export function nextFromPlan(b: Building, remaining: MinimumPlan["repairs"], tolerance: number, liftsRecalled: boolean): { index: number; fix: PlannedFix; enabling: boolean } | null {
  if (remaining.length === 0) return null;
  const before = risk(b, tolerance, liftsRecalled);
  if (before.failures.length === 0) return null;
  const w = occupantWeights(b);
  const people = (ids: string[]) => ids.reduce((s, id) => s + (w[id] ?? 1), 0);
  let best: { index: number; gain: number; cost: number } | null = null;
  remaining.forEach((r, index) => {
    const gain = before.value - risk(applyRepair(b, r.repair), tolerance, liftsRecalled).value;
    if (!best || gain > best.gain || (gain === best.gain && r.repair.cost < best.cost)) best = { index, gain, cost: r.repair.cost };
  });
  const { index, gain } = best!;
  const r = remaining[index];
  let target: { f: AttackFinding; e: ReturnType<typeof effectOn>; score: number } | null = null;
  for (const f of orderedTargets(b, before.failures)) {
    const e = effectOn(b, f.scenario, r.repair);
    if (e.rescued.length === 0 || e.newly.length) continue;
    const score = people(e.rescued) * 10 - e.still.length;
    if (!target || score > target.score) target = { f, e, score };
  }
  if (!target || gain <= 0) {
    const f = before.failures[0];
    const e = effectOn(b, f.scenario, r.repair);
    return { index, enabling: true, fix: { scenario: f.scenario, stranded: e.before, repair: r.repair, estimate: r.estimate, reasoning: r.reasoning, peopleProtected: 0, rescued: [], stillTrapped: e.before } };
  }
  return {
    index,
    enabling: false,
    fix: { scenario: target.f.scenario, stranded: target.e.before, repair: r.repair, estimate: r.estimate, reasoning: r.reasoning, peopleProtected: gain, rescued: target.e.rescued, stillTrapped: target.e.still },
  };
}

/** Cost of the cheapest plan found that makes everyone safe from here (Infinity if none). */
export function costToMakeSafe(b0: Building, tolerance: number, liftsRecalled: boolean, rates: CostRates, allow: Record<RepairKind, boolean>): number {
  const p = minimumPlan(b0, tolerance, liftsRecalled, rates, allow);
  return p.everyoneSafe ? p.cost : Number.POSITIVE_INFINITY;
}
