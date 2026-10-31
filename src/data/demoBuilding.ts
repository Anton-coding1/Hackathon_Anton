import type { Building, Repair, Scenario } from "@/contracts/types";

/**
 * Blackwood Hall: a fictional two-floor building for the ExitZero demo.
 *
 * Ground floor (floor 0, y = 0, spine z = 0):    WEST_EXIT · R102 · J2 · EAST_EXIT
 * First floor  (floor 1, y = 4.5, spine z = -2.5): J1 · R101
 *
 *   D1  R101 ↔ J1          upper corridor      step-free
 *   D2  J1   ↔ WEST_EXIT   west staircase      stairs
 *   D3  R102 ↔ J2          ground corridor     step-free
 *   D4  J2   ↔ EAST_EXIT   east lobby door     step-free
 *   D5  R101 ↔ J2          east staircase      stairs
 *
 * O1 (no mobility constraint) starts in R101. O2 (step-free) starts in R102.
 * O2's only step-free route is R102 → J2 → EAST_EXIT, so blocking D4 strands O2,
 * while O1 still leaves via the west stairs. NEW_ACCESS (R102 ↔ WEST_EXIT, step-free)
 * gives O2 a second accessible exit. EXTRA_DOOR (a second R102 ↔ J2 door) looks
 * plausible but still leads only to the blocked lobby, so the auditor rejects it.
 *
 * Lengths are walking distances in metres along the drawn plan (stairs include
 * their landings). Floor-plan geometry lives in demoPlan.ts. This is a
 * connectivity model only, not a fire-safety or evacuation-time simulation.
 */

const FLOOR_HEIGHT = 4.5;

export const demoBuilding: Building = {
  id: "blackwood-hall",
  name: "Blackwood Hall (fictional)",
  nodes: [
    { id: "R101", label: "Studio 101", position: [0, FLOOR_HEIGHT, -2.5], floor: 1, kind: "room" },
    { id: "J1", label: "West Landing", position: [-7, FLOOR_HEIGHT, -2.5], floor: 1, kind: "junction" },
    { id: "R102", label: "Clinic 102", position: [-1, 0, 0], floor: 0, kind: "room" },
    { id: "J2", label: "East Lobby", position: [7, 0, 0], floor: 0, kind: "junction" },
    { id: "WEST_EXIT", label: "West Exit", position: [-13, 0, 0], floor: 0, kind: "exit", stepFreeExit: true },
    { id: "EAST_EXIT", label: "East Exit", position: [15, 0, 0], floor: 0, kind: "exit", stepFreeExit: true },
  ],
  connections: [
    { id: "D1", from: "R101", to: "J1", length: 7, stepFree: true, floor: 1 },
    { id: "D2", from: "J1", to: "WEST_EXIT", length: 10, stepFree: false, floor: 0 },
    { id: "D3", from: "R102", to: "J2", length: 8, stepFree: true, floor: 0 },
    { id: "D4", from: "J2", to: "EAST_EXIT", length: 8, stepFree: true, floor: 0 },
    { id: "D5", from: "R101", to: "J2", length: 11, stepFree: false, floor: 0 },
  ],
  occupants: [
    { id: "O1", label: "Staff member", startNodeId: "R101", requiresStepFree: false },
    { id: "O2", label: "Wheelchair user", startNodeId: "R102", requiresStepFree: true },
  ],
};

export const initialScenario: Scenario = {
  id: "BASELINE",
  name: "Normal operation",
  blockedConnectionIds: [],
};

export const blockedD4Scenario: Scenario = {
  id: "BLOCK_D4",
  name: "East lobby door D4 blocked",
  blockedConnectionIds: ["D4"],
};

/** Valid: a new step-free corridor from Clinic 102 to the west exit. */
export const validDemoRepair: Repair = {
  kind: "add_connection",
  connection: {
    id: "NEW_ACCESS",
    from: "R102",
    to: "WEST_EXIT",
    length: 12,
    stepFree: true,
    floor: 0,
    costToAdd: 8500,
  },
  cost: 8500,
};

/** Plausible but ineffective: a second door into the same (blocked-off) lobby. */
export const invalidDemoRepair: Repair = {
  kind: "add_connection",
  connection: {
    id: "EXTRA_DOOR",
    from: "R102",
    to: "J2",
    length: 8,
    stepFree: true,
    floor: 0,
    costToAdd: 3000,
  },
  cost: 3000,
};

export const DEMO_BUDGET = 20000;
