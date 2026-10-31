import { describe, expect, it } from "vitest";
import type { Building, Scenario } from "@/contracts/types";
import { PRESETS } from "@/data/buildings";
import { certify, withConnection } from "@/engine";
import { DEFAULT_RATES } from "@/cost/costModel";
import { fallbackRepair } from "./fallbackAgents";

const ALL = { corridor: true, stairs: true, lift: true, ramp: true, unblock: false };

function harden(b0: Building, tolerance: number, budget: number) {
  let b = b0;
  let spent = 0;
  const regs: Scenario[] = [];
  const log: string[] = [];
  for (let i = 0; i < 12; i++) {
    const cert = certify(b, tolerance);
    if (cert.faultFree) return { b, spent, log, faultFree: true, checked: cert.scenariosChecked };
    const s = cert.failures[0].scenario;
    regs.push(s);
    const fix = fallbackRepair(b, s, regs, budget - spent, DEFAULT_RATES, ALL);
    if (!fix || fix.repair.kind !== "add_connection") return { b, spent, log, faultFree: false, stuckOn: s.name };
    b = withConnection(b, fix.repair.connection);
    spent += fix.repair.cost;
    log.push(`${s.name} -> ${fix.repair.connection.kind} ${fix.repair.connection.from}-${fix.repair.connection.to} £${fix.repair.cost}`);
  }
  return { b, spent, log, faultFree: false };
}

describe("deterministic autopilot reaches a fault-free building", () => {
  it("clinic, any 2 failures", () => {
    const r = harden(PRESETS.clinic.building, 2, 200000);
    console.log("clinic t2", r.spent, r.log);
    expect(r.faultFree).toBe(true);
    expect(r.log.some((l) => l.includes("stairs"))).toBe(true);
  });
  it("industrial, any 1 failure", () => {
    const r = harden(PRESETS.industrial.building, 1, 400000);
    console.log("industrial t1", r.spent, r.log);
    expect(r.faultFree).toBe(true);
  });
  it("industrial, any 2 failures", () => {
    const r = harden(PRESETS.industrial.building, 2, 1000000);
    console.log("industrial t2", r.spent, r.log, r.faultFree, (r as { stuckOn?: string }).stuckOn);
  });
});
