"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Building, FailurePassport, Repair, RepairAudit, Scenario, TestResult } from "@/contracts/types";
import type { BuildingPreset } from "@/data/buildings";
import { auditRepair, certify, simulate, withConnection, type Certificate } from "@/engine";
import { DEFAULT_RATES, withModelledCost, type CostEstimate, type CostRates } from "@/cost/costModel";
import { fallbackAttack, fallbackRepair, repairKind } from "./fallbackAgents";

export type Source = "gemini" | "fallback" | "judge" | "scripted";
export type Phase = "idle" | "attacking" | "attacked" | "defending" | "proposed" | "auditing" | "accepted" | "rejected";
export type LogEntry = { id: number; at: number; role: "attacker" | "defender" | "judge" | "manual" | "system"; text: string; tone?: "bad" | "good" | "warn" | "ai" };
export type PassportMeta = { createdAt: number; source: Source; attempts: number };
export type GeminiStatus = { checked: boolean; configured: boolean; model: string };
export type RepairKind = "corridor" | "stairs" | "lift" | "ramp" | "unblock";
export type Constraints = { budget: number; liftsRecalled: boolean; tolerance: 1 | 2; allow: Record<RepairKind, boolean> };
export type Fix = { scenario: Scenario; stranded: string[]; repair: Repair; source: Source; attempts: number; rejected: number };
export type Report = { status: "fault-free" | "stuck" | "stopped"; certificate: Certificate; fixes: Fix[]; totalCost: number; remaining?: Scenario; at: number };
export type Proposal = { repair: Repair; reasoning: string; source: Source; attempt: number; aiCost?: number; estimate: CostEstimate } | null;
export type AgentRuns = { attacker: number; defender: number; judge: number; geminiCalls: number; fallbackCalls: number; regressionChecks: number };

type AttackInfo = { reasoning: string; source: Source } | null;
type Feedback = { repair: Repair; reasons: string[] };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASELINE: Scenario = { id: "BASELINE", name: "Normal operation", blockedConnectionIds: [] };
const ZERO_RUNS: AgentRuns = { attacker: 0, defender: 0, judge: 0, geminiCalls: 0, fallbackCalls: 0, regressionChecks: 0 };

export function defaultConstraints(preset: BuildingPreset): Constraints {
  return { budget: preset.defaultBudget, liftsRecalled: false, tolerance: preset.defaultTolerance, allow: { corridor: true, stairs: true, lift: true, ramp: true, unblock: true } };
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
  const logId = useRef(0);
  const runToken = useRef(0);

  /** Applies the emergency-lift assumption on top of any scenario. */
  const effective = useCallback(
    (s: Scenario, b: Building = building): Scenario => {
      if (!constraints.liftsRecalled) return s;
      const lifts = recalledLifts(b).filter((id) => !s.blockedConnectionIds.includes(id));
      if (!lifts.length) return s;
      return { id: `${s.id}+LIFTS_RECALLED`, name: `${s.name} · lifts recalled`, blockedConnectionIds: [...s.blockedConnectionIds, ...lifts].sort() };
    },
    [building, constraints.liftsRecalled],
  );

  const scenario = useMemo(() => effective(rawScenario), [effective, rawScenario]);
  // The ONLY source of displayed results: the deterministic engine.
  const result: TestResult = useMemo(() => simulate(building, scenario), [building, scenario]);
  const budgetLeft = constraints.budget - spent;
  // Live exhaustive check of every combination of up to `tolerance` failures.
  const certificate: Certificate = useMemo(
    () => certify(building, constraints.tolerance, constraints.liftsRecalled ? recalledLifts(building) : []),
    [building, constraints.tolerance, constraints.liftsRecalled],
  );

  // Everything async reads the latest state from here, so manual steps and loops share one implementation.
  const S = useRef({ building, scenario, regressions, budgetLeft, gemini, rates, tested, constraints, feedback, proposal, fixes, spent });
  S.current = { building, scenario, regressions, budgetLeft, gemini, rates, tested, constraints, feedback, proposal, fixes, spent };

  const say = useCallback((role: LogEntry["role"], text: string, tone?: LogEntry["tone"]) => {
    setLog((l) => [...l.slice(-80), { id: ++logId.current, at: Date.now(), role, text, tone }]);
  }, []);
  const bump = (k: keyof AgentRuns, n = 1) => setRuns((r) => ({ ...r, [k]: r[k] + n }));

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setGemini({ checked: true, configured: Boolean(j?.data?.configured), model: j?.data?.model ?? "" }))
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
    const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
        if (!g.configured) throw new Error("not configured");
        bump("geminiCalls");
        const data = await callAgents({ action: "attack", building: b, prior: t.map((x) => ({ scenario: x })), maxBlocked: con.tolerance });
        raw = data.scenario;
        reasoning = data.reasoning || "";
        await wait(300);
      } catch (e) {
        if (g.configured) say("system", `Gemini attack failed (${e instanceof Error ? e.message : e}). Using deterministic search.`, "warn");
        bump("fallbackCalls");
        await wait(800);
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
    async (s: Scenario, fb: Feedback[]): Promise<Proposal> => {
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
      say("defender", `${g.configured ? "Gemini is designing" : "Designing"} repair attempt ${fb.length + 1} (budget £${left.toLocaleString("en-GB")})…`, "ai");
      try {
        let p: Proposal = null;
        try {
          if (!g.configured) throw new Error("not configured");
          bump("geminiCalls");
          const allowed = (Object.keys(con.allow) as RepairKind[]).filter((k) => con.allow[k]);
          const data = await callAgents({ action: "defend", building: b, scenario: s, result: r, budget: left, feedback: fb, constraints: { allowed, rates: rt.rates } });
          const priced = withModelledCost(data.repair, b, rt);
          p = { repair: priced.repair, estimate: priced.estimate, aiCost: data.repair.cost, reasoning: data.reasoning || "", source: "gemini", attempt: fb.length + 1 };
          await wait(300);
        } catch (e) {
          if (g.configured) say("system", `Gemini repair failed (${e instanceof Error ? e.message : e}). Using deterministic repair search.`, "warn");
          bump("fallbackCalls");
          await wait(800);
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
    async (s: Scenario, p: NonNullable<Proposal>): Promise<RepairAudit> => {
      const { building: b, regressions: regs, budgetLeft: left, constraints: con } = S.current;
      setBusy(true);
      setPhase("auditing");
      bump("judge");
      const regSet = regs.some((x) => x.id === s.id) ? regs : [...regs, s];
      bump("regressionChecks", regSet.length);
      say("judge", `Re-solving the target scenario and ${regSet.length} stored regression(s)…`, "ai");
      await wait(1000);
      let a = auditRepair(b, s, p.repair, regSet, left);
      const kind = repairKind(p.repair);
      const reopenDoor = p.repair.kind === "unblock_connection" && b.connections.find((c) => c.id === (p.repair as { connectionId: string }).connectionId)?.kind !== "lift";
      if (autopilotRef.current && reopenDoor && a.accepted) {
        a = { ...a, accepted: false, after: a.before, reasons: ["Rejected: reopening a blocked door clears today's obstruction but adds no resilience; the building must survive this failure, so a structural change is needed."] };
      } else if (!con.allow[kind]) {
        a = { ...a, accepted: false, after: a.before, reasons: [`Rejected: design constraints do not allow ${kind === "unblock" ? "unblocking as a fix" : `new ${kind}s`}.`, ...a.reasons.filter((x) => !x.startsWith("Accepted"))] };
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
        if (p.repair.kind === "add_connection") {
          const nb = withConnection(b, p.repair.connection);
          S.current.building = nb;
          setBuilding(nb);
          setAddedIds((ids) => [...ids, (p.repair as Extract<Repair, { kind: "add_connection" }>).connection.id]);
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
    S.current.fixes = [];
    S.current.spent = 0;
    setCameraResetKey((k) => k + 1);
    say("system", "Reset to the original building.");
  }, [preset.building, say]);

  /** attack → repair → judge → revise with the judge's reasons → judge (max 3 attempts). */
  const runLoop = useCallback(async (forced?: { scenario: Scenario; reason: string }): Promise<"hardened" | "repaired" | "stuck" | "cancelled"> => {
    const token = ++runToken.current;
    let found: { scenario: Scenario; result: TestResult } | null;
    if (forced) {
      bump("attacker");
      setPhase("attacking");
      await wait(900);
      found = applyScenario(forced.scenario, "fallback", forced.reason);
      setPhase("attacked");
    } else {
      found = await attack();
    }
    if (token !== runToken.current) return "cancelled";
    if (!found || found.result.unreachableOccupantIds.length === 0) return "hardened";
    let fb: Feedback[] = [];
    for (let i = 0; i < 3; i++) {
      await wait(500);
      if (token !== runToken.current) return "cancelled";
      const p = await defendFor(found.scenario, fb);
      if (token !== runToken.current) return "cancelled";
      if (!p) return "stuck";
      await wait(700);
      const a = await judgeFor(found.scenario, p);
      if (a.accepted) return "repaired";
      fb = [...fb, { repair: p.repair, reasons: a.reasons }];
    }
    return "stuck";
  }, [applyScenario, attack, defendFor, judgeFor]);

  /** Pre-written proposals so the rejection moment is guaranteed; verdicts are live. */
  const runSignatureDemo = useCallback(async () => {
    const sc = preset.scripted;
    if (!sc) return;
    reset();
    const token = runToken.current;
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
      const lifts = () => (con.liftsRecalled ? recalledLifts(S.current.building) : []);
      say("system", `Autopilot engaged. Target: no combination of up to ${con.tolerance} failure(s) strands anyone. The attacker invents blockages; the engine sweeps every combination before signing off.`, "ai");
      let status: Report["status"] = "stopped";
      let remaining: Scenario | undefined;
      for (let round = 1; round <= 14; round++) {
        await wait(1100);
        if (!autopilotRef.current) break;
        // 1) Let the attacker invent its own blockage.
        let r = await runLoopRef.current();
        if (r === "cancelled") break;
        if (r === "hardened") {
          // 2) Attacker found nothing new: exhaustive engine sweep is the final word.
          const cert = certify(S.current.building, con.tolerance, lifts());
          say("judge", `Exhaustive sweep: ${cert.scenariosChecked} combinations checked, ${cert.failures.length} still strand someone.`, cert.faultFree ? "good" : "warn");
          if (cert.faultFree) {
            status = "fault-free";
            break;
          }
          const f = cert.failures[0];
          remaining = f.scenario;
          r = await runLoopRef.current({
            scenario: { ...f.scenario, id: f.scenario.id.replace(/^SWEEP_/, "SWEEP_"), name: `${f.scenario.name} (found by exhaustive sweep)` },
            reason: `The attacker ran out of ideas, but the engine sweep found that blocking ${f.scenario.blockedConnectionIds.join(" + ")} strands ${f.result.unreachableOccupantIds.join(", ")}.`,
          });
          if (r === "cancelled") break;
        }
        if (r === "stuck") {
          status = "stuck";
          remaining = S.current.scenario;
          say("system", "Autopilot stopped: no fix within budget and constraints passes the judge for the last failure. Raise the budget or allow more repair types.", "warn");
          break;
        }
      }
      const certificate = certify(S.current.building, con.tolerance, lifts());
      if (certificate.faultFree) status = "fault-free";
      setReport({ status, certificate, fixes: S.current.fixes, totalCost: S.current.spent, remaining: certificate.faultFree ? undefined : remaining ?? certificate.failures[0]?.scenario, at: Date.now() });
      say("system", certificate.faultFree ? `Certified fault-free against any ${con.tolerance} failure(s): ${certificate.scenariosChecked} combinations checked, ${S.current.fixes.length} change(s), £${S.current.spent.toLocaleString("en-GB")}.` : "Autopilot finished with failures remaining. See the report.", certificate.faultFree ? "good" : "warn");
      autopilotBusy.current = false;
      setAutopilot(false);
    })();
  }, [autopilot, say]);

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
  if (r.kind === "add_connection") {
    const c = r.connection;
    const what = c.kind === "lift" ? (c.evacuationLift ? "evacuation lift" : "lift") : c.kind === "stairs" || !c.stepFree ? "staircase" : c.kind === "ramp" ? "ramp" : c.kind === "door" ? "additional step-free door" : "step-free corridor";
    return `new ${what} ${c.id} (${c.from} ↔ ${c.to}, ${c.length} m)`;
  }
  return `reopening ${r.connectionId}`;
}
