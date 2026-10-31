import type { Building, Scenario, TestResult } from "@/contracts/types";
import { assertValid, cmp } from "./graph";
import { simulate, simulateDetailed } from "./simulate";

export type AttackFinding = { scenario: Scenario; result: TestResult };

type Scored = AttackFinding & {
  unreachable: number;
  stepFreeHit: number;
  rerouted: number;
  detour: number;
  key: string;
};

/**
 * Deterministic attack-search baseline. Blocks each connection on its own, then
 * tries pairs among the most damaging connections, and ranks scenarios by:
 *   1. occupants left without a route,
 *   2. step-free occupants affected,
 *   3. occupants forced onto a different route,
 *   4. added route length,
 *   5. connection IDs (tie-breaker).
 * Works without Gemini, so the demo never depends on the model being available.
 */
export function findAttacks(building: Building, maxAttacks = 10): AttackFinding[] {
  assertValid(building);
  const baseline = simulateDetailed(building, { id: "BASELINE", name: "Baseline", blockedConnectionIds: [] });
  const baseLength = new Map(baseline.routes.map((r) => [r.occupantId, r.route?.length ?? 0]));
  const stepFree = new Set(building.occupants.filter((o) => o.requiresStepFree).map((o) => o.id));
  const ids = building.connections.map((c) => c.id).sort(cmp);

  const score = (blocked: string[]): Scored => {
    const scenario: Scenario = {
      id: `ATTACK_${blocked.join("_")}`,
      name: blocked.length === 1 ? `Block ${blocked[0]}` : `Block ${blocked.join(" + ")}`,
      blockedConnectionIds: blocked,
    };
    const { result, routes } = simulateDetailed(building, scenario);
    let rerouted = 0;
    let detour = 0;
    for (const r of routes) {
      const before = baseline.result.paths[r.occupantId];
      const after = result.paths[r.occupantId];
      if (before && after && before.join() !== after.join()) {
        rerouted += 1;
        detour += (r.route?.length ?? 0) - (baseLength.get(r.occupantId) ?? 0);
      }
    }
    return {
      scenario,
      result,
      unreachable: result.unreachableOccupantIds.length,
      stepFreeHit: result.unreachableOccupantIds.filter((id) => stepFree.has(id)).length,
      rerouted,
      detour,
      key: blocked.join("+"),
    };
  };

  const singles = ids.map((id) => score([id]));

  // Pairs: only among the most damaging singles, and only when the pair causes
  // failures neither connection causes alone (a genuine combined weakness).
  const topIds = [...singles].sort(rank).slice(0, 6).map((s) => s.scenario.blockedConnectionIds[0]).sort(cmp);
  const singleUnreachable = new Map(singles.map((s) => [s.scenario.blockedConnectionIds[0], new Set(s.result.unreachableOccupantIds)]));
  const pairs: Scored[] = [];
  for (let i = 0; i < topIds.length; i++) {
    for (let j = i + 1; j < topIds.length; j++) {
      const s = score([topIds[i], topIds[j]]);
      const newFailure = s.result.unreachableOccupantIds.some(
        (o) => !singleUnreachable.get(topIds[i])!.has(o) && !singleUnreachable.get(topIds[j])!.has(o),
      );
      if (newFailure) pairs.push(s);
    }
  }

  // Single-connection weaknesses come first (cheapest to explain and fix), then combined ones.
  return [...singles.sort(rank), ...pairs.sort(rank)]
    .slice(0, Math.max(0, maxAttacks))
    .map(({ scenario, result }) => ({ scenario, result }));
}

function rank(a: Scored, b: Scored): number {
  return (
    b.unreachable - a.unreachable ||
    b.stepFreeHit - a.stepFreeHit ||
    b.rerouted - a.rerouted ||
    b.detour - a.detour ||
    a.scenario.blockedConnectionIds.length - b.scenario.blockedConnectionIds.length ||
    cmp(a.key, b.key)
  );
}

// Re-exported for callers that only need a quick check.
export { simulate };
