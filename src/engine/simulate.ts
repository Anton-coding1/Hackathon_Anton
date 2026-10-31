import type { Building, Occupant, Scenario, TestResult } from "@/contracts/types";
import { assertValid, buildAdjacency, eligibleExits, shortestRoute, type Route } from "./graph";

export type OccupantRoute = { occupantId: string; route: Route | null };

/** Shortest eligible route for one occupant under a scenario, or null if none exists. */
export function routeForOccupant(building: Building, scenario: Scenario, occupant: Occupant): Route | null {
  const adj = buildAdjacency(building, scenario.blockedConnectionIds, occupant.requiresStepFree);
  const exits = new Set(eligibleExits(building, occupant).map((n) => n.id));
  return shortestRoute(adj, occupant.startNodeId, exits);
}

/** Like simulate(), but also returns connection IDs and lengths for each route. */
export function simulateDetailed(building: Building, scenario: Scenario): { result: TestResult; routes: OccupantRoute[] } {
  assertValid(building, scenario);
  const occupants = [...building.occupants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const routes: OccupantRoute[] = occupants.map((o) => ({ occupantId: o.id, route: routeForOccupant(building, scenario, o) }));

  const paths: Record<string, string[]> = {};
  const unreachable: string[] = [];
  const explanations: string[] = [];

  for (const { occupantId, route } of routes) {
    const occupant = occupants.find((o) => o.id === occupantId)!;
    if (route) {
      paths[occupantId] = route.nodes;
      explanations.push(
        `${occupantId} (${occupant.label}) reaches ${route.exitId} via ${route.nodes.join(" → ")}, graph distance ${route.length} m.`,
      );
    } else {
      unreachable.push(occupantId);
      explanations.push(explainUnreachable(building, scenario, occupant));
    }
  }

  if (unreachable.length === 0 && occupants.length > 0) {
    explanations.push("Every occupant has a graph route to an eligible exit. This shows connectivity only, not real-world evacuation safety.");
  }

  return {
    result: {
      scenarioId: scenario.id,
      unreachableOccupantIds: unreachable,
      paths,
      reachableCount: occupants.length - unreachable.length,
      totalCount: occupants.length,
      explanations,
    },
    routes,
  };
}

/**
 * Evaluates every occupant independently: removes blocked connections, applies
 * step-free constraints, and finds each occupant's shortest route to an eligible exit.
 * Throws EngineValidationError for malformed input.
 */
export function simulate(building: Building, scenario: Scenario): TestResult {
  return simulateDetailed(building, scenario).result;
}

function explainUnreachable(building: Building, scenario: Scenario, occupant: Occupant): string {
  const exitKind = occupant.requiresStepFree ? "a step-free exit" : "any exit";
  const exits = eligibleExits(building, occupant);
  if (exits.length === 0) {
    return `${occupant.id} (${occupant.label}) cannot reach ${exitKind}: the building has no eligible exit for them.`;
  }
  const blocked = scenario.blockedConnectionIds;
  // Which single blocked connections, if reopened, would restore a route?
  const critical = blocked.filter((id) => {
    const reopened = { ...scenario, blockedConnectionIds: blocked.filter((b) => b !== id) };
    return routeForOccupant(building, reopened, occupant) !== null;
  });
  if (critical.length > 0) {
    const lifts = critical.filter((id) => building.connections.find((c) => c.id === id)?.kind === "lift");
    if (lifts.length === critical.length) {
      const verb = lifts.length === 1 ? "is" : "are";
      return `${occupant.id} (${occupant.label}) cannot reach ${exitKind} while lift ${lifts.join(", ")} ${verb} out of service.`;
    }
    const list = critical.join(", ");
    const verb = critical.length === 1 ? "is" : "are";
    return `${occupant.id} (${occupant.label}) cannot reach ${exitKind} while connection ${list} ${verb} blocked.`;
  }
  if (blocked.length > 0) {
    return `${occupant.id} (${occupant.label}) cannot reach ${exitKind}; blocked connections ${blocked.join(", ")} together cut every eligible route.`;
  }
  return `${occupant.id} (${occupant.label}) has no ${occupant.requiresStepFree ? "step-free " : ""}route to ${exitKind}, even with nothing blocked.`;
}

/**
 * Fire-alarm scenario: every lift that is not an evacuation lift is recalled and
 * unusable, on top of any extra blocked connections.
 */
export function fireAlarmScenario(building: Building, extraBlocked: string[] = []): Scenario {
  const lifts = building.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);
  const blocked = [...new Set([...lifts, ...extraBlocked])].sort();
  return {
    id: `FIRE_ALARM${extraBlocked.length ? "_" + extraBlocked.join("_") : ""}`,
    name: lifts.length ? `Fire alarm: lifts recalled (${lifts.join(", ")})` : "Fire alarm (no lifts to recall)",
    blockedConnectionIds: blocked,
  };
}
