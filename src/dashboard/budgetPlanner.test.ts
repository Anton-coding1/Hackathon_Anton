import { describe, expect, it } from "vitest";
import { PRESETS } from "@/data/buildings";
import { DEFAULT_RATES } from "@/cost/costModel";
import { planForBudget } from "./budgetPlanner";

const ALL = { corridor: true, stairs: true, lift: true, ramp: true, unblock: false };

describe("planForBudget", { timeout: 30000 }, () => {
  for (const id of ["tower", "hospital", "industrial", "clinic"] as const) {
    it(`${id}: big budget makes everyone safe; tiny budget says can't`, () => {
      const p = PRESETS[id];
      const t0 = performance.now();
      const rich = planForBudget(p.building, p.defaultTolerance, true, 1_000_000, DEFAULT_RATES, ALL);
      const poor = planForBudget(p.building, p.defaultTolerance, true, 10_000, DEFAULT_RATES, ALL);
      console.log(id, Math.round(performance.now() - t0) + "ms", "full £" + rich.fullCost, rich.fixes.map((f) => f.repair.kind + ":" + f.repair.cost).join(" "), "| poor spent £" + poor.cost, "safe", poor.everyoneSafe, "risk", Math.round(poor.riskBefore), "->", Math.round(poor.riskAfter));
      expect(rich.everyoneSafe).toBe(true);
      expect(rich.cost).toBeLessThanOrEqual(1_000_000);
      expect(poor.everyoneSafe).toBe(false);
      expect(poor.cost).toBeLessThanOrEqual(10_000);
      expect(poor.fullCost).toBe(rich.fullCost);
    });
  }
});

import type { Building } from "@/contracts/types";
import { auditRepair, certify, validateRepair } from "@/engine";
import { applyRepair, minimumPlan, nextFromPlan } from "./budgetPlanner";
import hollins from "@/data/samples/hollins-court.json";

const lifts = (b: Building) => b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);

describe("minimumPlan (no budget: minimum cost to get everyone out)", { timeout: 60000 }, () => {
  const cases: [string, Building, 1 | 2][] = [
    ["hollins (uploaded-style plan needing a combined fix)", hollins.building as Building, 1],
    ...(["tower", "hospital", "industrial", "clinic"] as const).map((id) => [id, PRESETS[id].building, PRESETS[id].defaultTolerance] as [string, Building, 1 | 2]),
  ];
  for (const [name, b0, tol] of cases) {
    it(`${name}: reaches fault-free, and every step passes the judge when replayed`, () => {
      const plan = minimumPlan(b0, tol, true, DEFAULT_RATES, ALL);
      expect(plan.everyoneSafe).toBe(true);
      let b = b0;
      let todo = plan.repairs;
      while (todo.length) {
        const next = nextFromPlan(b, todo, tol, true);
        expect(next).not.toBeNull();
        const { fix, enabling, index } = next!;
        if (enabling) {
          expect(validateRepair(b, fix.scenario, fix.repair)).toEqual([]);
        } else {
          const focus = { ...b, occupants: b.occupants.filter((o) => !fix.stillTrapped.includes(o.id)) };
          const audit = auditRepair(focus, fix.scenario, fix.repair, [], 1e9);
          expect(audit.reasons.join(" ")).toMatch(/^Accepted/);
        }
        b = applyRepair(b, fix.repair);
        todo = todo.filter((_, i) => i !== index);
      }
      expect(certify(b, tol, lifts(b), { skipEvacuationLifts: true }).faultFree).toBe(true);
    });
  }
});
