import { describe, expect, it } from "vitest";
import { PRESETS } from "./buildings";
import { planChanges } from "./planChanges";
import type { Repair } from "@/contracts/types";

describe("planChanges", () => {
  it("new evacuation lift carves a shaft out of a neighbouring room on every floor", () => {
    const t = PRESETS.tower;
    const lift = t.scripted!.repairs[1].repair;
    const { plan, changes, anchors } = planChanges(t.plan!, t.building, [lift]);
    console.log(changes[0]);
    expect(changes[0].title).toBe("New evacuation lift");
    expect(changes[0].markers).toHaveLength(7);
    for (const f of plan.floors) {
      const shaft = f.spaces.find((s) => s.changeNo === 1 && s.kind === "core");
      expect(shaft, `floor ${f.floor}`).toBeDefined();
      const host = f.spaces.find((s) => s.reducedBy);
      expect(host?.name).toBeTruthy();
      expect(f.openings.some((o) => o.changeNo === 1)).toBe(true);
    }
    expect(Object.keys(anchors)).toHaveLength(6);
  });

  it("new door between lift lobby and concierge is cut into the wall, not drawn through the room", () => {
    const t = PRESETS.tower;
    const rep: Repair = { kind: "add_connection", connection: { id: "LINK_1", from: "F0_L", to: "F0_N1", length: 4.6, stepFree: true, floor: 0, kind: "corridor" }, cost: 5100 };
    const { plan, changes } = planChanges(t.plan!, t.building, [rep]);
    console.log(changes[0]);
    expect(changes[0].title).toBe("New door");
    const g = plan.floors[0];
    const o = g.openings.filter((x) => x.changeNo === 1);
    expect(o).toHaveLength(1);
    expect(o[0].axis).toBe("z");
    expect(o[0].at).toBe(-2);
  });

  it("lift upgrade keeps the shaft and loses no rooms", () => {
    const t = PRESETS.tower;
    const ids = t.building.connections.filter((c) => c.kind === "lift").map((c) => c.id);
    const { plan, changes } = planChanges(t.plan!, t.building, [{ kind: "upgrade_lift", connectionIds: ids, cost: 88000 }]);
    expect(changes[0].title).toMatch(/upgraded/);
    expect(plan.floors.every((f) => !f.spaces.some((s) => s.reducedBy))).toBe(true);
  });

  it("industrial evacuation lift lands in the canteen / kitchenette stack", () => {
    const p = PRESETS.industrial;
    const rep: Repair = { kind: "add_connections", connections: [{ id: "EV_1", from: "F_LIFT", to: "G_LIFT", length: 9, stepFree: true, floor: 0, kind: "lift", evacuationLift: true }], cost: 95000 };
    const { changes } = planChanges(p.plan!, p.building, [rep]);
    console.log(changes[0]);
    expect(changes[0].detail).toMatch(/Canteen|Kitchenette|Plant/);
  });
});
