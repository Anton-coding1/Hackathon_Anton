/**
 * Architectural floor-plan geometry for Blackwood Hall. Purely visual: the
 * engine only ever uses the graph in demoBuilding.ts. Coordinates are metres
 * in plan (x east, z south), matching node positions.
 */

export type Rect = [x0: number, z0: number, x1: number, z1: number];

export type SpaceKind = "room" | "circulation" | "stair" | "lobby" | "ancillary" | "void";

export type Space = {
  id: string;
  name: string;
  rect: Rect;
  kind: SpaceKind;
  /** Graph node that sits in this space, if any. */
  nodeId?: string;
};

/** An opening in a wall. axis "x" = wall runs along x (constant z); "z" = wall runs along z (constant x). */
export type Opening = {
  axis: "x" | "z";
  at: number; // constant coordinate of the wall line
  from: number;
  to: number;
  kind: "door" | "open" | "exit";
  /** Only cut when this connection exists in the building (e.g. a repair). */
  connectionId?: string;
};

export type FloorPlan = {
  floor: number;
  name: string;
  footprint: Rect;
  spaces: Space[];
  openings: Opening[];
  /** Rectangles cut out of this floor's slab (stair voids). */
  voids: Rect[];
  /** Optional furniture / racking blocks: [x0, z0, x1, z1, height]. Visual only. */
  fixtures?: [number, number, number, number, number][];
};

export type BuildingPlan = {
  floors: FloorPlan[];
  /** Exit nodes: where the exit door sits on the façade, so flows can leave the building. */
  exitDoors: Record<string, [number, number]>;
  wallHeight: number;
};

export const demoPlan: BuildingPlan = {
  wallHeight: 1.6,
  exitDoors: { WEST_EXIT: [-16.6, 0], EAST_EXIT: [18.6, 0] },
  floors: [
    {
      floor: 0,
      name: "Ground floor",
      footprint: [-16, -4.5, 18, 5],
      voids: [],
      spaces: [
        { id: "G_WEST", name: "West Entrance", rect: [-16, -4.5, -11, 2.5], kind: "lobby", nodeId: "WEST_EXIT" },
        { id: "G_RECEPTION", name: "Reception", rect: [-16, 2.5, -11, 5], kind: "room" },
        { id: "G_WSTAIR", name: "West Stair", rect: [-11, -4.5, -7, -1.3], kind: "stair" },
        { id: "G_STORE", name: "Store", rect: [-11, -1.3, -4.5, 2.5], kind: "ancillary" },
        { id: "G_RECORDS", name: "Records", rect: [-11, 2.5, -4.5, 5], kind: "ancillary" },
        { id: "G_CONSULT", name: "Consult A", rect: [-7, -4.5, -2, -1.3], kind: "room" },
        { id: "G_WC", name: "WC", rect: [-2, -4.5, 1, -1.3], kind: "ancillary" },
        { id: "G_CLINIC", name: "Clinic 102", rect: [-4.5, -1.3, 2, 5], kind: "room", nodeId: "R102" },
        { id: "G_ESTAIR", name: "East Stair", rect: [1, -4.5, 5.5, -1.3], kind: "stair" },
        { id: "G_CORR", name: "Corridor", rect: [2, -1.3, 5.5, 1.3], kind: "circulation" },
        { id: "G_WAIT", name: "Waiting", rect: [2, 1.3, 10.5, 5], kind: "room" },
        { id: "G_EAST", name: "East Lobby", rect: [5.5, -4.5, 10.5, 1.3], kind: "lobby", nodeId: "J2" },
        { id: "G_OFFICE", name: "Office", rect: [10.5, -4.5, 14, -1.3], kind: "room" },
        { id: "G_CORR2", name: "Corridor", rect: [10.5, -1.3, 14, 1.3], kind: "circulation" },
        { id: "G_PLANT", name: "Plant", rect: [10.5, 1.3, 14, 5], kind: "ancillary" },
        { id: "G_VEST", name: "East Exit", rect: [14, -2.5, 18, 2.5], kind: "lobby", nodeId: "EAST_EXIT" },
        { id: "G_CYCLE", name: "Cycle Store", rect: [14, -4.5, 18, -2.5], kind: "ancillary" },
        { id: "G_BINS", name: "Bins", rect: [14, 2.5, 18, 5], kind: "ancillary" },
      ],
      openings: [
        { axis: "z", at: -16, from: -1, to: 1, kind: "exit" },
        { axis: "z", at: 18, from: -1, to: 1, kind: "exit" },
        { axis: "z", at: -11, from: -4.3, to: -1.5, kind: "open" },
        { axis: "z", at: -11, from: -0.9, to: 0.9, kind: "open", connectionId: "NEW_ACCESS" },
        { axis: "z", at: -4.5, from: -0.9, to: 0.9, kind: "door", connectionId: "NEW_ACCESS" },
        { axis: "z", at: 2, from: -0.9, to: 0.9, kind: "door" },
        { axis: "z", at: 5.5, from: -1.2, to: 1.2, kind: "open" },
        { axis: "z", at: 5.5, from: -4.3, to: -1.5, kind: "open" },
        { axis: "z", at: 10.5, from: -1.2, to: 1.2, kind: "open" },
        { axis: "z", at: 14, from: -1.2, to: 1.2, kind: "open" },
        { axis: "x", at: 1.3, from: 6.5, to: 9.5, kind: "open" },
        { axis: "x", at: 2.5, from: -14.5, to: -12.5, kind: "door" },
        { axis: "x", at: 2.5, from: -9, to: -8, kind: "door" },
        { axis: "x", at: -1.3, from: -3.5, to: -2.5, kind: "door" },
        { axis: "x", at: -1.3, from: -1, to: 0, kind: "door" },
        { axis: "x", at: -1.3, from: 11.5, to: 12.5, kind: "door" },
        { axis: "x", at: 1.3, from: 11.5, to: 12.5, kind: "door" },
        { axis: "x", at: -2.5, from: 15, to: 16, kind: "door" },
        { axis: "x", at: 2.5, from: 15, to: 16, kind: "door" },
        { axis: "x", at: -1.3, from: -10.5, to: -9.5, kind: "door" },
      ],
    },
    {
      floor: 1,
      name: "First floor",
      footprint: [-7.2, -6, 11, 1.4],
      voids: [[1.2, -3.6, 7.2, -1.4]],
      spaces: [
        { id: "F_LANDING", name: "West Landing", rect: [-7.2, -4.5, -4, -0.5], kind: "lobby", nodeId: "J1" },
        { id: "F_CORR", name: "Corridor", rect: [-4, -4.5, -2, -0.5], kind: "circulation" },
        { id: "F_WC", name: "WC", rect: [-7.2, -6, -2, -4.5], kind: "ancillary" },
        { id: "F_OFF106", name: "Office 106", rect: [-7.2, -0.5, -2, 1.4], kind: "room" },
        { id: "F_STUDIO", name: "Studio 101", rect: [-2, -6, 1.2, 1.4], kind: "room", nodeId: "R101" },
        { id: "F_VOID", name: "Stair void", rect: [1.2, -3.6, 7.2, -1.4], kind: "void" },
        { id: "F_OFF103", name: "Office 103", rect: [1.2, -6, 11, -3.6], kind: "room" },
        { id: "F_GALLERY", name: "Gallery", rect: [7.2, -3.6, 11, -1.4], kind: "circulation" },
        { id: "F_MEET", name: "Meeting 104", rect: [1.2, -1.4, 11, 1.4], kind: "room" },
      ],
      openings: [
        { axis: "z", at: -7.2, from: -3.4, to: -1.6, kind: "open" },
        { axis: "z", at: -4, from: -4.3, to: -0.7, kind: "open" },
        { axis: "z", at: -2, from: -3.4, to: -1.6, kind: "door" },
        { axis: "z", at: 1.2, from: -3.4, to: -1.6, kind: "open" },
        { axis: "x", at: -4.5, from: -6, to: -5, kind: "door" },
        { axis: "x", at: -0.5, from: -6, to: -5, kind: "door" },
        { axis: "x", at: -3.6, from: 8, to: 9.5, kind: "door" },
        { axis: "x", at: -1.4, from: 8, to: 9.5, kind: "door" },
        { axis: "z", at: 7.2, from: -3.6, to: -1.4, kind: "open" },
      ],
    },
  ],
};

export function rectArea([x0, z0, x1, z1]: Rect): number {
  return Math.abs(x1 - x0) * Math.abs(z1 - z0);
}
