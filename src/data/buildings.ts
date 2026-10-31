import type { Building, Repair, Scenario } from "@/contracts/types";
import { blockedD4Scenario, demoBuilding, invalidDemoRepair, validDemoRepair } from "./demoBuilding";
import { demoPlan, type BuildingPlan } from "./demoPlan";
import { industrialBuilding, industrialFireScenario, industrialInvalidRepair, industrialPlan, industrialValidRepair } from "./industrialBuilding";
import { generateBuilding, liftRecallScenario } from "./generator";

export type PresetId = "clinic" | "industrial" | "tower" | "hospital" | "custom";

export type BuildingPreset = {
  id: PresetId;
  title: string;
  sector: string;
  summary: string;
  building: Building;
  plan?: BuildingPlan;
  defaultBudget: number;
  /** Resilience target: survive any combination of this many connection failures. */
  defaultTolerance: 1 | 2;
  /** Tall buildings read better stacked than exploded. */
  defaultExploded?: boolean;
  /** Scenario toggles for the landing-page demo. */
  scenarios: { id: string; label: string; scenario: Scenario }[];
  /** Pre-written proposals for the guaranteed-rejection demo (verdicts are always live). */
  scripted?: { attack: Scenario; attackReason: string; repairs: { repair: Repair; reasoning: string }[] };
};

const base: Scenario = { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] };

const tower = generateBuilding({
  id: "riverside-tower",
  name: "Riverside Tower (fictional)",
  storeys: 7,
  lifts: 1,
  evacLifts: false,
  fixtures: "flats",
  bayName: (f, side, b) => `Flat ${f}${String.fromCharCode(65 + (side === "N" ? b : b + 5))}`,
  groundName: (side, b) => (side === "N" ? ["Bike store", "Concierge", "", "Post room", "Gym"][b] : ["Lounge", "Parcel room", "", "Cinema", "Workspace"][b]),
  occupants: [
    { floor: 0, side: "N", bay: 1, label: "Concierge", stepFree: false },
    { floor: 2, side: "N", bay: 0, label: "Resident", stepFree: false },
    { floor: 3, side: "S", bay: 3, label: "Wheelchair user", stepFree: true },
    { floor: 5, side: "N", bay: 3, label: "Resident with toddler", stepFree: false },
    { floor: 6, side: "S", bay: 1, label: "Wheelchair user", stepFree: true },
  ],
});

const hospital = generateBuilding({
  id: "st-aldric",
  name: "St Aldric's Hospital (fictional)",
  storeys: 4,
  lifts: 2,
  evacLifts: false,
  fixtures: "beds",
  bayName: (f, side, b) => (side === "N" ? [`Ward ${f}A`, `Ward ${f}B`, "", `Ward ${f}C`, `Ward ${f}D`][b] : [`Bay ${f}1`, "Sluice", "Nurses' station", `Bay ${f}2`, "Treatment"][b]),
  groundName: (side, b) => (side === "N" ? ["Pharmacy", "Reception", "", "Imaging", "A&E triage"][b] : ["Café", "Chapel", "", "Outpatients", "Records"][b]),
  occupants: [
    { floor: 0, side: "N", bay: 1, label: "Receptionist", stepFree: false },
    { floor: 1, side: "S", bay: 0, label: "Patient on trolley", stepFree: true },
    { floor: 2, side: "N", bay: 3, label: "Patient in bed", stepFree: true },
    { floor: 2, side: "S", bay: 3, label: "Nurse", stepFree: false },
    { floor: 3, side: "N", bay: 0, label: "Patient in wheelchair", stepFree: true },
  ],
});

/** A new evacuation lift beside the existing car: one stop per floor, all built as one change. */
function evacLiftBundle(b: Building, lobbyPrefix: string, storeys: number): Repair {
  const connections = Array.from({ length: storeys - 1 }, (_, i) => ({
    id: `EVAC_${i + 1}`,
    from: `F${i + 1}_${lobbyPrefix}`,
    to: `F0_${lobbyPrefix}`,
    length: Math.round((4 + (i + 1) * 4.5) * 10) / 10,
    stepFree: true,
    floor: 0,
    kind: "lift" as const,
    evacuationLift: true,
  }));
  return { kind: "add_connections", connections, cost: 0, label: `New evacuation lift serving all ${storeys} floors (${storeys} stops)` };
}

/** Looks sensible, but stairs are no use to someone who cannot use stairs. */
function extraStairBundle(storeys: number): Repair {
  const connections = Array.from({ length: storeys - 1 }, (_, i) => ({
    id: `XSTAIR_${i + 1}`,
    from: `F${i + 1}_C3`,
    to: `F${i}_C3`,
    length: 10,
    stepFree: false,
    floor: i,
    kind: "stairs" as const,
  }));
  return { kind: "add_connections", connections, cost: 0, label: `Third staircase through the central core (${storeys - 1} flights)` };
}

export const PRESETS = {
  clinic: {
    id: "clinic",
    title: "Blackwood Hall",
    sector: "Healthcare clinic · 2 storeys",
    summary: "A clinic wing where one jammed lobby door leaves a wheelchair user with no step-free exit.",
    building: demoBuilding,
    plan: demoPlan,
    defaultBudget: 1000000,
    defaultTolerance: 2,
    scenarios: [
      { id: "base", label: "Ordinary day", scenario: base },
      { id: "d4", label: "Lobby door jammed", scenario: blockedD4Scenario },
      { id: "d2", label: "West stair closed", scenario: { id: "BLOCK_D2", name: "West stair D2 closed", blockedConnectionIds: ["D2"] } },
      { id: "d2d5", label: "Both stairs closed", scenario: { id: "BLOCK_D2_D5", name: "Both stairs closed", blockedConnectionIds: ["D2", "D5"] } },
    ],
    scripted: {
      attack: blockedD4Scenario,
      attackReason: "D4 is the last step-free link between the east lobby and an exit.",
      repairs: [
        { repair: invalidDemoRepair, reasoning: "Add a second door from Clinic 102 to the East Lobby so the clinic is better connected." },
        { repair: validDemoRepair, reasoning: "Add a step-free corridor from Clinic 102 to the West Exit, independent of the east lobby." },
      ],
    },
  },
  industrial: {
    id: "industrial",
    title: "Northfield Works",
    sector: "Light industrial · warehouse + offices",
    summary: "In a fire alarm the passenger lift is recalled, cutting the first-floor office off for anyone who can't use stairs.",
    building: industrialBuilding,
    plan: industrialPlan,
    defaultBudget: 1000000,
    defaultTolerance: 1,
    scenarios: [
      { id: "base", label: "Ordinary day", scenario: base },
      { id: "fire", label: "Fire alarm · lift recalled", scenario: industrialFireScenario },
      { id: "s1", label: "Mezzanine stair blocked", scenario: { id: "BLOCK_S1", name: "Mezzanine stair S1 blocked", blockedConnectionIds: ["S1"] } },
      { id: "c3", label: "Main entrance blocked", scenario: { id: "BLOCK_C3", name: "Main entrance C3 blocked", blockedConnectionIds: ["C3"] } },
    ],
    scripted: {
      attack: industrialFireScenario,
      attackReason: "In a fire alarm L1 is recalled; it is the only step-free way down from the design office.",
      repairs: [
        { repair: industrialInvalidRepair, reasoning: "Add a second staircase from the design office to reception for a shorter escape." },
        { repair: industrialValidRepair, reasoning: "Install an evacuation lift with secondary power from the design office to reception." },
      ],
    },
  },
} as Record<"clinic" | "industrial" | "tower" | "hospital", BuildingPreset>;

Object.assign(PRESETS, {
  tower: {
    id: "tower",
    title: "Riverside Tower",
    sector: "Residential · 7 storeys · 1 lift",
    summary: "A seven-storey apartment block with two stairs and one lift. In a fire alarm the lift is recalled and the wheelchair users on levels 3 and 6 have no way down.",
    building: tower.building,
    plan: tower.plan,
    defaultBudget: 1000000,
    defaultTolerance: 1,
    defaultExploded: false,
    scenarios: [
      { id: "base", label: "Ordinary day", scenario: { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] } },
      { id: "fire", label: "Fire alarm · lift recalled", scenario: liftRecallScenario(tower.building) },
      { id: "corr", label: "Level 3 fire door jammed", scenario: { id: "BLOCK_F3_CR3", name: "Level 3 corridor fire door jammed", blockedConnectionIds: ["F3_CR3"] } },
      { id: "stair", label: "West stair smoke-logged", scenario: { id: "BLOCK_WSTAIR", name: "West stair smoke-logged (levels 1–6)", blockedConnectionIds: ["WSTAIR_1", "WSTAIR_2", "WSTAIR_3", "WSTAIR_4", "WSTAIR_5", "WSTAIR_6"] } },
    ],
    scripted: {
      attack: liftRecallScenario(tower.building),
      attackReason: "The only lift is a passenger lift. In a fire alarm it is recalled, and two residents cannot use stairs.",
      repairs: [
        { repair: extraStairBundle(7), reasoning: "Add a third staircase through the central core so everyone has a shorter way down." },
        { repair: evacLiftBundle(tower.building, "L", 7), reasoning: "Install an evacuation lift with secondary power beside the existing car, stopping at every floor." },
      ],
    },
  },
  hospital: {
    id: "hospital",
    title: "St Aldric's Hospital",
    sector: "Hospital · 4 storeys · 2 bed lifts",
    summary: "A ward block where three patients cannot use stairs. Both bed lifts are ordinary passenger lifts, so a fire alarm strands every one of them.",
    building: hospital.building,
    plan: hospital.plan,
    defaultBudget: 1000000,
    defaultTolerance: 1,
    defaultExploded: false,
    scenarios: [
      { id: "base", label: "Ordinary day", scenario: { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] } },
      { id: "fire", label: "Fire alarm · lifts recalled", scenario: liftRecallScenario(hospital.building) },
      { id: "liftA", label: "Lift A out of service", scenario: { id: "LIFT_A_DOWN", name: "Lift A out of service", blockedConnectionIds: ["LIFTA_1", "LIFTA_2", "LIFTA_3"] } },
      { id: "corr", label: "Level 2 corridor blocked", scenario: { id: "BLOCK_F2_CR3", name: "Level 2 corridor blocked", blockedConnectionIds: ["F2_CR3"] } },
    ],
    scripted: {
      attack: liftRecallScenario(hospital.building),
      attackReason: "Both bed lifts are passenger lifts. A fire alarm recalls them and three patients cannot use stairs.",
      repairs: [
        { repair: extraStairBundle(4), reasoning: "Add a third staircase through the central core to speed up evacuation." },
        { repair: evacLiftBundle(hospital.building, "LA", 4), reasoning: "Upgrade to an evacuation lift with secondary power alongside lift A, stopping at every ward floor." },
      ],
    },
  },
});

export function customPreset(building: Building): BuildingPreset {
  return {
    id: "custom",
    title: building.name,
    sector: "Uploaded building",
    summary: "Your uploaded floor plan, analysed by the same agents and judge.",
    building,
    defaultBudget: 1000000,
    defaultTolerance: 1,
    scenarios: [{ id: "base", label: "Ordinary day", scenario: base }],
  };
}

export const CUSTOM_STORAGE_KEY = "exitzero.customBuilding";
