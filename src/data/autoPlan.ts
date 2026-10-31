import type { Building } from "@/contracts/types";
import type { BuildingPlan, FloorPlan } from "./demoPlan";

/** Minimal plan for buildings that ship without one: a slab per floor and a pad per node. */
export function autoPlan(b: Building): BuildingPlan {
  const floors = [...new Set(b.nodes.map((n) => n.floor))].sort((x, y) => x - y);
  const plans: FloorPlan[] = floors.map((f) => {
    const ns = b.nodes.filter((n) => n.floor === f);
    const xs = ns.map((n) => n.position[0]);
    const zs = ns.map((n) => n.position[2]);
    return {
      floor: f,
      name: f === 0 ? "Ground floor" : `Level ${f}`,
      footprint: [Math.min(...xs) - 3, Math.min(...zs) - 3, Math.max(...xs) + 3, Math.max(...zs) + 3],
      voids: [],
      openings: [],
      spaces: ns.map((n) => ({
        id: `auto-${n.id}`,
        name: n.label,
        nodeId: n.id,
        kind: n.kind === "room" ? ("room" as const) : n.kind === "exit" ? ("lobby" as const) : ("circulation" as const),
        rect: [n.position[0] - 1.6, n.position[2] - 1.6, n.position[0] + 1.6, n.position[2] + 1.6] as [number, number, number, number],
      })),
    };
  });
  return { floors: plans, exitDoors: {}, wallHeight: 0.4 };
}

