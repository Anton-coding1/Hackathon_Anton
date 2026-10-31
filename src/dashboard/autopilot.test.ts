import { describe, expect, it } from "vitest";
import type { Building, Repair, Scenario } from "@/contracts/types";
import { PRESETS } from "@/data/buildings";
import { certify, withConnection, withConnections } from "@/engine";
import { DEFAULT_RATES } from "@/cost/costModel";
import { fallbackAttack, fallbackRepair } from "./fallbackAgents";

function applyFix(b: Building, r: Repair): Building {
  if (r.kind === "add_connection") return withConnection(b, r.connection);
  if (r.kind === "add_connections") return withConnections(b, r.connections);
  if (r.kind === "upgrade_lift") return { ...b, connections: b.connections.map((c) => (r.connectionIds.includes(c.id) ? { ...c, evacuationLift: true } : c)) };
  return b;
}

const ALL = { corridor: true, stairs: true, lift: true, ramp: true, unblock: false };

function harden(b0: Building, tolerance: number, budget: number) {
  let b = b0;
  let spent = 0;
  const regs: Scenario[] = [];
  const log: string[] = [];
  for (let i = 0; i < 30; i++) {
    const fa = i === 0 ? fallbackAttack(b, []) : null;
    if (fa && fa.scenario.id === "FIRE_ALARM") {
      regs.push(fa.scenario);
      const fx = fallbackRepair(b, fa.scenario, regs, budget - spent, DEFAULT_RATES, ALL);
      if (!fx || fx.repair.kind === "unblock_connection") return { b, spent, log, faultFree: false, stuckOn: "fire" };
      b = applyFix(b, fx.repair);
      spent += fx.repair.cost;
      log.push(`FIRE ALARM -> ${"label" in fx.repair ? fx.repair.label : "single"} £${fx.repair.cost}`);
    }
    const cert = certify(b, tolerance, [], { skipEvacuationLifts: true });
    if (cert.faultFree) return { b, spent, log, faultFree: true, checked: cert.scenariosChecked };
    const s = cert.failures[0].scenario;
    regs.push(s);
    const fix = fallbackRepair(b, s, regs, budget - spent, DEFAULT_RATES, ALL);
    if (!fix || fix.repair.kind === "unblock_connection") return { b, spent, log, faultFree: false, stuckOn: s.name };
    b = applyFix(b, fix.repair);
    spent += fix.repair.cost;
    log.push(`${s.name} -> ${fix.repair.kind === "add_connection" ? `${fix.repair.connection.kind} ${fix.repair.connection.from}-${fix.repair.connection.to}` : "label" in fix.repair ? fix.repair.label : ""} £${fix.repair.cost}`);
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

describe("generated tower and hospital", () => {
  it("tower: fire alarm strands both wheelchair users; scripted stairs rejected, evac lift accepted", async () => {
    const { simulate, auditRepair } = await import("@/engine");
    const t = PRESETS.tower;
    const fire = t.scenarios.find((s) => s.id === "fire")!.scenario;
    const r = simulate(t.building, fire);
    expect(r.unreachableOccupantIds.length).toBe(2);
    const [bad, good] = t.scripted!.repairs;
    expect(auditRepair(t.building, fire, bad.repair, [fire], 300000).accepted).toBe(false);
    expect(auditRepair(t.building, fire, good.repair, [fire], 300000).accepted).toBe(true);
  });
  it("hospital: fire alarm strands all three patients; evac lift fixes it", async () => {
    const { simulate, auditRepair } = await import("@/engine");
    const h = PRESETS.hospital;
    const fire = h.scenarios.find((s) => s.id === "fire")!.scenario;
    expect(simulate(h.building, fire).unreachableOccupantIds.length).toBe(3);
    expect(auditRepair(h.building, fire, h.scripted!.repairs[1].repair, [fire], 250000).accepted).toBe(true);
  });
  it("tower and hospital reach fault-free (any 1 failure) within budget, fast", () => {
    for (const id of ["tower", "hospital"] as const) {
      const t0 = performance.now();
      const r = harden(PRESETS[id].building, 1, PRESETS[id].defaultBudget);
      console.log(id, r.faultFree, r.spent, `${Math.round(performance.now() - t0)}ms`, r.log);
      expect(r.faultFree).toBe(true);
    }
  });
});
