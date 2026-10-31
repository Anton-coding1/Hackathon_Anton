import type { Building, Scenario } from "@/contracts/types";
import { assertValid, buildAdjacency, cmp, edgeConnectivityToExits } from "./graph";

export type Fingerprint = {
  nodeId: string;
  /** Min connection failures to cut this node off from every exit (any route). */
  anyRoute: number;
  /** Same, but using only step-free connections and step-free exits. */
  stepFree: number;
};

/**
 * Resilience fingerprint: for each room or junction, the minimum number of
 * connection failures that would disconnect it from all eligible exits
 * (edge connectivity via max-flow / min-cut). 0 = already cut off,
 * 1 = single point of failure. Exits themselves are omitted.
 */
export function resilienceFingerprint(building: Building, scenario?: Scenario): Fingerprint[] {
  assertValid(building, scenario);
  const blocked = scenario?.blockedConnectionIds ?? [];
  const anyAdj = buildAdjacency(building, blocked, false);
  const sfAdj = buildAdjacency(building, blocked, true);
  const anyExits = new Set(building.nodes.filter((n) => n.kind === "exit").map((n) => n.id));
  const sfExits = new Set(building.nodes.filter((n) => n.kind === "exit" && n.stepFreeExit === true).map((n) => n.id));
  return building.nodes
    .filter((n) => n.kind !== "exit")
    .sort((a, b) => cmp(a.id, b.id))
    .map((n) => ({
      nodeId: n.id,
      anyRoute: edgeConnectivityToExits(anyAdj, n.id, anyExits),
      stepFree: edgeConnectivityToExits(sfAdj, n.id, sfExits),
    }));
}
