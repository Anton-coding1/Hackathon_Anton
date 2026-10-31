import { describe, expect, it } from "vitest";
import {
  industrialBuilding as b,
  industrialFireScenario,
  industrialInvalidRepair,
  industrialValidRepair,
} from "@/data/industrialBuilding";
import { auditRepair, fireAlarmScenario, simulate } from "./index";

describe("industrial unit with lifts", () => {
  it("baseline: everyone out, step-free occupant uses the lift", () => {
    const r = simulate(b, { id: "BASE", name: "base", blockedConnectionIds: [] });
    expect(r.unreachableOccupantIds).toEqual([]);
    expect(r.paths.O2).toEqual(["OFFICE", "F_LIFT", "G_LIFT", "G_LOBBY", "MAIN_EXIT"]);
  });

  it("fire alarm recalls non-evacuation lifts and strands the wheelchair user only", () => {
    const s = fireAlarmScenario(b);
    expect(s.blockedConnectionIds).toEqual(["L1"]);
    const r = simulate(b, s);
    expect(r.unreachableOccupantIds).toEqual(["O2"]);
    expect(r.paths.O3).toContain("STAIR_FOOT");
    expect(r.explanations.join(" ")).toMatch(/while lift L1 is out of service/);
  });

  it("judge rejects a second staircase and accepts an evacuation lift", () => {
    const bad = auditRepair(b, industrialFireScenario, industrialInvalidRepair, [industrialFireScenario], 150000);
    expect(bad.accepted).toBe(false);
    expect(bad.reasons[0]).toMatch(/does not restore an eligible route for O2/);
    const good = auditRepair(b, industrialFireScenario, industrialValidRepair, [industrialFireScenario], 150000);
    expect(good.accepted).toBe(true);
    expect(good.after.paths.O2).toEqual(["OFFICE", "G_LOBBY", "MAIN_EXIT"]);
    // a new evacuation lift is not recalled in the next fire alarm
    expect(fireAlarmScenario({ ...b, connections: [...b.connections, (industrialValidRepair as unknown as { connection: never }).connection] }).blockedConnectionIds).toEqual(["L1"]);
  });

  it("rejects a step-free link between floors unless it is a lift or ramp", () => {
    const fake = { ...industrialValidRepair, connection: { ...(industrialValidRepair as { connection: object }).connection, kind: "corridor" } } as never;
    expect(auditRepair(b, industrialFireScenario, fake, [], 150000).accepted).toBe(false);
  });
});
