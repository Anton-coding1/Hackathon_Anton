import type { Building, Repair, Scenario } from "@/contracts/types";
import { auditRepair, findAttacks } from "@/engine";

/**
 * Deterministic stand-ins used ONLY when Gemini is unavailable. The UI always
 * labels their output as "deterministic fallback", never as Gemini.
 */

export function fallbackAttack(building: Building, tested: Scenario[]): { scenario: Scenario; reasoning: string } | null {
  const seen = new Set(tested.map((s) => [...s.blockedConnectionIds].sort().join("+")));
  const attacks = findAttacks(building, 50);
  const pick =
    attacks.find((a) => a.result.unreachableOccupantIds.length > 0 && !seen.has([...a.scenario.blockedConnectionIds].sort().join("+"))) ??
    attacks.find((a) => !seen.has([...a.scenario.blockedConnectionIds].sort().join("+")));
  if (!pick) return null;
  const n = pick.result.unreachableOccupantIds.length;
  return {
    scenario: pick.scenario,
    reasoning: n
      ? `Exhaustive single-connection search ranked ${pick.scenario.blockedConnectionIds.join(" + ")} highest: it strands ${n} occupant(s).`
      : `No untested disruption strands anyone; testing ${pick.scenario.blockedConnectionIds.join(" + ")} for detours.`,
  };
}

/** Cheapest same-floor step-free corridor (or unblock) that the auditor accepts. */
export function fallbackRepair(
  building: Building,
  scenario: Scenario,
  regressions: Scenario[],
  budget: number,
): { repair: Repair; reasoning: string } | null {
  const candidates: Repair[] = [];
  const nodes = [...building.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const linked = new Set(building.connections.map((c) => [c.from, c.to].sort().join("|")));
  let n = 1;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.floor !== b.floor || linked.has([a.id, b.id].sort().join("|"))) continue;
      if (a.kind === "exit" && b.kind === "exit") continue;
      const dist = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      const length = Math.ceil(dist * 10) / 10;
      const cost = Math.round((4000 + 500 * length) / 100) * 100;
      let id = `LINK_${n++}`;
      while (building.connections.some((c) => c.id === id)) id = `LINK_${n++}`;
      candidates.push({ kind: "add_connection", connection: { id, from: a.id, to: b.id, length, stepFree: true, floor: a.floor, costToAdd: cost }, cost });
    }
  }
  candidates.sort((x, y) => x.cost - y.cost);
  for (const r of candidates) {
    if (r.cost > budget) break;
    if (auditRepair(building, scenario, r, regressions, budget).accepted) {
      const c = (r as Extract<Repair, { kind: "add_connection" }>).connection;
      return { repair: r, reasoning: `Cheapest step-free corridor that passes the auditor: ${c.from} ↔ ${c.to}, ${c.length} m.` };
    }
  }
  return null;
}
