"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingPreset } from "@/data/buildings";
import type { Activity } from "@/scene";
import { ControlPanel } from "./ControlPanel";
import { FailurePassport } from "./FailurePassport";
import { buildPlanSvg, downloadPng, downloadText } from "./planExport";
import { ResultsPanel } from "./ResultsPanel";
import { defaultConstraints, describeRepair, useDemoController, type Constraints } from "./useDemoController";
import { useStressTest } from "./useStressTest";

const BuildingScene = dynamic(() => import("@/scene/BuildingScene").then((m) => m.BuildingScene), {
  ssr: false,
  loading: () => <div className="scene-loading">Loading model…</div>,
});

export function Dashboard({ preset, autoplay = false }: { preset: BuildingPreset; autoplay?: boolean }) {
  const [constraints, setConstraints] = useState<Constraints>(() => defaultConstraints(preset));
  const c = useDemoController(preset, constraints);
  const [stressOn, setStressOn] = useState(true);
  const [exploded, setExploded] = useState(true);
  const [labels, setLabels] = useState(true);
  const [drawer, setDrawer] = useState<"log" | "passports">("log");
  const [preview, setPreview] = useState<string | null>(null);
  const stress = useStressTest(c.building, stressOn, constraints.liftsRecalled);
  const logBox = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);
  const startAutopilot = useRef(c.setAutopilot);
  startAutopilot.current = c.setAutopilot;
  useEffect(() => {
    if (!autoplay || autoStarted.current || !c.gemini.checked) return;
    autoStarted.current = true;
    setTimeout(() => startAutopilot.current(true), 2500);
  }, [autoplay, c.gemini.checked]);

  useEffect(() => {
    const el = logBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.log.length]);

  const activity: Activity = c.phase === "attacking" ? "attacking" : c.phase === "defending" ? "defending" : c.phase === "auditing" ? "auditing" : "idle";

  const proposalConn =
    c.proposal?.repair.kind === "add_connection" && ["proposed", "auditing", "rejected"].includes(c.phase)
      ? { connection: c.proposal.repair.connection, status: c.phase === "rejected" ? ("rejected" as const) : ("pending" as const) }
      : null;

  const planSvg = useCallback(() => {
    const repairs = c.passports.filter((p) => p.repair).map((p) => ({ repair: p.repair!, audit: p.audit, scenario: p.scenario }));
    const last = [...c.passports].reverse().find((p) => p.audit?.accepted)?.audit;
    return buildPlanSvg({
      building: c.building,
      plan: preset.plan,
      runs: c.runs,
      scenariosEvaluated: stress.evaluated,
      rates: c.rates,
      result: c.result,
      repairs,
      budget: c.budget,
      regressionsPassed: last ? { passed: last.regressions.filter((g) => g.passed).length, total: last.regressions.length } : undefined,
      certificate: { faultFree: c.certificate.faultFree, tolerance: c.certificate.tolerance, checked: c.certificate.scenariosChecked },
    });
  }, [c.building, c.budget, c.passports, c.result, c.certificate, c.runs, c.rates, preset.plan, stress.evaluated]);

  const onDownload = useCallback(
    async (kind: "svg" | "png" | "json") => {
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = preset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (kind === "svg") downloadText(`${slug}-verified-plan-${stamp}.svg`, planSvg(), "image/svg+xml");
      else if (kind === "png") await downloadPng(`${slug}-verified-plan-${stamp}.png`, planSvg());
      else
        downloadText(
          `exitzero-report-${stamp}.json`,
          JSON.stringify({ building: c.building, scenario: c.scenario, result: c.result, passports: c.passports, meta: c.passportMeta, agentRuns: c.runs, stress, costModel: c.rates, constraints }, null, 2),
          "application/json",
        );
    },
    [planSvg, c, stress, constraints, preset.title],
  );

  const statusText = {
    idle: "Ready",
    attacking: "Attacker searching",
    attacked: c.result.unreachableOccupantIds.length ? "Failure found" : "Scenario tested",
    defending: "Defender designing",
    proposed: "Change proposed",
    auditing: "Judge verifying",
    accepted: "Change verified",
    rejected: "Change rejected",
  }[c.phase];

  const verifiedCount = useMemo(() => c.passports.filter((p) => p.audit?.accepted).length, [c.passports]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">
            <span className="mark" />
            Exit<b>Zero</b>
          </div>
          <div className="crumbs">
            <a href="/">Home</a>/<span>{preset.title}</span>/<b>Resilience study</b>
          </div>
        </div>
        <div className="top-pills">
          <span className={`pill phase-${c.phase}`}>
            <i />
            {statusText}
          </span>
          <span className="pill mono">{c.scenario.id}</span>
          <span className={`pill ${c.gemini.configured ? "pill-ai" : "pill-warn"}`} title={c.gemini.configured ? "Gemini agents active" : "Set GEMINI_API_KEY on the server to enable Gemini"}>
            <i />
            {!c.gemini.checked ? "Checking Gemini…" : c.gemini.configured ? `Gemini · ${c.gemini.model}` : "Gemini not connected"}
          </span>
          <span className="pill">{preset.sector}</span>
          <button className="pill pill-btn" onClick={() => setPreview(planSvg())}>
            View plan{verifiedCount ? ` · ${verifiedCount} change${verifiedCount > 1 ? "s" : ""}` : ""}
          </button>
        </div>
      </header>

      <main className="stage">
        <BuildingScene
          building={c.building}
          scenario={c.scenario}
          result={c.result}
          plan={preset.plan}
          onConnectionClick={c.toggleConnection}
          addedConnectionIds={c.addedIds}
          proposal={proposalConn}
          activity={activity}
          heat={stress.heat}
          exploded={exploded}
          showLabels={labels}
          cameraResetKey={c.cameraResetKey}
          framing={{ visibleFraction: 0.62, offset: [2.5, -2, 3.5] }}
        />
        <div className="viewport-tag">
          <b>3D model</b> · {exploded ? "exploded axonometric" : "stacked"} · {(stress.perSecond || 0).toLocaleString("en-GB")} scenarios/s
        </div>
        {c.verdictFlash && <VerdictStamp key={c.verdictFlash.key} accepted={c.verdictFlash.accepted} text={c.verdictFlash.text} />}
        <ControlPanel c={c} stress={stress} stressOn={stressOn} setStressOn={setStressOn} exploded={exploded} setExploded={setExploded} labels={labels} setLabels={setLabels} constraints={constraints} setConstraints={setConstraints} />
        <ResultsPanel c={c} stress={stress} onDownload={onDownload} />

        <section className="drawer">
          <nav>
            <button className={drawer === "log" ? "on" : ""} onClick={() => setDrawer("log")}>
              Activity
            </button>
            <button className={drawer === "passports" ? "on" : ""} onClick={() => setDrawer("passports")}>
              Failure passports <span className="count">{c.passports.length}</span>
            </button>
            <span className="drawer-meta">Regression suite · {c.regressions.length} scenario(s)</span>
          </nav>
          {drawer === "log" ? (
            <div className="log" ref={logBox}>
              {c.log.map((e) => (
                <div key={e.id} className={`log-row role-${e.role} tone-${e.tone ?? "none"}`}>
                  <time>{new Date(e.at).toLocaleTimeString("en-GB")}</time>
                  <span className="who">{e.role}</span>
                  <span className="what">{e.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="passports">
              {c.passports.length === 0 ? (
                <p className="muted">No failures discovered yet. Run the autopilot.</p>
              ) : (
                [...c.passports].reverse().map((p) => <FailurePassport key={p.id} passport={p} meta={c.passportMeta[p.id]} />)
              )}
            </div>
          )}
        </section>
      </main>

      {c.report && !preview && <ReportModal c={c} onDownload={onDownload} onPlan={() => setPreview(planSvg())} />}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>Verified floor plan</b>
              <span className="muted small">Generated from the current building and the judge's verdicts</span>
              <div className="dl">
                <button className="btn btn-sm btn-dark" onClick={() => onDownload("png")}>
                  Download PNG
                </button>
                <button className="btn btn-sm" onClick={() => onDownload("svg")}>
                  SVG
                </button>
                <button className="btn btn-sm" onClick={() => setPreview(null)}>
                  Close
                </button>
              </div>
            </header>
            <div className="plan-frame" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReportModal({ c, onDownload, onPlan }: { c: ReturnType<typeof useDemoController>; onDownload: (k: "svg" | "png" | "json") => void; onPlan: () => void }) {
  const r = c.report!;
  const ok = r.status === "fault-free";
  return (
    <div className="modal" onClick={() => c.setReport(null)}>
      <div className="modal-card report" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Resilience report · {c.preset.title}</b>
          <span className={`badge ${ok ? "badge-engine" : "badge-fallback"}`}>{ok ? "fault-free" : "failures remain"}</span>
          <div className="dl">
            <button className="btn btn-sm" onClick={() => c.setReport(null)}>
              Close
            </button>
          </div>
        </header>
        <div className="report-body">
          <div className={`report-hero ${ok ? "ok" : "bad"}`}>
            <b>{ok ? "Certified fault-free" : "Not yet fault-free"}</b>
            <span>
              {ok
                ? `No combination of up to ${r.certificate.tolerance} blocked connection(s) strands anyone. ${r.certificate.scenariosChecked} combinations checked exhaustively by the engine.`
                : `${r.certificate.failures.length} combination(s) still strand someone${r.remaining ? `, e.g. ${r.remaining.blockedConnectionIds.join(" + ")}` : ""}. Raise the budget or allow more repair types and run again.`}
            </span>
          </div>
          <h4>Scenarios the agents found, and what fixed them</h4>
          {r.fixes.length === 0 ? (
            <p className="muted">No changes were needed.</p>
          ) : (
            <ol className="fixes">
              {r.fixes.map((f, i) => (
                <li key={i}>
                  <div className="fx-scn">
                    <span className="fx-n">{i + 1}</span>
                    <div>
                      <b>{f.scenario.name}</b>
                      <span>
                        Blocked {f.scenario.blockedConnectionIds.join(" + ")} → {f.stranded.join(", ")} had no route
                      </span>
                    </div>
                  </div>
                  <div className="fx-fix">
                    <span className="fx-arrow">Introduced</span>
                    <b>{describeRepair(f.repair)}</b>
                    <span>
                      £{f.repair.cost.toLocaleString("en-GB")} · {f.source === "gemini" ? "proposed by Gemini" : f.source === "scripted" ? "scripted proposal" : "deterministic defender"}
                      {f.rejected ? ` · ${f.rejected} earlier proposal(s) rejected by the judge` : ""} · verified
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="report-totals">
            <div>
              <b>£{r.totalCost.toLocaleString("en-GB")}</b>
              <span>total of £{c.budget.toLocaleString("en-GB")} budget</span>
            </div>
            <div>
              <b>{c.runs.attacker}</b>
              <span>attacks</span>
            </div>
            <div>
              <b>{c.runs.defender}</b>
              <span>proposals</span>
            </div>
            <div>
              <b>{c.runs.judge}</b>
              <span>judge verdicts</span>
            </div>
            <div>
              <b>{c.runs.geminiCalls}</b>
              <span>Gemini calls</span>
            </div>
          </div>
          <div className="dl">
            <button className="btn btn-sm btn-dark" onClick={() => onDownload("png")}>
              Download final floor plan (PNG)
            </button>
            <button className="btn btn-sm" onClick={() => onDownload("svg")}>
              SVG
            </button>
            <button className="btn btn-sm" onClick={onPlan}>
              Preview plan
            </button>
            <button className="btn btn-sm" onClick={() => onDownload("json")}>
              Report JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerdictStamp({ accepted, text }: { accepted: boolean; text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 2600);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className={`stamp ${accepted ? "pass" : "fail"}`}>
      <span className="stamp-icon">{accepted ? "✓" : "✕"}</span>
      <div>
        {text}
        <small>{accepted ? "Independently verified by the judge" : "The judge does not trust the AI"}</small>
      </div>
    </div>
  );
}
