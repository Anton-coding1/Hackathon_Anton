import type { Building, Connection, Repair, Scenario } from "@/contracts/types";
import { auditRepair, findAttacks, simulate } from "@/engine";
import { buildAdjacency } from "@/engine/graph";
import { priceRepair, withModelledCost, type CostEstimate, type CostRates } from "@/cost/costModel";

/**
 * Deterministic stand-ins used ONLY when Gemini is unavailable. The UI always
 * labels their output as "deterministic", never as Gemini.
 */

export type RepairKind = "corridor" | "stairs" | "lift" | "ramp" | "unblock";

export function repairKind(r: Repair): RepairKind {
  if (r.kind === "unblock_connection") return "unblock";
  const c = r.kind === "add_connection" ? r.connection : r.connections[0];
  const k = c?.kind;
  if (k === "lift" || k === "ramp" || k === "stairs") return k;
  return c?.stepFree ? "corridor" : "stairs";
}

export function fallbackAttack(building: Building, tested: Scenario[], maxBlocked = 2): { scenario: Scenario; reasoning: string } | null {
  const key = (s: Scenario) => [...s.blockedConnectionIds].sort().join("+");
  const seen = new Set(tested.map(key));
  // The classic multi-storey hazard first: a fire alarm recalls every non-evacuation lift.
  const allLifts = building.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id).sort();
  if (allLifts.length > 1) {
    const fire: Scenario = { id: "FIRE_ALARM", name: "Fire alarm: all lifts recalled", blockedConnectionIds: allLifts };
    const r = simulate(building, fire);
    if (!seen.has(key(fire)) && r.unreachableOccupantIds.length) {
      return { scenario: fire, reasoning: `In a fire alarm all ${allLifts.length} lift connections are recalled; ${r.unreachableOccupantIds.length} occupant(s) cannot use stairs.` };
    }
  }
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

  // Only links that leave the stranded occupants' reachable area can help, so search there.
  const result = simulate(building, scenario);
  const stuck = building.occupants.filter((o) => result.unreachableOccupantIds.includes(o.id));
  const region = new Set<string>();
  for (const o of stuck) {
    const adj = buildAdjacency(building, scenario.blockedConnectionIds, o.requiresStepFree);
    const queue = [o.startNodeId];
    region.add(o.startNodeId);
    while (queue.length) {
      const u = queue.shift()!;
      for (const e of adj.get(u) ?? []) if (!region.has(e.to)) (region.add(e.to), queue.push(e.to));
    }
  }
  const useful = (a: string, b: string) => region.size === 0 || region.has(a) !== region.has(b);

  // Evacuation lift beside every existing lift stack: one stop per floor, built as one change.
  if (allow.lift) {
    const liftNodes = new Set(building.connections.filter((c) => c.kind === "lift").flatMap((c) => [c.from, c.to]));
    const stacks = new Map<string, typeof building.nodes>();
    for (const n of building.nodes) {
      if (!liftNodes.has(n.id)) continue;
      const key = `${Math.round(n.position[0] * 2)}:${Math.round(n.position[2] * 2)}`;
      stacks.set(key, [...(stacks.get(key) ?? []), n]);
    }
    let s = 1;
    for (const stack of stacks.values()) {
      const byFloor = [...stack].sort((a, b) => a.floor - b.floor);
      const bottom = byFloor[0];
      const upper = byFloor.filter((n) => n.floor > bottom.floor);
      if (upper.length < 1 || !upper.some((n) => region.has(n.id) || region.size === 0)) continue;
      let tag = `EVAC${s++}`;
      while (building.connections.some((c) => c.id.startsWith(`${tag}_`))) tag = `EVAC${s++}`;
      const connections: Connection[] = upper.map((n) => ({
        id: `${tag}_${n.floor}`,
        from: n.id,
        to: bottom.id,
        length: Math.ceil(Math.abs(n.position[1] - bottom.position[1]) + 4),
        stepFree: true,
        floor: bottom.floor,
        kind: "lift",
        evacuationLift: true,
      }));
      candidates.push({ kind: "add_connections", connections, cost: 0, label: `New evacuation lift beside ${bottom.label} (${upper.length + 1} stops)` });
    }
  }
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
      if (!useful(a.id, b.id)) continue;
      const isLinked = linked.has([a.id, b.id].sort().join("|"));
      const dist = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      const length = Math.ceil(dist * 10) / 10;
      const floor = Math.min(a.floor, b.floor);
      let c: Connection | null = null;
      // A second, separate door/corridor between already-linked spaces is allowed: it adds redundancy.
      if (a.floor === b.floor && allow.corridor && dist <= 20) c = { id: nextId(isLinked ? "DOOR" : "LINK"), from: a.id, to: b.id, length, stepFree: true, floor, kind: isLinked ? "door" : "corridor" };
      const horiz = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      if (c) candidates.push({ kind: "add_connection", connection: c, cost: 0 });
      if (a.floor !== b.floor && Math.abs(a.floor - b.floor) === 1) {
        const storeys = new Set(building.nodes.map((n) => n.floor)).size;
        if (allow.lift && horiz <= 3.5 && storeys <= 2)
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
        repair.kind === "add_connections"
          ? `Cheapest fix that passes the judge: ${repair.label ?? "a multi-floor change"}.`
          : repair.kind === "add_connection"
          ? `Cheapest fix that passes the judge: ${repair.connection.kind === "lift" ? "an evacuation lift" : repair.connection.kind === "stairs" ? "a new staircase" : repair.connection.kind === "door" ? "a second, separate door" : "a step-free corridor"} ${repair.connection.from} ↔ ${repair.connection.to}.`
          : `Cheapest fix that passes the judge: reopen ${repair.connectionId}${building.connections.find((c) => c.id === repair.connectionId)?.kind === "lift" ? " by giving the lift secondary power and evacuation controls" : ""}.`;
      return { repair, reasoning: why, estimate };
    }
  }
  return null;
}

export { priceRepair };
