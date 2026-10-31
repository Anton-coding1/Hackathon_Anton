"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Building, Connection, FailurePassport, Repair, RepairAudit, Scenario, TestResult } from "@/contracts/types";
import {
  blockedD4Scenario,
  DEMO_BUDGET,
  demoBuilding,
  initialScenario,
  invalidDemoRepair,
  validDemoRepair,
} from "@/data/demoBuilding";
import { auditRepair, resilienceFingerprint, simulate, withConnection } from "@/engine";
import { fallbackAttack, fallbackRepair } from "./fallbackAgents";

export type Source = "gemini" | "fallback" | "judge" | "scripted";
export type Phase = "idle" | "attacking" | "attacked" | "defending" | "proposed" | "auditing" | "accepted" | "rejected";
export type LogEntry = { id: number; at: number; role: "attacker" | "defender" | "judge" | "manual" | "system"; text: string; tone?: "bad" | "good" | "warn" | "ai" };
export type PassportMeta = { createdAt: number; source: Source; attempts: number };
export type GeminiStatus = { checked: boolean; configured: boolean; model: string };

type Proposal = { repair: Repair; reasoning: string; source: Source; attempt: number } | null;
type AttackInfo = { reasoning: string; source: Source } | null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useDemoController() {
  const [building, setBuilding] = useState<Building>(demoBuilding);
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [attackInfo, setAttackInfo] = useState<AttackInfo>(null);
  const [proposal, setProposal] = useState<Proposal>(null);
  const [audit, setAudit] = useState<RepairAudit | null>(null);
  const [feedback, setFeedback] = useState<{ repair: Repair; reasons: string[] }[]>([]);
  const [passports, setPassports] = useState<FailurePassport[]>([]);
  const [passportMeta, setPassportMeta] = useState<Record<string, PassportMeta>>({});
  const [regressions, setRegressions] = useState<Scenario[]>([]);
  const [tested, setTested] = useState<Scenario[]>([]);
  const [spent, setSpent] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gemini, setGemini] = useState<GeminiStatus>({ checked: false, configured: false, model: "" });
  const [verdictFlash, setVerdictFlash] = useState<{ key: number; accepted: boolean; text: string } | null>(null);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const logId = useRef(0);
  const runToken = useRef(0);

  // The ONLY source of displayed results: the deterministic engine.
  const result: TestResult = useMemo(() => simulate(building, scenario), [building, scenario]);
  const budgetLeft = DEMO_BUDGET - spent;

  const fragility = useMemo(() => {
    const fp = resilienceFingerprint(building);
    const map: Record<string, number> = {};
    for (const f of fp) {
      const needsSF = building.occupants.some((o) => o.startNodeId === f.nodeId && o.requiresStepFree);
      map[f.nodeId] = needsSF ? f.stepFree : f.anyRoute;
    }
    return map;
  }, [building]);

  const say = useCallback((role: LogEntry["role"], text: string, tone?: LogEntry["tone"]) => {
    setLog((l) => [...l.slice(-60), { id: ++logId.current, at: Date.now(), role, text, tone }]);
  }, []);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setGemini({ checked: true, configured: Boolean(j?.data?.configured), model: j?.data?.model ?? "" }))
      .catch(() => setGemini({ checked: true, configured: false, model: "" }));
    say("system", "Blackwood Hall loaded. Every result shown is computed by the deterministic graph engine.");
  }, [say]);

  /** Records a scenario that strands someone as a Failure Passport and a regression test. */
  const recordFailure = useCallback(
    (s: Scenario, r: TestResult, source: Source) => {
      if (r.unreachableOccupantIds.length === 0) return;
      setRegressions((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
      setPassports((prev) => {
        if (prev.some((p) => p.scenario.id === s.id && !p.audit?.accepted)) return prev;
        const id = `FP-${String(prev.length + 1).padStart(3, "0")}`;
        setPassportMeta((m) => ({ ...m, [id]: { createdAt: Date.now(), source, attempts: 0 } }));
        return [...prev, { id, scenario: s, result: r }];
      });
    },
    [],
  );

  const applyScenario = useCallback(
    (s: Scenario, source: Source, reasoning: string, b: Building = building) => {
      const r = simulate(b, s);
      setScenario(s);
      setAttackInfo({ reasoning, source });
      setProposal(null);
      setAudit(null);
      setFeedback([]);
      setTested((t) => (t.some((x) => x.id === s.id) ? t : [...t, s]));
      recordFailure(s, r, source);
      const who = source === "judge" ? "manual" : "attacker";
      if (r.unreachableOccupantIds.length) {
        say(who, `${s.name}: ${r.unreachableOccupantIds.join(", ")} stranded (${r.reachableCount}/${r.totalCount} reachable).`, "bad");
      } else {
        say(who, `${s.name}: everyone still has a route (${r.reachableCount}/${r.totalCount}).`, "good");
      }
      return r;
    },
    [building, recordFailure, say],
  );

  const callAgents = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({ success: false, error: "Bad response from /api/agents" }));
    if (!json.success) throw new Error(json.error ?? `Agent request failed (${res.status})`);
    return json.data;
  };

  /** Attacker: Gemini first, clearly-labelled deterministic search if Gemini is unavailable. */
  const attack = useCallback(async (): Promise<{ scenario: Scenario; result: TestResult } | null> => {
    setBusy(true);
    setError(null);
    setPhase("attacking");
    say("attacker", gemini.configured ? `Gemini (${gemini.model}) is searching for a weakness…` : "Searching for a weakness…", "ai");
    try {
      let s: Scenario;
      let reasoning: string;
      let source: Source;
      try {
        if (!gemini.configured) throw new Error("Gemini is not configured (no GEMINI_API_KEY).");
        const prior = tested.map((t) => ({ scenario: t }));
        const data = await callAgents({ action: "attack", building, prior });
        s = data.scenario;
        reasoning = data.reasoning || "";
        source = "gemini";
        await wait(400);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (gemini.configured) say("system", `Gemini attack failed (${msg}). Using deterministic search instead.`, "warn");
        await wait(900);
        const fb = fallbackAttack(building, tested);
        if (!fb) {
          say("attacker", "No untested disruptions left.", "warn");
          setPhase("idle");
          return null;
        }
        ({ scenario: s, reasoning } = fb);
        source = "fallback";
      }
      const r = applyScenario(s, source, reasoning);
      setPhase("attacked");
      return { scenario: s, result: r };
    } finally {
      setBusy(false);
    }
  }, [applyScenario, building, gemini, say, tested]);

  /** Defender: proposes a repair for the current failure. Never applied without the auditor. */
  const redesign = useCallback(
    async (fb = feedback): Promise<Proposal> => {
      if (result.unreachableOccupantIds.length === 0) {
        say("defender", "Nothing to repair: everyone has a route in this scenario.", "warn");
        return null;
      }
      setBusy(true);
      setError(null);
      setPhase("defending");
      setAudit(null);
      say("defender", gemini.configured ? `Gemini is designing a repair (budget £${budgetLeft.toLocaleString("en-GB")})…` : "Designing a repair…", "ai");
      try {
        let p: Proposal;
        try {
          if (!gemini.configured) throw new Error("Gemini is not configured (no GEMINI_API_KEY).");
          const data = await callAgents({ action: "defend", building, scenario, result, budget: budgetLeft, feedback: fb });
          p = { repair: data.repair, reasoning: data.reasoning || "", source: "gemini", attempt: fb.length + 1 };
          await wait(300);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (gemini.configured) say("system", `Gemini repair failed (${msg}). Using deterministic repair search.`, "warn");
          await wait(900);
          const f = fallbackRepair(building, scenario, regressions, budgetLeft);
          if (!f) {
            say("defender", "No affordable repair found within the remaining budget.", "warn");
            setPhase("attacked");
            return null;
          }
          p = { ...f, source: "fallback", attempt: fb.length + 1 };
        }
        setProposal(p);
        setPhase("proposed");
        say("defender", `Proposes ${describeRepair(p!.repair)} for £${p!.repair.cost.toLocaleString("en-GB")}.`, "ai");
        return p;
      } finally {
        setBusy(false);
      }
    },
    [budgetLeft, building, feedback, gemini, regressions, result, say, scenario],
  );

  /** Auditor: independently verifies; only an accepted repair changes the building. */
  const verify = useCallback(
    async (p: Proposal = proposal): Promise<RepairAudit | null> => {
      if (!p) return null;
      setBusy(true);
      setPhase("auditing");
      say("judge", "Re-running the target scenario and every stored regression…", "ai");
      await wait(1100); // let the audit sweep play; the computation itself is instant
      const a = auditRepair(building, scenario, p.repair, regressions, budgetLeft);
      setAudit(a);
      setPassports((prev) => {
        const idx = [...prev].reverse().findIndex((x) => x.scenario.id === scenario.id);
        if (idx === -1) return prev;
        const i = prev.length - 1 - idx;
        const copy = [...prev];
        copy[i] = { ...copy[i], repair: p.repair, audit: a };
        setPassportMeta((m) => ({ ...m, [copy[i].id]: { ...(m[copy[i].id] ?? { createdAt: Date.now(), source: p.source }), attempts: p.attempt } }));
        return copy;
      });
      setVerdictFlash({ key: Date.now(), accepted: a.accepted, text: a.accepted ? "REPAIR VERIFIED" : "REPAIR REJECTED" });
      if (a.accepted) {
        say("judge", a.reasons[0], "good");
        if (p.repair.kind === "add_connection") {
          const nb = withConnection(building, p.repair.connection);
          setBuilding(nb);
          setAddedIds((ids) => [...ids, (p.repair as { connection: Connection }).connection.id]);
        } else {
          const id = p.repair.connectionId;
          setScenario((s) => ({ ...s, blockedConnectionIds: s.blockedConnectionIds.filter((x) => x !== id) }));
        }
        setSpent((s) => s + p.repair.cost);
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
    [budgetLeft, building, proposal, regressions, say, scenario],
  );

  /** Judge clicks a connection: toggle it blocked and rerun the engine immediately. */
  const toggleConnection = useCallback(
    (id: string) => {
      if (busy) return;
      const blocked = scenario.blockedConnectionIds.includes(id)
        ? scenario.blockedConnectionIds.filter((x) => x !== id)
        : [...scenario.blockedConnectionIds, id].sort();
      const s: Scenario = blocked.length
        ? { id: `JUDGE_${blocked.join("_")}`, name: `Judge blocks ${blocked.join(" + ")}`, blockedConnectionIds: blocked }
        : { ...initialScenario };
      applyScenario(s, "judge", "Chosen by a human judge.");
      setPhase(blocked.length ? "attacked" : "idle");
    },
    [applyScenario, busy, scenario],
  );

  const reset = useCallback(() => {
    runToken.current++;
    autopilotRef.current = false;
    setAutopilot(false);
    setBuilding(demoBuilding);
    setScenario(initialScenario);
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
    setError(null);
    setBusy(false);
    setCameraResetKey((k) => k + 1);
    say("system", "Reset to the original building.");
  }, [say]);

  /**
   * Autonomous loop: attack → simulate → repair → audit → (revise with the
   * auditor's reasons) → audit. Up to 3 defender attempts.
   */
  const runLoop = useCallback(async (): Promise<"hardened" | "repaired" | "stuck" | "cancelled"> => {
    const token = ++runToken.current;
    const found = await attack();
    if (token !== runToken.current) return "cancelled";
    if (!found || found.result.unreachableOccupantIds.length === 0) return "hardened";
    // State updates from attack() are async; compute against the scenario we just applied.
    let fb: { repair: Repair; reasons: string[] }[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (token !== runToken.current) return "cancelled";
      await wait(500);
      const p = await redesignFor(found.scenario, fb);
      if (token !== runToken.current) return "cancelled";
      if (!p) return "stuck";
      await wait(700);
      const a = await verifyFor(found.scenario, p);
      if (a.accepted) return "repaired";
      fb = [...fb, { repair: p.repair, reasons: a.reasons }];
    }
    return "stuck";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attack]);

  // Helpers that take an explicit scenario so the loop does not depend on React's state timing.
  const latest = useRef({ building, regressions, budgetLeft, gemini });
  latest.current = { building, regressions, budgetLeft, gemini };

  const redesignFor = async (s: Scenario, fb: { repair: Repair; reasons: string[] }[]): Promise<Proposal> => {
    const { building: b, regressions: regs, budgetLeft: left, gemini: g } = latest.current;
    const r = simulate(b, s);
    setPhase("defending");
    setAudit(null);
    setBusy(true);
    say("defender", g.configured ? `Gemini is designing repair attempt ${fb.length + 1}…` : `Designing repair attempt ${fb.length + 1}…`, "ai");
    try {
      try {
        if (!g.configured) throw new Error("no key");
        const data = await callAgents({ action: "defend", building: b, scenario: s, result: r, budget: left, feedback: fb });
        const p: Proposal = { repair: data.repair, reasoning: data.reasoning || "", source: "gemini", attempt: fb.length + 1 };
        setProposal(p);
        setPhase("proposed");
        say("defender", `Proposes ${describeRepair(p!.repair)} for £${p!.repair.cost.toLocaleString("en-GB")}.`, "ai");
        return p;
      } catch (e) {
        if (g.configured) say("system", `Gemini repair failed (${e instanceof Error ? e.message : e}). Using deterministic repair search.`, "warn");
        await wait(900);
        const f = fallbackRepair(b, s, [...regs, s], left);
        if (!f) {
          say("defender", "No affordable repair found within the remaining budget.", "warn");
          setPhase("attacked");
          return null;
        }
        const p: Proposal = { ...f, source: "fallback", attempt: fb.length + 1 };
        setProposal(p);
        setPhase("proposed");
        say("defender", `Proposes ${describeRepair(p!.repair)} for £${p!.repair.cost.toLocaleString("en-GB")}.`, "ai");
        return p;
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyFor = async (s: Scenario, p: NonNullable<Proposal>): Promise<RepairAudit> => {
    const { building: b, regressions: regs, budgetLeft: left } = latest.current;
    setBusy(true);
    setPhase("auditing");
    say("judge", "Re-running the target scenario and every stored regression…", "ai");
    await wait(1100);
    const regSet = regs.some((x) => x.id === s.id) ? regs : [...regs, s];
    const a = auditRepair(b, s, p.repair, regSet, left);
    setAudit(a);
    setPassports((prev) => {
      const i = prev.map((x) => x.scenario.id).lastIndexOf(s.id);
      if (i === -1) return prev;
      const copy = [...prev];
      copy[i] = { ...copy[i], repair: p.repair, audit: a };
      setPassportMeta((m) => ({ ...m, [copy[i].id]: { ...(m[copy[i].id] ?? { createdAt: Date.now(), source: p.source }), attempts: p.attempt } }));
      return copy;
    });
    setVerdictFlash({ key: Date.now(), accepted: a.accepted, text: a.accepted ? "REPAIR VERIFIED" : "REPAIR REJECTED" });
    if (a.accepted) {
      say("judge", a.reasons[0], "good");
      if (p.repair.kind === "add_connection") {
        const nb = withConnection(b, p.repair.connection);
        latest.current.building = nb;
        setBuilding(nb);
        setAddedIds((ids) => [...ids, (p.repair as { connection: Connection }).connection.id]);
      } else {
        const id = p.repair.connectionId;
        setScenario((x) => ({ ...x, blockedConnectionIds: x.blockedConnectionIds.filter((y) => y !== id) }));
      }
      setSpent((x) => x + p.repair.cost);
      latest.current.budgetLeft = left - p.repair.cost;
      setFeedback([]);
      setPhase("accepted");
    } else {
      say("judge", a.reasons[0], "bad");
      setFeedback((f) => [...f, { repair: p.repair, reasons: a.reasons }]);
      setPhase("rejected");
    }
    setBusy(false);
    return a;
  };

  /**
   * Signature demo: pre-written proposals (labelled "scripted") so the rejection
   * moment is guaranteed on stage. Every verdict is still computed live by the auditor.
   */
  const runSignatureDemo = useCallback(async () => {
    reset();
    const token = runToken.current;
    await wait(900);
    say("system", "Scripted demo: proposals are pre-written; every verdict below is computed live by the auditor.", "warn");
    setPhase("attacking");
    setBusy(true);
    await wait(1400);
    if (token !== runToken.current) return;
    setBusy(false);
    applyScenario(blockedD4Scenario, "scripted", "D4 is the last step-free link between the east lobby and an exit.", demoBuilding);
    setPhase("attacked");
    latest.current.building = demoBuilding;
    latest.current.regressions = [blockedD4Scenario];
    latest.current.budgetLeft = DEMO_BUDGET;
    for (const [i, repair] of [invalidDemoRepair, validDemoRepair].entries()) {
      await wait(1300);
      if (token !== runToken.current) return;
      setPhase("defending");
      setBusy(true);
      say("defender", `Scripted proposal ${i + 1}…`, "ai");
      await wait(1100);
      if (token !== runToken.current) return;
      const p: NonNullable<Proposal> = {
        repair,
        reasoning:
          i === 0
            ? "Add a second door from Clinic 102 to the East Lobby so the clinic is better connected."
            : "Add a step-free corridor from Clinic 102 to the West Exit, independent of the east lobby.",
        source: "scripted",
        attempt: i + 1,
      };
      setProposal(p);
      setPhase("proposed");
      setBusy(false);
      say("defender", `Proposes ${describeRepair(repair)} for £${repair.cost.toLocaleString("en-GB")}.`, "ai");
      await wait(1500);
      if (token !== runToken.current) return;
      const a = await verifyFor(blockedD4Scenario, p);
      if (a.accepted) break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyScenario, reset, say]);

  /* ---------- autopilot: attacker, defender and judge loop on their own ---------- */
  const [autopilot, setAutopilot] = useState(false);
  const autopilotRef = useRef(false);
  autopilotRef.current = autopilot;
  const runLoopRef = useRef(runLoop);
  runLoopRef.current = runLoop;
  const autopilotBusy = useRef(false);

  useEffect(() => {
    if (!autopilot || autopilotBusy.current) return;
    autopilotBusy.current = true;
    (async () => {
      say("system", "Autopilot engaged: attacker, defender and judge loop until no tested disruption strands anyone.", "ai");
      let clean = 0;
      for (let round = 1; round <= 10; round++) {
        await wait(1400);
        if (!autopilotRef.current) break;
        const status = await runLoopRef.current();
        if (status === "cancelled") break;
        if (status === "stuck") {
          say("system", "Autopilot paused: no repair within budget passed the judge for the last failure.", "warn");
          break;
        }
        clean = status === "hardened" ? clean + 1 : 0;
        if (clean >= 2) {
          say("system", "Autopilot finished: the last two attacks stranded nobody. Download the verified plan below.", "good");
          break;
        }
      }
      autopilotBusy.current = false;
      setAutopilot(false);
    })();
  }, [autopilot, say]);

  return {
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
    budget: DEMO_BUDGET,
    budgetLeft,
    log,
    error,
    busy,
    gemini,
    fragility,
    verdictFlash,
    cameraResetKey,
    attack,
    redesign,
    verify,
    toggleConnection,
    reset,
    runLoop,
    runSignatureDemo,
    autopilot,
    setAutopilot,
    tested,
    resetCamera: () => setCameraResetKey((k) => k + 1),
  };
}

export type DemoController = ReturnType<typeof useDemoController>;

export function describeRepair(r: Repair): string {
  if (r.kind === "add_connection") {
    const c = r.connection;
    return `new ${c.stepFree ? "step-free " : ""}connection ${c.id} (${c.from} ↔ ${c.to}, ${c.length} m)`;
  }
  return `unblocking ${r.connectionId}`;
}
