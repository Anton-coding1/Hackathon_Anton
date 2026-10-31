import type { Building, Connection, Repair, Scenario } from "@/contracts/types";
import { auditRepair, findAttacks } from "@/engine";
import { priceRepair, withModelledCost, type CostEstimate, type CostRates } from "@/cost/costModel";

/**
 * Deterministic stand-ins used ONLY when Gemini is unavailable. The UI always
 * labels their output as "deterministic", never as Gemini.
 */

export type RepairKind = "corridor" | "stairs" | "lift" | "ramp" | "unblock";

export function repairKind(r: Repair): RepairKind {
  if (r.kind === "unblock_connection") return "unblock";
  const k = r.connection.kind;
  if (k === "lift" || k === "ramp" || k === "stairs") return k;
  return r.connection.stepFree ? "corridor" : "stairs";
}

export function fallbackAttack(building: Building, tested: Scenario[], maxBlocked = 2): { scenario: Scenario; reasoning: string } | null {
  const key = (s: Scenario) => [...s.blockedConnectionIds].sort().join("+");
  const seen = new Set(tested.map(key));
  const attacks = findAttacks(building, 60).filter((a) => a.scenario.blockedConnectionIds.length <= maxBlocked);
  const pick =
    attacks.find((a) => a.result.unreachableOccupantIds.length > 0 && !seen.has(key(a.scenario))) ?? attacks.find((a) => !seen.has(key(a.scenario)));
  if (!pick) return null;
  const lifts = pick.scenario.blockedConnectionIds.filter((id) => building.connections.find((c) => c.id === id)?.kind === "lift");
  const scenario =
    lifts.length === pick.scenario.blockedConnectionIds.length
      ? { ...pick.scenario, name: `Lift ${lifts.join(" + ")} out of service (fire recall / power cut)` }
      : pick.scenario;
  const n = pick.result.unreachableOccupantIds.length;
  return {
    scenario,
    reasoning: n
      ? `Exhaustive search ranked ${pick.scenario.blockedConnectionIds.join(" + ")} highest: it strands ${n} occupant(s)${lifts.length ? "; lifts are recalled in a fire alarm" : ""}.`
      : `No untested disruption strands anyone; testing ${pick.scenario.blockedConnectionIds.join(" + ")} for detours.`,
  };
}

/** Cheapest candidate (by the cost model) that the judge accepts and the constraints allow. */
export function fallbackRepair(
  building: Building,
  scenario: Scenario,
  regressions: Scenario[],
  budget: number,
  rates: CostRates,
  allow: Record<RepairKind, boolean>,
): { repair: Repair; reasoning: string; estimate: CostEstimate } | null {
  const candidates: Repair[] = [];
  const nodes = [...building.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const linked = new Set(building.connections.map((c) => [c.from, c.to].sort().join("|")));
  let n = 1;
  const nextId = (p: string) => {
    let id = `${p}_${n++}`;
    while (building.connections.some((c) => c.id === id)) id = `${p}_${n++}`;
    return id;
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.kind === "exit" && b.kind === "exit") continue;
      const isLinked = linked.has([a.id, b.id].sort().join("|"));
      const dist = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      const length = Math.ceil(dist * 10) / 10;
      const floor = Math.min(a.floor, b.floor);
      let c: Connection | null = null;
      // A second, separate door/corridor between already-linked spaces is allowed: it adds redundancy.
      if (a.floor === b.floor && allow.corridor) c = { id: nextId(isLinked ? "DOOR" : "LINK"), from: a.id, to: b.id, length, stepFree: true, floor, kind: isLinked ? "door" : "corridor" };
      const horiz = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      if (c) candidates.push({ kind: "add_connection", connection: c, cost: 0 });
      if (a.floor !== b.floor && Math.abs(a.floor - b.floor) === 1) {
        if (allow.lift && horiz <= 3.5)
          candidates.push({ kind: "add_connection", connection: { id: nextId("EVAC_LIFT"), from: a.id, to: b.id, length: Math.ceil(dist + 1), stepFree: true, floor, kind: "lift", evacuationLift: true }, cost: 0 });
        if (allow.stairs && horiz >= 2 && horiz <= 12 && a.kind !== "exit" && b.kind !== "exit")
          candidates.push({ kind: "add_connection", connection: { id: nextId("STAIR"), from: a.id, to: b.id, length: Math.ceil(dist + 3), stepFree: false, floor, kind: "stairs" }, cost: 0 });
      }
    }
  }
  // Reopening only counts as a structural fix for lifts (secondary power makes it an evacuation lift);
  // reopening a door just removes today's obstruction and adds no resilience.
  if (allow.unblock)
    for (const id of scenario.blockedConnectionIds)
      if (building.connections.find((c) => c.id === id && c.kind === "lift" && !c.evacuationLift)) candidates.push({ kind: "unblock_connection", connectionId: id, cost: 0 });

  const priced = candidates.map((r) => withModelledCost(r, building, rates)).sort((x, y) => x.repair.cost - y.repair.cost);
  for (const { repair, estimate } of priced) {
    if (repair.cost > budget) break;
    if (auditRepair(building, scenario, repair, regressions, budget).accepted) {
      const why =
        repair.kind === "add_connection"
          ? `Cheapest fix that passes the judge: ${repair.connection.kind === "lift" ? "an evacuation lift" : repair.connection.kind === "stairs" ? "a new staircase" : repair.connection.kind === "door" ? "a second, separate door" : "a step-free corridor"} ${repair.connection.from} ↔ ${repair.connection.to}.`
          : `Cheapest fix that passes the judge: reopen ${repair.connectionId}${building.connections.find((c) => c.id === repair.connectionId)?.kind === "lift" ? " by giving the lift secondary power and evacuation controls" : ""}.`;
      return { repair, reasoning: why, estimate };
    }
  }
  return null;
}

export { priceRepair };
