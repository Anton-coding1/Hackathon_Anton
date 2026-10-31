import type { Building, Connection, Occupant, RoomNode, Scenario } from "@/contracts/types";
import type { BuildingPlan, FloorPlan, Opening, Rect, Space } from "./demoPlan";

/**
 * Procedural multi-storey building: a double-loaded corridor with a stair core at
 * each end, a lift lobby in the middle and five bays either side. Produces both the
 * engine graph and the architectural plan, so any number of storeys works.
 *
 * Plan (x east, z south), 36 m × 15 m:
 *   [W core][ N bays ....  lift lobby  .... N bays ][E core]
 *   [W core][============== corridor ===============][E core]
 *   [W core][ S bays ....  centre bay  .... S bays ][E core]
 */
export type GenOccupant = { floor: number; side: "N" | "S"; bay: number; label: string; stepFree: boolean };

export type GenSpec = {
  id: string;
  name: string;
  storeys: number;
  lifts: 1 | 2;
  evacLifts: boolean;
  bayName: (floor: number, side: "N" | "S", bay: number) => string;
  groundName: (side: "N" | "S", bay: number) => string;
  occupants: GenOccupant[];
  fixtures?: "beds" | "flats" | "none";
};

const H = 4.5;
const BAYS: [number, number][] = [
  [-12, -7],
  [-7, -2],
  [-2, 2],
  [2, 7],
  [7, 12],
];
const SPINE = [-12, -9.5, -4.5, 0, 4.5, 9.5, 12];
const r1 = (n: number) => Math.round(n * 10) / 10;

export function generateBuilding(spec: GenSpec): { building: Building; plan: BuildingPlan } {
  const nodes: RoomNode[] = [];
  const connections: Connection[] = [];
  const occupants: Occupant[] = [];
  const floors: FloorPlan[] = [];
  const node = (n: RoomNode) => {
    nodes.push(n);
    return n.id;
  };
  const link = (id: string, from: string, to: string, kind: Connection["kind"], length: number, floor: number, extra: Partial<Connection> = {}) =>
    connections.push({ id, from, to, length: r1(length), stepFree: kind !== "stairs", floor, kind, ...extra });
  const liftXs = spec.lifts === 2 ? [-1, 1] : [0];
  const liftTag = (i: number) => (spec.lifts === 2 ? ["A", "B"][i] : "");

  for (let f = 0; f < spec.storeys; f++) {
    const y = f * H;
    const p = `F${f}_`;
    // Corridor spine
    SPINE.forEach((x, k) => node({ id: `${p}C${k}`, label: `Corridor ${f}.${k}`, position: [x, y, 0], floor: f, kind: "junction" }));
    for (let k = 0; k < SPINE.length - 1; k++) link(`${p}CR${k}`, `${p}C${k}`, `${p}C${k + 1}`, "corridor", SPINE[k + 1] - SPINE[k], f);
    // Stair landings alternate ends of each core so every flight has a run.
    const wx = f % 2 === 0 ? -16.5 : -13.5;
    const ex = f % 2 === 0 ? 16.5 : 13.5;
    node({ id: `${p}WS`, label: `West stair L${f}`, position: [wx, y, 0], floor: f, kind: "junction" });
    node({ id: `${p}ES`, label: `East stair L${f}`, position: [ex, y, 0], floor: f, kind: "junction" });
    link(`${p}WD`, `${p}WS`, `${p}C0`, "door", Math.abs(wx + 12), f);
    link(`${p}ED`, `${p}ES`, `${p}C${SPINE.length - 1}`, "door", Math.abs(ex - 12), f);
    if (f > 0) {
      link(`WSTAIR_${f}`, `${p}WS`, `F${f - 1}_WS`, "stairs", 9, f - 1);
      link(`ESTAIR_${f}`, `${p}ES`, `F${f - 1}_ES`, "stairs", 9, f - 1);
    }
    // Lift lobby nodes (one per car) on every floor.
    liftXs.forEach((lx, i) => {
      node({ id: `${p}L${liftTag(i)}`, label: `Lift ${liftTag(i) || ""} lobby L${f}`.replace("  ", " "), position: [lx, y, -5], floor: f, kind: "junction" });
      link(`${p}LD${liftTag(i)}`, `${p}L${liftTag(i)}`, `${p}C3`, "door", 5, f);
      if (f > 0) link(`LIFT${liftTag(i)}_${f}`, `${p}L${liftTag(i)}`, `F0_L${liftTag(i)}`, "lift", 4 + f * H, 0, { evacuationLift: spec.evacLifts });
    });

    // Plan for this floor
    const spaces: Space[] = [];
    const openings: Opening[] = [];
    const fixtures: [number, number, number, number, number][] = [];
    spaces.push({ id: `${p}SP`, name: "Corridor", rect: [-12, -1.3, 12, 1.3], kind: "circulation" });
    spaces.push({ id: `${p}WC`, name: "West stair", rect: [-18, -3, -12, 3], kind: "stair", nodeId: `${p}WS` });
    spaces.push({ id: `${p}EC`, name: "East stair", rect: [12, -3, 18, 3], kind: "stair", nodeId: `${p}ES` });
    spaces.push({ id: `${p}NW`, name: f === 0 ? "Plant" : "Riser", rect: [-18, -7.5, -12, -3], kind: "ancillary" });
    spaces.push({ id: `${p}NE`, name: f === 0 ? "Refuse" : "Store", rect: [12, -7.5, 18, -3], kind: "ancillary" });
    spaces.push({ id: `${p}SW`, name: f === 0 ? "West exit" : "Store", rect: [-18, 3, -12, 7.5], kind: f === 0 ? "lobby" : "ancillary", nodeId: f === 0 ? "W_EXIT" : undefined });
    spaces.push({ id: `${p}SE`, name: f === 0 ? "East exit" : "Store", rect: [12, 3, 18, 7.5], kind: f === 0 ? "lobby" : "ancillary", nodeId: f === 0 ? "E_EXIT" : undefined });
    openings.push({ axis: "z", at: -12, from: -1.2, to: 1.2, kind: "open" }, { axis: "z", at: 12, from: -1.2, to: 1.2, kind: "open" });
    BAYS.forEach(([x0, x1], b) => {
      const xc = (x0 + x1) / 2;
      for (const side of ["N", "S"] as const) {
        const rect: Rect = side === "N" ? [x0, -7.5, x1, -1.3] : [x0, 1.3, x1, 7.5];
        const occ = spec.occupants.find((o) => o.floor === f && o.side === side && o.bay === b);
        if (side === "N" && b === 2) {
          spaces.push({ id: `${p}LL`, name: "Lift lobby", rect, kind: "lobby", nodeId: `${p}L${liftTag(0)}` });
          openings.push({ axis: "x", at: -1.3, from: -1.6, to: 1.6, kind: "open" });
          continue;
        }
        if (f === 0 && side === "S" && b === 2) {
          spaces.push({ id: `${p}ENT`, name: "Entrance", rect, kind: "lobby", nodeId: "MAIN_EXIT" });
          openings.push({ axis: "x", at: 1.3, from: -1.6, to: 1.6, kind: "open" }, { axis: "x", at: 7.5, from: -1, to: 1, kind: "exit" });
          continue;
        }
        const name = f === 0 ? spec.groundName(side, b) : spec.bayName(f, side, b);
        const roomId = `${p}${side}${b}`;
        spaces.push({ id: `${p}S${side}${b}`, name, rect, kind: occ ? "room" : f === 0 ? "ancillary" : "room", nodeId: occ ? roomId : undefined });
        openings.push({ axis: "x", at: side === "N" ? -1.3 : 1.3, from: xc - 0.5, to: xc + 0.5, kind: "door" });
        if (spec.fixtures === "beds" && f > 0 && x1 - x0 > 4) fixtures.push([xc - 1.6, side === "N" ? -6.9 : 5.0, xc - 0.6, side === "N" ? -5 : 6.9, 0.55], [xc + 0.6, side === "N" ? -6.9 : 5.0, xc + 1.6, side === "N" ? -5 : 6.9, 0.55]);
        if (spec.fixtures === "flats" && f > 0 && x1 - x0 > 4) fixtures.push([x0 + 0.3, side === "N" ? -7.2 : 6.3, x1 - 0.3, side === "N" ? -6.3 : 7.2, 0.9]);
        if (occ) {
          node({ id: roomId, label: name, position: [xc, y, side === "N" ? -4.5 : 4.5], floor: f, kind: "room" });
          const spineIdx = SPINE.indexOf(xc);
          link(`${p}${side}${b}D`, roomId, `${p}C${spineIdx}`, "door", 4.5, f);
          occupants.push({ id: `O${occupants.length + 1}`, label: occ.label, startNodeId: roomId, requiresStepFree: occ.stepFree });
        }
      }
    });
    if (f === 0) {
      openings.push({ axis: "x", at: 3, from: -17.5, to: -12.5, kind: "open" }, { axis: "x", at: 3, from: 12.5, to: 17.5, kind: "open" });
      openings.push({ axis: "z", at: -18, from: 4.5, to: 6, kind: "exit" }, { axis: "z", at: 18, from: 4.5, to: 6, kind: "exit" });
    }
    floors.push({
      floor: f,
      name: f === 0 ? "Ground floor" : `Level ${f}`,
      footprint: [-18, -7.5, 18, 7.5],
      spaces,
      openings,
      voids: f > 0 ? [[-17.7, -1.1, -12.3, 1.1], [12.3, -1.1, 17.7, 1.1]] : [],
      fixtures,
    });
  }

  // Ground-floor exits
  node({ id: "W_EXIT", label: "West exit", position: [-15, 0, 5.25], floor: 0, kind: "exit", stepFreeExit: true });
  node({ id: "E_EXIT", label: "East exit", position: [15, 0, 5.25], floor: 0, kind: "exit", stepFreeExit: true });
  node({ id: "MAIN_EXIT", label: "Main entrance", position: [0, 0, 5.5], floor: 0, kind: "exit", stepFreeExit: true });
  link("W_OUT", "F0_WS", "W_EXIT", "door", 6, 0);
  link("E_OUT", "F0_ES", "E_EXIT", "door", 6, 0);
  link("MAIN_OUT", "F0_C3", "MAIN_EXIT", "door", 5.5, 0);

  return {
    building: { id: spec.id, name: spec.name, nodes, connections, occupants },
    plan: { floors, wallHeight: 1.6, exitDoors: { W_EXIT: [-18.6, 5.25], E_EXIT: [18.6, 5.25], MAIN_EXIT: [0, 8.1] } },
  };
}

/** Every non-evacuation lift recalled, as an explicit scenario. */
export function liftRecallScenario(b: Building): Scenario {
  const ids = b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);
  return { id: "FIRE_ALARM", name: "Fire alarm: all lifts recalled", blockedConnectionIds: ids };
}
