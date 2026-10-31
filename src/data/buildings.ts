import type { Building, Repair, Scenario } from "@/contracts/types";
import { blockedD4Scenario, demoBuilding, invalidDemoRepair, validDemoRepair } from "./demoBuilding";
import { demoPlan, type BuildingPlan } from "./demoPlan";
import { industrialBuilding, industrialFireScenario, industrialInvalidRepair, industrialPlan, industrialValidRepair } from "./industrialBuilding";

export type PresetId = "clinic" | "industrial" | "custom";

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
  /** Scenario toggles for the landing-page demo. */
  scenarios: { id: string; label: string; scenario: Scenario }[];
  /** Pre-written proposals for the guaranteed-rejection demo (verdicts are always live). */
  scripted?: { attack: Scenario; attackReason: string; repairs: { repair: Repair; reasoning: string }[] };
};

const base: Scenario = { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] };

export const PRESETS: Record<"clinic" | "industrial", BuildingPreset> = {
  clinic: {
    id: "clinic",
    title: "Blackwood Hall",
    sector: "Healthcare clinic · 2 storeys",
    summary: "A clinic wing where one jammed lobby door leaves a wheelchair user with no step-free exit.",
    building: demoBuilding,
    plan: demoPlan,
    defaultBudget: 80000,
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
    defaultBudget: 150000,
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
};

export function customPreset(building: Building): BuildingPreset {
  return {
    id: "custom",
    title: building.name,
    sector: "Uploaded building",
    summary: "Your uploaded floor plan, analysed by the same agents and judge.",
    building,
    defaultBudget: 150000,
    defaultTolerance: 1,
    scenarios: [{ id: "base", label: "Ordinary day", scenario: base }],
  };
}

export const CUSTOM_STORAGE_KEY = "exitzero.customBuilding";
