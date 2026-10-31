import type { Building, Repair, RepairAudit, Scenario, TestResult } from "@/contracts/types";
import { buildingIssues, cloneBuilding, connectionIssues, EngineValidationError, scenarioIssues } from "./graph";
import { simulate } from "./simulate";

const LENGTH_TOLERANCE = 0.05; // metres of rounding slack allowed below straight-line distance

/**
 * Independently verifies a proposed repair. It never trusts the proposer:
 * a repair is accepted only if it is valid, within budget, makes every occupant
 * stranded by the target scenario reachable again, and makes no stored
 * regression scenario worse. The input building and scenario are never modified.
 */
export function auditRepair(
  building: Building,
  scenario: Scenario,
  repair: Repair,
  regressionScenarios: Scenario[],
  budget: number,
): RepairAudit {
  const inputIssues = [...buildingIssues(building)];
  if (inputIssues.length === 0) inputIssues.push(...scenarioIssues(building, scenario));
  if (inputIssues.length > 0) throw new EngineValidationError(inputIssues);

  const before = simulate(building, scenario);
  const cost = typeof repair?.cost === "number" ? repair.cost : NaN;
  const reasons: string[] = [];
  const reject = (extra: string[], after: TestResult = before): RepairAudit => ({
    accepted: false,
    cost,
    budget,
    before,
    after,
    regressions: [],
    reasons: [...extra, ...reasons],
  });

  // 1. Validate the repair itself.
  const repairProblems = validateRepair(building, scenario, repair);
  if (repairProblems.length > 0) return reject(repairProblems.map((p) => `Rejected: ${p}`));

  if (!Number.isFinite(budget) || budget < 0) return reject(["Rejected: the budget must be a finite, non-negative number."]);
  if (cost > budget) return reject([`Rejected: cost £${fmt(cost)} exceeds the £${fmt(budget)} budget.`]);

  if (before.unreachableOccupantIds.length === 0) {
    return reject([`Rejected: scenario ${scenario.id} leaves nobody stranded, so there is no failure for this repair to fix.`]);
  }

  // 2. Apply to copies only.
  const repairedBuilding = repair.kind === "add_connection" ? withConnection(building, repair.connection) : building;
  const repairedScenario: Scenario =
    repair.kind === "unblock_connection"
      ? { ...scenario, blockedConnectionIds: scenario.blockedConnectionIds.filter((id) => id !== repair.connectionId) }
      : scenario;

  const after = simulate(repairedBuilding, repairedScenario);

  // 3. Did it fix the target failure (strict: every stranded occupant must be restored)?
  const stillStranded = before.unreachableOccupantIds.filter((id) => after.unreachableOccupantIds.includes(id));
  const newlyStranded = after.unreachableOccupantIds.filter((id) => !before.unreachableOccupantIds.includes(id));
  const what = repair.kind === "add_connection" ? `proposed connection ${repair.connection.id}` : `unblocking ${repair.connectionId}`;
  if (stillStranded.length > 0) {
    reasons.push(`Rejected: the ${what} does not restore an eligible route for ${stillStranded.join(", ")}.`);
  }
  if (newlyStranded.length > 0) {
    reasons.push(`Rejected: the ${what} leaves ${newlyStranded.join(", ")} newly without a route.`);
  }

  // 4. Regression suite: previously found failures must not get worse.
  const regressions: RepairAudit["regressions"] = [];
  const seen = new Set<string>();
  for (const reg of regressionScenarios ?? []) {
    if (!reg || seen.has(reg.id)) continue;
    seen.add(reg.id);
    const problems = scenarioIssues(building, reg);
    if (problems.length > 0) {
      regressions.push({ scenarioId: reg.id, beforeUnreachable: NaN, afterUnreachable: NaN, passed: false });
      reasons.push(`Rejected: regression scenario ${reg.id} is invalid (${problems.join(" ")}).`);
      continue;
    }
    const regBefore = simulate(building, reg);
    // An unblock repair applies only to the target scenario; an added connection applies everywhere.
    const regAfter = simulate(repairedBuilding, reg);
    const worse = regAfter.unreachableOccupantIds.filter((id) => !regBefore.unreachableOccupantIds.includes(id));
    const passed = worse.length === 0;
    regressions.push({
      scenarioId: reg.id,
      beforeUnreachable: regBefore.unreachableOccupantIds.length,
      afterUnreachable: regAfter.unreachableOccupantIds.length,
      passed,
    });
    if (!passed) reasons.push(`Rejected: regression ${reg.id} now strands ${worse.join(", ")}.`);
  }

  const accepted = reasons.length === 0;
  if (accepted) {
    const restored = before.unreachableOccupantIds.join(", ");
    reasons.push(`Accepted: ${what} restores an eligible route for ${restored} at £${fmt(cost)} of £${fmt(budget)}.`);
    if (regressions.length > 0) {
      const improved = regressions.filter((r) => r.afterUnreachable < r.beforeUnreachable).length;
      reasons.push(`All ${regressions.length} regression scenario(s) pass${improved ? `; ${improved} also improve` : ""}.`);
    }
    if (repair.kind === "unblock_connection") {
      reasons.push(`Note: unblocking only removes this obstruction; it adds no redundancy if ${repair.connectionId} fails again.`);
    }
    reasons.push("Verified on the connectivity graph only; this is not a fire-safety certification.");
  }

  return { accepted, cost, budget, before, after, regressions, reasons };
}

/** Returns every reason a repair is malformed or structurally unacceptable. */
export function validateRepair(building: Building, scenario: Scenario, repair: Repair): string[] {
  if (!repair || typeof repair !== "object") return ["the repair is missing."];
  const problems: string[] = [];
  if (typeof repair.cost !== "number" || !Number.isFinite(repair.cost) || repair.cost < 0) {
    problems.push("the cost must be a finite, non-negative number.");
  }
  if (repair.kind === "add_connection") {
    const c = repair.connection;
    if (!c || typeof c !== "object") return [...problems, "add_connection needs a connection object."];
    const nodeIds = new Set(building.nodes.map((n) => n.id));
    const taken = new Set(building.connections.map((x) => x.id));
    problems.push(...connectionIssues(c, nodeIds, taken).map((p) => p.replace(/^Duplicate connection id/, "the connection id is already in use:")));
    if (c.from === c.to) problems.push(`connection ${c.id} must join two different nodes.`);
    const a = building.nodes.find((n) => n.id === c.from);
    const b = building.nodes.find((n) => n.id === c.to);
    if (a && b) {
      if (c.stepFree && a.floor !== b.floor && c.kind !== "lift" && c.kind !== "ramp") {
        problems.push(`connection ${c.id} claims to be step-free between floors ${a.floor} and ${b.floor}; only a lift or ramp can do that (set kind).`);
      }
      if (c.kind === "lift" && a.floor === b.floor) problems.push(`lift ${c.id} must join different floors.`);
      if (c.kind === "stairs" && c.stepFree) problems.push(`stairs ${c.id} cannot be step-free.`);
      if (c.floor !== a.floor && c.floor !== b.floor) {
        problems.push(`connection ${c.id} is on floor ${c.floor}, but its endpoints are on floors ${a.floor} and ${b.floor}.`);
      }
      const dist = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      if (Number.isFinite(c.length) && c.length + LENGTH_TOLERANCE < dist) {
        problems.push(`connection ${c.id} declares length ${c.length} m, shorter than the ${dist.toFixed(1)} m straight-line distance between ${c.from} and ${c.to}.`);
      }
    }
  } else if (repair.kind === "unblock_connection") {
    if (!building.connections.some((c) => c.id === repair.connectionId)) {
      problems.push(`connection ${String(repair.connectionId)} does not exist.`);
    } else if (!scenario.blockedConnectionIds.includes(repair.connectionId)) {
      problems.push(`connection ${repair.connectionId} is not blocked in scenario ${scenario.id}.`);
    }
  } else {
    problems.push(`unknown repair kind "${String((repair as { kind?: unknown }).kind)}".`);
  }
  return problems;
}

/** Returns a copy of the building with one extra connection. */
export function withConnection(building: Building, connection: Building["connections"][number]): Building {
  const copy = cloneBuilding(building);
  copy.connections.push({ ...connection });
  return copy;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-GB") : String(n);
}
