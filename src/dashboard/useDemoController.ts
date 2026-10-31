"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Building, FailurePassport, Repair, RepairAudit, Scenario, TestResult } from "@/contracts/types";
import type { BuildingPreset } from "@/data/buildings";
import { addedConnections, auditRepair, certify, validateRepair, describeBlocked, occupantWeights, simulate, withConnection, withConnections, type Certificate } from "@/engine";
import { DEFAULT_RATES, withModelledCost, type CostEstimate, type CostRates } from "@/cost/costModel";
import { fallbackAttack, fallbackRepair, repairKind } from "./fallbackAgents";
import { minimumPlan, nextFromPlan, type PlannedFix } from "./budgetPlanner";

export type Source = "gemini" | "fallback" | "judge" | "scripted";
export type Phase = "idle" | "alarm" | "sweeping" | "attacking" | "attacked" | "defending" | "proposed" | "auditing" | "approval" | "accepted" | "rejected";
export type LogEntry = { id: number; at: number; role: "attacker" | "defender" | "judge" | "manual" | "system"; text: string; tone?: "bad" | "good" | "warn" | "ai" };
export type PassportMeta = { createdAt: number; source: Source; attempts: number };
export type GeminiStatus = { checked: boolean; configured: boolean; model: string; fastModel?: string; status?: "ok" | "no-key" | "invalid-key" | "model-unavailable" | "unreachable"; detail?: string };
export type RepairKind = "corridor" | "stairs" | "lift" | "ramp" | "unblock";
const NO_BUDGET_LIMIT = 1_000_000_000;

export type Constraints = { budget: number; liftsRecalled: boolean; tolerance: 1 | 2; approveOver: number; allow: Record<RepairKind, boolean> };
export type Fix = { scenario: Scenario; stranded: string[]; repair: Repair; source: Source; attempts: number; rejected: number };
export type Report = {
  status: "fault-free" | "stuck" | "stopped" | "over-budget";
  certificate: Certificate;
  fixes: Fix[];
  totalCost: number;
  remaining?: Scenario;
  at: number;
  /** The budget the user gave, and (if not everyone is safe) what it would cost on top to get there. */
  budget?: number;
  extraNeeded?: number;
};
export type Proposal = { repair: Repair; reasoning: string; source: Source; attempt: number; aiCost?: number; estimate: CostEstimate; model?: string } | null;
export type AgentRuns = { attacker: number; defender: number; judge: number; geminiCalls: number; fallbackCalls: number; regressionChecks: number };

type AttackInfo = { reasoning: string; source: Source } | null;
type Feedback = { repair: Repair; reasons: string[] };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASELINE: Scenario = { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] };
const ZERO_RUNS: AgentRuns = { attacker: 0, defender: 0, judge: 0, geminiCalls: 0, fallbackCalls: 0, regressionChecks: 0 };

export function defaultConstraints(preset: BuildingPreset): Constraints {
  // No budget to pick: the agents find the minimum cost that gets everyone out.
  return { budget: NO_BUDGET_LIMIT, liftsRecalled: false, tolerance: preset.defaultTolerance, approveOver: Number.POSITIVE_INFINITY, allow: { corridor: true, stairs: true, lift: true, ramp: true, unblock: true } };
}

/** Non-evacuation lifts, which are recalled when lifts are assumed unusable in an emergency. */
function recalledLifts(b: Building): string[] {
  return b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id);
}

export function useDemoController(preset: BuildingPreset, constraints: Constraints) {
  const [building, setBuilding] = useState<Building>(preset.building);
  const [rawScenario, setRawScenario] = useState<Scenario>(BASELINE);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [attackInfo, setAttackInfo] = useState<AttackInfo>(null);
  const [proposal, setProposal] = useState<Proposal>(null);
  const [audit, setAudit] = useState<RepairAudit | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [passports, setPassports] = useState<FailurePassport[]>([]);
  const [passportMeta, setPassportMeta] = useState<Record<string, PassportMeta>>({});
  const [regressions, setRegressions] = useState<Scenario[]>([]);
  const [tested, setTested] = useState<Scenario[]>([]);
  const [spent, setSpent] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [gemini, setGemini] = useState<GeminiStatus>({ checked: false, configured: false, model: "" });
  const [rates, setRates] = useState<CostRates>(DEFAULT_RATES);
  const [ratesNote, setRatesNote] = useState<string>("");
  const [ratesLoading, setRatesLoading] = useState(false);
  const [verdictFlash, setVerdictFlash] = useState<{ key: number; accepted: boolean; text: string } | null>(null);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [runs, setRuns] = useState<AgentRuns>(ZERO_RUNS);
  const [autopilot, setAutopilot] = useState(false);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const alarmRef = useRef(false);
  alarmRef.current = alarm;
  const [preview, setPreview] = useState<{ scenario: Scenario; result: TestResult } | null>(null);
  const [sweep, setSweep] = useState<{ index: number; total: number; label: string; ok: boolean; trapped: number; title: string } | null>(null);
  const [approval, setApproval] = useState<{ proposal: NonNullable<Proposal>; scenarioName: string; resolve: (ok: boolean) => void } | null>(null);
  const logId = useRef(0);
  // Demo time box: Gemini is used for the headline attack and fix in the first ~14 s; the rest is instant search.
  const demoStart = useRef(0);
  const geminiWindow = () => demoStart.current === 0 || Date.now() - demoStart.current < 14000;
  const runToken = useRef(0);

  /** Applies the emergency-lift assumption on top of any scenario. */
  const effective = useCallback(
    (s: Scenario, b: Building = building): Scenario => {
      if (!constraints.liftsRecalled && !alarm) return s;
      const lifts = recalledLifts(b).filter((id) => !s.blockedConnectionIds.includes(id));
      if (!lifts.length) return s;
      return { id: `${s.id}+LIFTS_RECALLED`, name: `${s.name} · lifts recalled`, blockedConnectionIds: [...s.blockedConnectionIds, ...lifts].sort() };
    },
    [building, constraints.liftsRecalled, alarm],
  );

  const scenario = useMemo(() => effective(rawScenario), [effective, rawScenario]);
  // The ONLY source of displayed results: the deterministic engine.
  const result: TestResult = useMemo(() => simulate(building, scenario), [building, scenario]);
  const budgetLeft = constraints.budget - spent;
  // Live exhaustive check of every combination of up to `tolerance` failures.
  const certificate: Certificate = useMemo(
    () => certify(building, constraints.tolerance, constraints.liftsRecalled || alarm ? recalledLifts(building) : [], { skipEvacuationLifts: true }),
    [building, constraints.tolerance, constraints.liftsRecalled, alarm],
  );

  // Everything async reads the latest state from here, so manual steps and loops share one implementation.
  const S = useRef({ building, scenario, regressions, budgetLeft, gemini, rates, tested, constraints, feedback, proposal, fixes, spent });
  S.current = { building, scenario, regressions, budgetLeft, gemini, rates, tested, constraints, feedback, proposal, fixes, spent };

  const say = useCallback((role: LogEntry["role"], text: string, tone?: LogEntry["tone"]) => {
    setLog((l) => [...l.slice(-80), { id: ++logId.current, at: Date.now(), role, text, tone }]);
  }, []);
  const bump = (k: keyof AgentRuns, n = 1) => setRuns((r) => ({ ...r, [k]: r[k] + n }));

  useEffect(() => {
    fetch("/api/agents?check=1")
      .then((r) => r.json())
      .then((j) => setGemini({ checked: true, configured: Boolean(j?.data?.configured), model: j?.data?.model ?? "", fastModel: j?.data?.fastModel, status: j?.data?.status, detail: j?.data?.detail }))
      .catch(() => setGemini({ checked: true, configured: false, model: "" }));
    say("system", `${preset.title} loaded. Every result shown is computed by the deterministic graph engine.`);
  }, [say, preset.title]);

  const loadRates = useCallback(
    async (refresh = false) => {
      setRatesLoading(true);
      try {
        const j = await fetch(`/api/cost${refresh ? "?refresh=1" : ""}`).then((r) => r.json());
        if (j?.data) setRates(j.data);
        setRatesNote(j?.note ?? "");
        if (j?.data?.source === "gemini-search") say("system", `Cost model updated from live web sources via Gemini + Google Search (${j.data.sources?.length ?? 0} sources).`, "good");
      } catch {
        setRatesNote("Could not reach the cost service; using built-in indicative rates.");
      } finally {
        setRatesLoading(false);
      }
    },
    [say],
  );
  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const callAgents = async (body: Record<string, unknown>) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 11000);
    const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal }).finally(() => clearTimeout(t));
    const json = await res.json().catch(() => ({ success: false, error: "Bad response from /api/agents" }));
    if (!json.success) throw new Error(json.error ?? `Agent request failed (${res.status})`);
    return json.data;
  };

  const recordFailure = useCallback((s: Scenario, r: TestResult, source: Source) => {
    if (r.unreachableOccupantIds.length === 0) return;
    setRegressions((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
    setPassports((prev) => {
      if (prev.some((p) => p.scenario.id === s.id && !p.audit?.accepted)) return prev;
      const id = `FP-${String(prev.length + 1).padStart(3, "0")}`;
      setPassportMeta((m) => ({ ...m, [id]: { createdAt: Date.now(), source, attempts: 0 } }));
      return [...prev, { id, scenario: s, result: r }];
    });
  }, []);

  /** Sets the active disruption (raw, before the lift assumption) and records any failure. */
  const applyScenario = useCallback(
    (raw: Scenario, source: Source, reasoning: string) => {
      const b = S.current.building;
      const s = effective(raw, b);
      const r = simulate(b, s);
      setRawScenario(raw);
      setAttackInfo({ reasoning, source });
      setProposal(null);
      setAudit(null);
      setFeedback([]);
      setTested((t) => (t.some((x) => x.id === raw.id) ? t : [...t, raw]));
      recordFailure(s, r, source);
      say(source === "judge" ? "manual" : "attacker", r.unreachableOccupantIds.length ? `${s.name}: ${r.unreachableOccupantIds.join(", ")} stranded (${r.reachableCount}/${r.totalCount} reachable).` : `${s.name}: everyone still has a route (${r.reachableCount}/${r.totalCount}).`, r.unreachableOccupantIds.length ? "bad" : "good");
      return { scenario: s, result: r };
    },
    [effective, recordFailure, say],
  );

  /* ---------------- attacker ---------------- */
  const attack = useCallback(async (): Promise<{ scenario: Scenario; result: TestResult } | null> => {
    const { building: b, gemini: g, tested: t, constraints: con } = S.current;
    setBusy(true);
    setPhase("attacking");
    bump("attacker");
    say("attacker", g.configured ? `Gemini (${g.model}) is searching for a weakness…` : "Searching for a weakness…", "ai");
    try {
      let raw: Scenario;
      let reasoning = "";
      let source: Source = "gemini";
      try {
        if (!g.configured || !geminiWindow()) throw new Error(g.configured ? "time box" : "not configured");
        bump("geminiCalls");
        const data = await callAgents({ action: "attack", building: b, prior: t.map((x) => ({ scenario: x })), maxBlocked: con.tolerance, tier: "lead" });
        raw = data.scenario;
        reasoning = data.reasoning || "";
        await wait(80);
      } catch (e) {
        if (g.configured) say("system", `Gemini attack failed (${e instanceof Error ? e.message : e}). Using deterministic search.`, "warn");
        bump("fallbackCalls");
        await wait(150);
        const fb = fallbackAttack(b, t, con.tolerance);
        if (!fb) {
          say("attacker", "No untested disruptions left.", "warn");
          setPhase("idle");
          return null;
        }
        ({ scenario: raw, reasoning } = fb);
        source = "fallback";
      }
      const out = applyScenario(raw, source, reasoning);
      setPhase("attacked");
      return out;
    } finally {
      setBusy(false);
    }
  }, [applyScenario, say]);

  /* ---------------- defender ---------------- */
  const defendFor = useCallback(
    async (s: Scenario, fb: Feedback[], tier: "lead" | "fast" = "lead"): Promise<Proposal> => {
      const { building: b, gemini: g, budgetLeft: left, regressions: regs, rates: rt, constraints: con } = S.current;
      const r = simulate(b, s);
      if (r.unreachableOccupantIds.length === 0) {
        say("defender", "Nothing to repair: everyone has a route in this scenario.", "warn");
        return null;
      }
      setBusy(true);
      setPhase("defending");
      setAudit(null);
      bump("defender");
      const useGemini = g.configured && fb.length < 1 && tier === "lead" && geminiWindow(); // after two rejections, a deterministic backstop keeps the run moving
      const modelName = tier === "fast" ? g.fastModel ?? "Flash" : g.model;
      say("defender", `${useGemini ? `${modelName} is designing` : "Designing"} repair attempt ${fb.length + 1}…`, "ai");
      try {
        let p: Proposal = null;
        try {
          if (!useGemini) throw new Error(g.configured ? "backstop" : "not configured");
          bump("geminiCalls");
          const allowed = (Object.keys(con.allow) as RepairKind[]).filter((k) => con.allow[k]);
          const data = await callAgents({ action: "defend", building: b, scenario: s, result: r, budget: Math.min(left, 5_000_000), feedback: fb, constraints: { allowed, rates: rt.rates }, tier });
          const priced = withModelledCost(data.repair, b, rt);
          p = { repair: priced.repair, estimate: priced.estimate, aiCost: data.repair.cost, reasoning: data.reasoning || "", source: "gemini", attempt: fb.length + 1, model: data.model };
          await wait(80);
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          if (g.configured) say("system", why === "backstop" ? "Two Gemini proposals were rejected; the deterministic defender takes this attempt." : `Gemini repair failed (${why}). Using deterministic repair search.`, "warn");
          bump("fallbackCalls");
          await wait(150);
          const f = fallbackRepair(b, s, [...regs, s], left, rt, con.allow);
          if (!f) {
            say("defender", "No repair within budget and design constraints passes the judge.", "warn");
            setPhase("attacked");
            return null;
          }
          p = { ...f, source: "fallback", attempt: fb.length + 1 };
        }
        setProposal(p);
        setPhase("proposed");
        say("defender", `Proposes ${describeRepair(p!.repair)} · modelled cost £${p!.repair.cost.toLocaleString("en-GB")}${p!.aiCost && p!.aiCost !== p!.repair.cost ? ` (AI estimated £${p!.aiCost.toLocaleString("en-GB")})` : ""}.`, "ai");
        return p;
      } finally {
        setBusy(false);
      }
    },
    [say],
  );

  /* ---------------- judge ---------------- */
  const judgeFor = useCallback(
    async (s: Scenario, p0: NonNullable<Proposal>, part?: { stillTrapped: string[]; enabling?: boolean }): Promise<RepairAudit> => {
      let p = p0;
      const { building: b, regressions: regs, budgetLeft: left, constraints: con } = S.current;
      const label = (ids: string[]) => ids.map((id) => b.occupants.find((o) => o.id === id)?.label ?? id).join(", ");
      setBusy(true);
      setPhase("auditing");
      bump("judge");
      const regSet = regs.some((x) => x.id === s.id) ? regs : [...regs, s];
      bump("regressionChecks", regSet.length);
      say("judge", `Re-solving the target scenario and ${regSet.length} stored regression(s)…`, "ai");
      await wait(250);
      let a: RepairAudit;
      if (part?.enabling) {
        // Needed together with a later change: on its own it rescues nobody yet, so check it traps nobody new.
        const problems = validateRepair(b, s, p.repair);
        const before = simulate(b, s);
        a = {
          accepted: problems.length === 0,
          cost: p.repair.cost,
          budget: left,
          before,
          after: before,
          regressions: [],
          reasons: problems.length ? problems.map((x) => `Rejected: ${x}`) : ["Accepted: this change works together with the next one; on its own it does not yet complete an escape route."],
        };
      } else if (part && part.stillTrapped.length) {
        // A combined fix: judge it strictly on the people it gets out; the rest need the next change.
        const focus = { ...b, occupants: b.occupants.filter((o) => !part.stillTrapped.includes(o.id)) };
        a = auditRepair(focus, s, p.repair, regSet, left);
        if (a.accepted) a = { ...a, reasons: [...a.reasons.slice(0, 1), `Part of a combined fix: ${label(part.stillTrapped)} still need${part.stillTrapped.length === 1 ? "s" : ""} the next change in this scenario.`, ...a.reasons.slice(1)] };
      } else {
        a = auditRepair(b, s, p.repair, regSet, left);
      }
      const kind = repairKind(p.repair);
      const reopenDoor = p.repair.kind === "unblock_connection" && b.connections.find((c) => c.id === (p.repair as { connectionId: string }).connectionId)?.kind !== "lift";
      if (autopilotRef.current && reopenDoor && a.accepted) {
        a = { ...a, accepted: false, after: a.before, reasons: ["Rejected: reopening a blocked door clears today's obstruction but adds no resilience; the building must survive this failure, so a structural change is needed."] };
      } else if (!con.allow[kind]) {
        a = { ...a, accepted: false, after: a.before, reasons: [`Rejected: design constraints do not allow ${kind === "unblock" ? "unblocking as a fix" : `new ${kind}s`}.`, ...a.reasons.filter((x) => !x.startsWith("Accepted"))] };
      }
      if (a.accepted && p.source === "gemini") {
        // The agents always ship the lowest-cost verified fix: race Argon's answer against the exhaustive search.
        const cheaper = fallbackRepair(b, s, regSet, left, S.current.rates, con.allow);
        if (cheaper && cheaper.repair.cost < p.repair.cost) {
          const a2 = auditRepair(b, s, cheaper.repair, regSet, left);
          if (a2.accepted) {
            say("judge", `Argon's fix works (£${p.repair.cost.toLocaleString("en-GB")}), but the search found a verified cheaper one: ${describeRepair(cheaper.repair)} for £${cheaper.repair.cost.toLocaleString("en-GB")}. Using the cheaper fix.`, "good");
            p = { ...p, repair: cheaper.repair, estimate: cheaper.estimate, reasoning: `${cheaper.reasoning} (cheaper than Argon's £${p.repair.cost.toLocaleString("en-GB")} proposal)`, source: "fallback" };
            setProposal(p);
            a = a2;
          }
        }
      }
      if (a.accepted && p.repair.cost > con.approveOver) {
        // People stay in control of money: big changes need a human yes.
        setAudit(a);
        setPhase("approval");
        say("judge", `Verified, but £${p.repair.cost.toLocaleString("en-GB")} is over your £${con.approveOver.toLocaleString("en-GB")} approval limit. Waiting for you.`, "warn");
        setBusy(false);
        const ok = await new Promise<boolean>((resolve) => setApproval({ proposal: p, scenarioName: s.name, resolve }));
        setApproval(null);
        setBusy(true);
        if (!ok) {
          a = { ...a, accepted: false, after: a.before, reasons: [`Declined by you: £${p.repair.cost.toLocaleString("en-GB")} was not approved. Propose something cheaper.`, ...a.reasons.filter((x) => !x.startsWith("Accepted"))] };
        } else {
          a = { ...a, reasons: [...a.reasons, "Approved by you."] };
        }
      }
      setAudit(a);
      setPassports((prev) => {
        const i = prev.map((x) => x.scenario.id).lastIndexOf(s.id);
        if (i === -1) return prev;
        const copy = [...prev];
        copy[i] = { ...copy[i], repair: p.repair, audit: a };
        setPassportMeta((m) => ({ ...m, [copy[i].id]: { ...(m[copy[i].id] ?? { createdAt: Date.now(), source: p.source }), attempts: p.attempt } }));
        return copy;
      });
      setVerdictFlash({ key: Date.now(), accepted: a.accepted, text: a.accepted ? "Change verified" : "Change rejected" });
      if (a.accepted) {
        say("judge", a.reasons[0], "good");
        if (p.repair.kind === "upgrade_lift") {
          const ids = new Set(p.repair.connectionIds);
          const nb = { ...b, connections: b.connections.map((c) => (ids.has(c.id) ? { ...c, evacuationLift: true } : c)) };
          S.current.building = nb;
          setBuilding(nb);
          setRawScenario((x) => ({ ...x, blockedConnectionIds: x.blockedConnectionIds.filter((y) => !ids.has(y)) }));
        } else if (p.repair.kind !== "unblock_connection") {
          const added = addedConnections(p.repair);
          const nb = withConnections(b, added);
          S.current.building = nb;
          setBuilding(nb);
          setAddedIds((ids) => [...ids, ...added.map((c) => c.id)]);
        } else {
          const id = p.repair.connectionId;
          setRawScenario((x) => ({ ...x, blockedConnectionIds: x.blockedConnectionIds.filter((y) => y !== id) }));
          if (b.connections.find((c) => c.id === id)?.kind === "lift") {
            // A lift upgraded with secondary power becomes an evacuation lift for good.
            const nb = { ...b, connections: b.connections.map((c) => (c.id === id ? { ...c, evacuationLift: true } : c)) };
            S.current.building = nb;
            setBuilding(nb);
          }
        }
        setSpent((x) => x + p.repair.cost);
        S.current.budgetLeft = left - p.repair.cost;
        S.current.spent += p.repair.cost;
        const fix: Fix = { scenario: s, stranded: a.before.unreachableOccupantIds, repair: p.repair, source: p.source, attempts: p.attempt, rejected: p.attempt - 1 };
        S.current.fixes = [...S.current.fixes, fix];
        setFixes((f) => [...f, fix]);
        setFeedback([]);
        setPhase("accepted");
      } else {
        say("judge", a.reasons[0], "bad");
        setFeedback((f) => [...f, { repair: p.repair, reasons: a.reasons }]);
        setPhase("rejected");
      }
      setBusy(false);
      return a;
    },
    [say],
  );

  /* manual buttons */
  const redesign = useCallback(() => defendFor(S.current.scenario, S.current.feedback), [defendFor]);
  const verify = useCallback(async () => (S.current.proposal ? judgeFor(S.current.scenario, S.current.proposal) : null), [judgeFor]);

  const toggleConnection = useCallback(
    (id: string) => {
      if (busy) return;
      const cur = rawScenario.blockedConnectionIds;
      const blocked = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort();
      applyScenario(blocked.length ? { id: `MANUAL_${blocked.join("_")}`, name: `Manual: ${blocked.join(" + ")} blocked`, blockedConnectionIds: blocked } : BASELINE, "judge", "Chosen manually.");
      setPhase(blocked.length ? "attacked" : "idle");
    },
    [applyScenario, busy, rawScenario],
  );

  const reset = useCallback(() => {
    runToken.current++;
    setApproval((ap) => {
      ap?.resolve(false);
      return null;
    });
    setAutopilot(false);
    setBuilding(preset.building);
    S.current.building = preset.building;
    setRawScenario(BASELINE);
    setAddedIds([]);
    setPhase("idle");
    setAttackInfo(null);
    setProposal(null);
    setAudit(null);
    setFeedback([]);
    setPassports([]);
    setPassportMeta({});
    setRegressions([]);
    setTested([]);
    setSpent(0);
    S.current.budgetLeft = S.current.constraints.budget;
    S.current.regressions = [];
    S.current.tested = [];
    setBusy(false);
    setRuns(ZERO_RUNS);
    setFixes([]);
    setReport(null);
    setDemoRunning(false);
    S.current.fixes = [];
    S.current.spent = 0;
    setCameraResetKey((k) => k + 1);
    say("system", "Reset to the original building.");
  }, [preset.building, say]);

  /** attack → repair → judge → revise with the judge's reasons → judge (max 3 attempts). */
  const runLoop = useCallback(async (forced?: { scenario: Scenario; reason: string; fix?: PlannedFix; enabling?: boolean }): Promise<"hardened" | "repaired" | "stuck" | "cancelled"> => {
    const token = ++runToken.current;
    let found: { scenario: Scenario; result: TestResult } | null;
    if (forced) {
      bump("attacker");
      setPhase("attacking");
      await wait(120);
      found = applyScenario(forced.scenario, "fallback", forced.reason);
      setPhase("attacked");
    } else {
      found = await attack();
    }
    if (token !== runToken.current) return "cancelled";
    if (!found || (found.result.unreachableOccupantIds.length === 0 && !forced?.enabling)) return "hardened";
    if (forced?.fix) {
      // Planned by the budget optimiser: best protection per pound that still fits the budget.
      setPhase("defending");
      setAudit(null);
      bump("defender");
      await wait(150);
      const p: NonNullable<Proposal> = { repair: forced.fix.repair, estimate: forced.fix.estimate, reasoning: forced.fix.reasoning.replace("Cheapest fix that passes the judge", "Part of the minimum-cost plan"), source: "fallback", attempt: 1 };
      setProposal(p);
      setPhase("proposed");
      say("defender", `Proposes ${describeRepair(p.repair)} · £${p.repair.cost.toLocaleString("en-GB")}.`, "ai");
      await wait(120);
      if (token !== runToken.current) return "cancelled";
      const a = await judgeFor(found.scenario, p, { stillTrapped: forced.fix.stillTrapped, enabling: forced.enabling });
      return a.accepted ? "repaired" : "stuck";
    }
    let fb: Feedback[] = [];
    for (let i = 0; i < 3; i++) {
      await wait(80);
      if (token !== runToken.current) return "cancelled";
      const p = await defendFor(found.scenario, fb, forced ? "fast" : "lead");
      if (token !== runToken.current) return "cancelled";
      if (!p) return "stuck";
      await wait(100);
      const a = await judgeFor(found.scenario, p);
      if (a.accepted) return "repaired";
      fb = [...fb, { repair: p.repair, reasons: a.reasons }];
    }
    return "stuck";
  }, [applyScenario, attack, defendFor, judgeFor, say]);

  /** Pre-written proposals so the rejection moment is guaranteed; verdicts are live. */
  const runSignatureDemo = useCallback(async () => {
    const sc = preset.scripted;
    if (!sc) return;
    reset();
    const token = runToken.current;
    setDemoRunning(true);
    try {
    await wait(900);
    say("system", "Scripted demo: proposals are pre-written; every verdict is computed live by the judge.", "warn");
    setPhase("attacking");
    setBusy(true);
    bump("attacker");
    await wait(1400);
    if (token !== runToken.current) return;
    setBusy(false);
    const { scenario: s } = applyScenario(sc.attack, "scripted", sc.attackReason);
    setPhase("attacked");
    S.current.regressions = [s];
    for (const [i, { repair, reasoning }] of sc.repairs.entries()) {
      await wait(1300);
      if (token !== runToken.current) return;
      setPhase("defending");
      setBusy(true);
      bump("defender");
      say("defender", `Scripted proposal ${i + 1}…`, "ai");
      await wait(1100);
      if (token !== runToken.current) return;
      const priced = withModelledCost(repair, S.current.building, S.current.rates);
      const p: NonNullable<Proposal> = { repair: priced.repair, estimate: priced.estimate, reasoning, source: "scripted", attempt: i + 1 };
      setProposal(p);
      setPhase("proposed");
      setBusy(false);
      say("defender", `Proposes ${describeRepair(p.repair)} · modelled cost £${p.repair.cost.toLocaleString("en-GB")}.`, "ai");
      await wait(1500);
      if (token !== runToken.current) return;
      const a = await judgeFor(s, p);
      if (a.accepted) break;
    }
    await wait(2600);
    if (token !== runToken.current) return;
    const con = S.current.constraints;
    const certificate = certify(S.current.building, con.tolerance, con.liftsRecalled || alarmRef.current ? recalledLifts(S.current.building) : [], { skipEvacuationLifts: true });
    setReport({ status: certificate.faultFree ? "fault-free" : "stopped", certificate, fixes: S.current.fixes, totalCost: S.current.spent, remaining: certificate.failures[0]?.scenario, at: Date.now() });
    } finally {
      setDemoRunning(false);
    }
  }, [applyScenario, judgeFor, preset.scripted, reset, say]);

  /* autopilot */
  const autopilotRef = useRef(false);
  autopilotRef.current = autopilot;
  const runLoopRef = useRef(runLoop);
  runLoopRef.current = runLoop;
  const autopilotBusy = useRef(false);
  useEffect(() => {
    if (!autopilot || autopilotBusy.current) return;
    autopilotBusy.current = true;
    (async () => {
      const con = S.current.constraints;
      const lifts = () => (con.liftsRecalled || alarmRef.current ? recalledLifts(S.current.building) : []);
      const OPTS = { skipEvacuationLifts: true };
      say("system", `Autopilot engaged. Target: no combination of up to ${con.tolerance} failure(s) strands anyone. The attacker invents blockages; the engine sweeps every combination before signing off.`, "ai");
      let status: Report["status"] = "stopped";
      let remaining: Scenario | undefined;
      const recall = () => con.liftsRecalled || alarmRef.current;
      // Round 1: the lead brain (Gemini 4 Argon, or the built-in attacker) picks the first blockage itself.
      await wait(150);
      if (autopilotRef.current) {
        const r1 = await runLoopRef.current();
        if (r1 === "cancelled") autopilotRef.current = false;
      }
      // Then: the optimiser works out the minimum-cost set of changes that gets everyone out, and builds it.
      let plan: ReturnType<typeof minimumPlan> | null = null;
      if (autopilotRef.current && !certify(S.current.building, con.tolerance, lifts(), OPTS).faultFree) {
        say("system", "Optimiser: searching for the minimum-cost set of changes that gets everyone out…", "ai");
        await wait(80);
        plan = minimumPlan(S.current.building, con.tolerance, recall(), S.current.rates, con.allow);
        if (plan.everyoneSafe)
          say("system", `Optimiser: ${plan.repairs.length} more change(s), £${plan.cost.toLocaleString("en-GB")}${plan.pruned ? ` (${plan.pruned} unnecessary change(s) removed)` : ""}. Building them now.`, "good");
        else say("system", "Optimiser: no combination of the allowed changes gets everyone out. Building what helps.", "warn");
      }
      let todo = plan?.repairs ?? [];
      for (let round = 2; round <= 60 && autopilotRef.current && todo.length; round++) {
        await wait(120);
        const cert = certify(S.current.building, con.tolerance, lifts(), OPTS);
        if (cert.faultFree) {
          status = "fault-free";
          break;
        }
        const next = nextFromPlan(S.current.building, todo, con.tolerance, recall());
        if (!next) break;
        todo = todo.filter((_, i) => i !== next.index);
        const blocked = next.fix.scenario.blockedConnectionIds.filter((id) => !lifts().includes(id));
        const plain = blocked.length ? `Fire blocks ${describeBlocked(S.current.building, blocked)}` : "Fire alarm: lifts recalled";
        say("judge", `${cert.failures.length} blocked-path scenario(s) still trap someone. Next: ${plain.toLowerCase()}.`, "warn");
        const r = await runLoopRef.current({ scenario: { ...next.fix.scenario, name: plain }, reason: "Part of the minimum-cost plan.", fix: next.fix, enabling: next.enabling });
        if (r === "cancelled") break;
        if (r === "stuck") {
          status = "stuck";
          remaining = S.current.scenario;
          break;
        }
      }
      if (autopilotRef.current && sweepRef.current) await sweepRef.current("Final check: re-testing every blocked path", 1800);
      const certificate = certify(S.current.building, con.tolerance, lifts(), OPTS);
      if (certificate.faultFree) status = "fault-free";
      if (!certificate.faultFree && status === "fault-free") status = "stuck";
      setReport({ status, certificate, fixes: S.current.fixes, totalCost: S.current.spent, remaining: certificate.faultFree ? undefined : remaining ?? certificate.failures[0]?.scenario, at: Date.now() });
      say("system", certificate.faultFree ? `Everyone can get out: ${certificate.scenariosChecked} scenarios checked. Minimum cost ${S.current.spent ? `£${S.current.spent.toLocaleString("en-GB")} for ${S.current.fixes.length} change(s)` : "£0, no changes needed"}.` : "Finished with failures remaining. See the report.", certificate.faultFree ? "good" : "warn");
      autopilotBusy.current = false;
      setAutopilot(false);
    })();
  }, [autopilot, say]);

  /** Walks the 3D view through every blocked-path scenario the engine tests. */
  const runSweep = useCallback(
    async (title: string, durationMs = 3000): Promise<Certificate> => {
      const con = S.current.constraints;
      const b = S.current.building;
      const lifts = con.liftsRecalled || alarmRef.current ? recalledLifts(b) : [];
      const cert = certify(b, con.tolerance, lifts, { skipEvacuationLifts: true, collectAll: true });
      const items = cert.all ?? [];
      const step = Math.max(30, Math.min(220, Math.floor(durationMs / Math.max(1, items.length))));
      setPhase("sweeping");
      say("judge", `${title}: ${items.length} scenarios, each with a different path blocked by fire.`, "ai");
      let trapped = 0;
      for (let i = 0; i < items.length; i++) {
        if (!autopilotRef.current && !alarmRef.current) break;
        const it = items[i];
        const ok = it.result.unreachableOccupantIds.length === 0;
        if (!ok) trapped++;
        const blocked = it.scenario.blockedConnectionIds.filter((id) => !lifts.includes(id));
        setPreview(it);
        setSweep({ index: i + 1, total: items.length, label: blocked.length ? describeBlocked(b, blocked) : "lifts recalled only", ok, trapped, title });
        await wait(ok ? step : step * 2);
      }
      setPreview(null);
      say("judge", trapped ? `${trapped} of ${items.length} scenarios would trap someone.` : `Everyone can get out in all ${items.length} scenarios.`, trapped ? "bad" : "good");
      await wait(400);
      setSweep(null);
      return cert;
    },
    [say],
  );
  const sweepRef = useRef(runSweep);
  sweepRef.current = runSweep;

  /** Normal day → fire alarm → agents test every blocked path → fix → verify → summary. */
  const activateAlarm = useCallback(async () => {
    if (autopilotBusy.current) return;
    setAlarm(true);
    alarmRef.current = true;
    demoStart.current = Date.now();
    setReport(null);
    setPhase("alarm");
    say("system", "FIRE ALARM ACTIVATED. Lifts are recalled. The agents will now test what happens if fire blocks each path in turn.", "bad");
    autopilotRef.current = true;
    await wait(600);
    await runSweep("Testing every blocked path");
    if (!alarmRef.current) return;
    setAutopilot(true);
  }, [runSweep, say]);

  const resetAll = useCallback(() => {
    setAlarm(false);
    alarmRef.current = false;
    setPreview(null);
    setSweep(null);
    reset();
  }, [reset]);

  return {
    preset,
    building,
    scenario,
    result,
    addedIds,
    phase,
    attackInfo,
    proposal,
    audit,
    feedback,
    passports,
    passportMeta,
    regressions,
    spent,
    budget: constraints.budget,
    budgetLeft,
    log,
    busy,
    gemini,
    rates,
    ratesNote,
    ratesLoading,
    loadRates,
    verdictFlash,
    cameraResetKey,
    runs,
    tested,
    certificate,
    fixes,
    report,
    setReport,
    demoRunning,
    approval,
    alarm,
    preview,
    sweep,
    activateAlarm,
    resetAll,
    autopilot,
    setAutopilot,
    attack,
    redesign,
    verify,
    toggleConnection,
    reset,
    runLoop,
    runSignatureDemo,
    resetCamera: () => setCameraResetKey((k) => k + 1),
  };
}

export type DemoController = ReturnType<typeof useDemoController>;

export function describeRepair(r: Repair): string {
  if (r.kind === "upgrade_lift") return r.label ?? `upgrade of the existing lift to an evacuation lift`;
  if (r.kind === "add_connections") {
    return r.label ?? `${r.connections.length} new connections (${r.connections.map((c) => c.id).join(", ")})`;
  }
  if (r.kind === "add_connection") {
    const c = r.connection;
    const what = c.kind === "lift" ? (c.evacuationLift ? "evacuation lift" : "lift") : c.kind === "stairs" || !c.stepFree ? "staircase" : c.kind === "ramp" ? "ramp" : c.kind === "door" ? "additional step-free door" : "step-free corridor";
    return `new ${what} ${c.id} (${c.from} ↔ ${c.to}, ${c.length} m)`;
  }
  return `reopening ${(r as { connectionId: string }).connectionId}`;
}
