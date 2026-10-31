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
