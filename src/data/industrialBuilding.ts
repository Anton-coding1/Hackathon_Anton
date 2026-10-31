import type { Building, Repair, Scenario } from "@/contracts/types";
import type { BuildingPlan } from "./demoPlan";

/**
 * Northfield Works: a fictional light-industrial unit. A double-height warehouse
 * with a two-storey office block. The first-floor design office is reached by one
 * passenger lift (L1) and a mezzanine stair (S1) that drops into the warehouse.
 *
 * In a fire alarm, L1 is recalled (it is not an evacuation lift), so the
 * wheelchair user in the design office has no step-free way out. Adding a second
 * staircase looks sensible but does not help her; an evacuation lift does.
 */
const H = 4.5;

export const industrialBuilding: Building = {
  id: "northfield-works",
  name: "Northfield Works (fictional)",
  nodes: [
    { id: "WH", label: "Warehouse floor", position: [-4, 0, -2], floor: 0, kind: "room" },
    { id: "STAIR_FOOT", label: "Mezzanine stair foot", position: [1, 0, -5], floor: 0, kind: "junction" },
    { id: "LOAD_EXIT", label: "Loading bay exit", position: [-13, 0, 3.1], floor: 0, kind: "exit", stepFreeExit: true },
    { id: "G_LOBBY", label: "Reception", position: [11, 0, 0], floor: 0, kind: "junction" },
    { id: "G_LIFT", label: "Ground lift lobby", position: [11, 0, -5], floor: 0, kind: "junction" },
    { id: "MAIN_EXIT", label: "Main entrance", position: [14.5, 0, 0], floor: 0, kind: "exit", stepFreeExit: true },
    { id: "F_WEST", label: "Stair landing", position: [7, H, -5], floor: 1, kind: "junction" },
    { id: "F_LIFT", label: "First-floor lift lobby", position: [11, H, -5], floor: 1, kind: "junction" },
    { id: "OFFICE", label: "Design office", position: [11, H, 2], floor: 1, kind: "room" },
  ],
  connections: [
    { id: "C1", from: "WH", to: "LOAD_EXIT", length: 11, stepFree: true, floor: 0, kind: "door" },
    { id: "C2", from: "WH", to: "G_LOBBY", length: 16, stepFree: true, floor: 0, kind: "door" },
    { id: "C3", from: "G_LOBBY", to: "MAIN_EXIT", length: 3.5, stepFree: true, floor: 0, kind: "door" },
    { id: "C4", from: "G_LIFT", to: "G_LOBBY", length: 5, stepFree: true, floor: 0, kind: "corridor" },
    { id: "C5", from: "STAIR_FOOT", to: "WH", length: 6, stepFree: true, floor: 0, kind: "corridor" },
    { id: "C6", from: "F_WEST", to: "F_LIFT", length: 4, stepFree: true, floor: 1, kind: "corridor" },
    { id: "C7", from: "F_LIFT", to: "OFFICE", length: 7, stepFree: true, floor: 1, kind: "door" },
    { id: "S1", from: "F_WEST", to: "STAIR_FOOT", length: 8, stepFree: false, floor: 0, kind: "stairs" },
    { id: "L1", from: "G_LIFT", to: "F_LIFT", length: 6, stepFree: true, floor: 0, kind: "lift", evacuationLift: false },
  ],
  occupants: [
    { id: "O1", label: "Forklift driver", startNodeId: "WH", requiresStepFree: false },
    { id: "O2", label: "Wheelchair user", startNodeId: "OFFICE", requiresStepFree: true },
    { id: "O3", label: "Design engineer", startNodeId: "OFFICE", requiresStepFree: false },
  ],
};

export const industrialPlan: BuildingPlan = {
  wallHeight: 1.6,
  exitDoors: { LOAD_EXIT: [-16.6, 3.1], MAIN_EXIT: [16.6, 0] },
  floors: [
    {
      floor: 0,
      name: "Ground floor",
      footprint: [-16, -8, 16, 6],
      voids: [],
      fixtures: [
        [-13, -7.6, -3, -6.8, 2.6],
        [-13, -4.4, -6, -3.6, 2.6],
        [-12, 4.4, 2, 5.3, 2.6],
        [-1, 1.6, 4, 2.4, 1.2],
      ],
      spaces: [
        { id: "I_WH", name: "Warehouse", rect: [-16, -8, 6, 6], kind: "room", nodeId: "WH" },
        { id: "I_PLANT", name: "Plant", rect: [6, -8, 9, -2], kind: "ancillary" },
        { id: "I_GLIFT", name: "Lift lobby", rect: [9, -8, 13, -2], kind: "lobby", nodeId: "G_LIFT" },
        { id: "I_CANTEEN", name: "Canteen", rect: [13, -8, 16, -2], kind: "room" },
        { id: "I_RECEP", name: "Reception", rect: [6, -2, 14, 2], kind: "lobby", nodeId: "G_LOBBY" },
        { id: "I_VEST", name: "Entrance", rect: [14, -2, 16, 2], kind: "lobby", nodeId: "MAIN_EXIT" },
        { id: "I_WC", name: "WC", rect: [6, 2, 10, 6], kind: "ancillary" },
        { id: "I_MEET", name: "Training", rect: [10, 2, 16, 6], kind: "room" },
      ],
      openings: [
        { axis: "z", at: -16, from: 2, to: 4.2, kind: "exit" },
        { axis: "z", at: 16, from: -1, to: 1, kind: "exit" },
        { axis: "z", at: 6, from: -1.6, to: 0.6, kind: "open" },
        { axis: "x", at: -2, from: 10, to: 12, kind: "open" },
        { axis: "z", at: 14, from: -1.4, to: 1.4, kind: "open" },
        { axis: "x", at: -2, from: 7, to: 8, kind: "door" },
        { axis: "x", at: -2, from: 14, to: 15, kind: "door" },
        { axis: "x", at: 2, from: 7, to: 8, kind: "door" },
        { axis: "x", at: 2, from: 12, to: 13, kind: "door" },
        { axis: "x", at: 2, from: 10.4, to: 11.6, kind: "open", connectionId: "EVAC_LIFT" },
      ],
    },
    {
      floor: 1,
      name: "First floor",
      footprint: [6, -8, 16, 6],
      voids: [[6, -5.8, 7, -4.2]],
      spaces: [
        { id: "I_FWEST", name: "Stair landing", rect: [6, -7, 9, -3], kind: "lobby", nodeId: "F_WEST" },
        { id: "I_FSTORE", name: "Store", rect: [6, -8, 9, -7], kind: "ancillary" },
        { id: "I_PRINT", name: "Print", rect: [6, -3, 9, 0], kind: "ancillary" },
        { id: "I_FLIFT", name: "Lift lobby", rect: [9, -8, 13, -2], kind: "lobby", nodeId: "F_LIFT" },
        { id: "I_KITCH", name: "Kitchenette", rect: [13, -8, 16, -2], kind: "room" },
        { id: "I_FCORR", name: "Corridor", rect: [9, -2, 13, 0], kind: "circulation" },
        { id: "I_COMMS", name: "Comms", rect: [13, -2, 16, 0], kind: "ancillary" },
        { id: "I_OFFICE", name: "Design office", rect: [6, 0, 16, 6], kind: "room", nodeId: "OFFICE" },
      ],
      fixtures: [
        [7, 3.5, 9.5, 4.5, 0.75],
        [12.5, 3.5, 15, 4.5, 0.75],
        [7, 1.2, 9.5, 2, 0.75],
      ],
      openings: [
        { axis: "z", at: 6, from: -5.9, to: -4.1, kind: "open" },
        { axis: "z", at: 9, from: -6, to: -4, kind: "open" },
        { axis: "x", at: -2, from: 10, to: 12, kind: "open" },
        { axis: "x", at: 0, from: 10, to: 12, kind: "door" },
        { axis: "z", at: 13, from: -6, to: -4, kind: "door" },
        { axis: "x", at: -3, from: 7, to: 8, kind: "door" },
        { axis: "z", at: 13, from: -1.5, to: -0.5, kind: "door" },
        { axis: "x", at: -7, from: 7, to: 8, kind: "door" },
      ],
    },
  ],
};

export const industrialFireScenario: Scenario = {
  id: "FIRE_ALARM",
  name: "Fire alarm: lift L1 recalled",
  blockedConnectionIds: ["L1"],
};

/** Plausible but ineffective: a second staircase still is not step-free. */
export const industrialInvalidRepair: Repair = {
  kind: "add_connection",
  connection: { id: "STAIR_2", from: "OFFICE", to: "G_LOBBY", length: 8, stepFree: false, floor: 0, kind: "stairs" },
  cost: 38000,
};

/** Valid: an evacuation lift with secondary power from the office to reception. */
export const industrialValidRepair: Repair = {
  kind: "add_connection",
  connection: { id: "EVAC_LIFT", from: "OFFICE", to: "G_LOBBY", length: 6, stepFree: true, floor: 0, kind: "lift", evacuationLift: true },
  cost: 96000,
};
