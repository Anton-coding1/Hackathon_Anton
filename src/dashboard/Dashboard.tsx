"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingPreset } from "@/data/buildings";
import type { Activity } from "@/scene";
import { ControlPanel } from "./ControlPanel";
import { planChanges, type PlanChange } from "@/data/planChanges";
import { autoPlan } from "@/data/autoPlan";
import type { RepairAudit } from "@/contracts/types";
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
  const [exploded, setExploded] = useState(preset.defaultExploded ?? true);
  const [labels, setLabels] = useState(false);
  const [drawer, setDrawer] = useState<"log" | "passports">("log");
  const [preview, setPreview] = useState<string | null>(null);
  const stress = useStressTest(c.building, stressOn, constraints.liftsRecalled);
  const logBox = useRef<HTMLDivElement>(null);
  void autoplay; // the demo never starts by itself: the user presses "Activate fire alarm"
  const [helpOpen, setHelpOpen] = useState(false);
  // The plan as built so far: every verified change applied to walls, rooms and shafts.
  const planned = useMemo(() => planChanges(preset.plan ?? autoPlan(c.building), c.building, c.fixes.map((f) => f.repair)), [preset.plan, c.building, c.fixes]);

  useEffect(() => {
    const el = logBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.log.length]);

  const focus = c.autopilot || c.demoRunning || !!c.sweep || c.phase === "alarm";
  const lastLog = c.log[c.log.length - 1];
  const activity: Activity = c.phase === "attacking" ? "attacking" : c.phase === "defending" ? "defending" : c.phase === "auditing" ? "auditing" : "idle";

  const proposalConn =
    c.proposal?.repair.kind === "add_connection" && ["proposed", "auditing", "rejected"].includes(c.phase)
      ? { connection: c.proposal.repair.connection, status: c.phase === "rejected" ? ("rejected" as const) : ("pending" as const) }
      : null;

  const planSvg = useCallback(() => {
    const repairs = c.fixes.map((f) => ({ repair: f.repair, audit: { accepted: true } as RepairAudit, scenario: f.scenario }));
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
    idle: c.alarm ? "Fire alarm active" : "Normal day",
    alarm: "Fire alarm activated",
    sweeping: c.sweep?.title ?? "Testing blocked paths",
    attacking: "Attacker searching",
    attacked: c.result.unreachableOccupantIds.length ? "Failure found" : "Scenario tested",
    defending: "Defender designing",
    proposed: "Change proposed",
    auditing: "Judge verifying",
    approval: "Waiting for your approval",
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
            <a href="/">Home</a>/
            <select
              className="bsel"
              value={preset.id}
              onChange={(e) => {
                window.location.href = `/lab?b=${e.target.value}`;
              }}
            >
              <option value="tower">Riverside Tower · apartments</option>
              <option value="hospital">St Aldric&apos;s · hospital</option>
              <option value="industrial">Northfield Works · industrial</option>
              <option value="clinic">Blackwood Hall · clinic</option>
              {preset.id === "custom" && <option value="custom">{preset.title} · uploaded</option>}
            </select>
            /<b>Resilience study</b>
          </div>
        </div>
        <div className="top-pills">
          <span className={`pill phase-${c.phase}`}>
            <i />
            {statusText}
          </span>
          <span className="pill-wrap">
            <button className={`pill ${c.gemini.configured ? "pill-ai" : "pill-warn"}`} onClick={() => setHelpOpen((x) => !x)}>
              <i />
              {!c.gemini.checked
                ? "Checking Gemini 4 Argon…"
                : c.gemini.configured
                  ? `${prettyModel(c.gemini.model)} · connected`
                  : c.gemini.status === "model-unavailable"
                    ? `Key works · ${c.gemini.model} not enabled`
                    : c.gemini.status === "invalid-key"
                      ? "Gemini API key rejected"
                      : c.gemini.status === "unreachable"
                        ? "Can't reach Gemini"
                        : "Argon not connected · add API key"}
            </button>
            {helpOpen && (
              <div className="pill-pop" onClick={() => setHelpOpen(false)}>
                {c.gemini.configured ? (
                  <p>
                    <b>{prettyModel(c.gemini.model)}</b> leads the attacker and defender; <b>{prettyModel(c.gemini.fastModel ?? "")}</b> handles quick follow-ups. Every answer is still checked by the judge.
                  </p>
                ) : (
                  <>
                    <p>
                      <b>Why:</b>{" "}
                      {c.gemini.status === "model-unavailable"
                        ? `your key works but "${c.gemini.model}" isn't enabled for it.`
                        : c.gemini.status === "invalid-key"
                          ? "Google rejected the API key."
                          : c.gemini.status === "unreachable"
                            ? "the server couldn't reach Google."
                            : "the server can't find GEMINI_API_KEY."}{" "}
                      Built-in agents run meanwhile, and every verdict is identical either way.
                    </p>
                    <p>
                      <b>Fix:</b> in the project folder run
                    </p>
                    <code>echo &quot;GEMINI_API_KEY=your-key&quot; &gt; .env.local</code>
                    {c.gemini.status === "model-unavailable" && <code>echo &quot;GEMINI_MODEL=gemini-3.8-flash&quot; &gt;&gt; .env.local</code>}
                    <p>then stop the app (Ctrl+C) and run npm run dev again.</p>
                  </>
                )}
              </div>
            )}
          </span>
          <span className="pill">{preset.sector}</span>
          <button className="pill pill-btn" onClick={() => setPreview(planSvg())}>
            View plan{verifiedCount ? ` · ${verifiedCount} change${verifiedCount > 1 ? "s" : ""}` : ""}
          </button>
        </div>
      </header>

      <main className={`stage ${focus ? "is-focus" : ""}`}>
        <BuildingScene
          building={c.building}
          scenario={c.preview?.scenario ?? c.scenario}
          result={c.preview?.result ?? c.result}
          plan={planned.plan}
          anchors={planned.anchors}
          addedConnectionIds={c.addedIds}
          proposal={proposalConn}
          activity={activity}
          heat={stress.heat}
          exploded={exploded}
          labelMode={focus || !labels ? "minimal" : "all"}
          cameraResetKey={c.cameraResetKey}
          framing={focus ? { visibleFraction: 0.95, offset: [0, -1.5, 1] } : { visibleFraction: 0.62, offset: [2.5, -2, 3.5] }}
        />
        <div className="viewport-tag">
          <b>3D model</b> · {exploded ? "exploded axonometric" : "stacked"} · {stress.done ? `${stress.evaluated.toLocaleString("en-GB")} stress scenarios checked` : `${(stress.perSecond || 0).toLocaleString("en-GB")} scenarios/s`}
        </div>
        {!c.alarm && !focus && !c.report && c.fixes.length === 0 && (
          <div className="cta-overlay">
            <p>Normal day. Everyone can get out. What happens when the fire alarm goes off?</p>
            <button className="cta-fire" onClick={() => c.activateAlarm()}>
              <span>🔔</span> Activate fire alarm
            </button>
            <small>The AI agents then test every escape route themselves. You don&apos;t choose anything.</small>
          </div>
        )}
        {c.alarm && (
          <div className="fire-banner">
            <span className="fire-dot" />
            Fire alarm activated · lifts recalled · AI agents testing every escape route
          </div>
        )}
        {!c.alarm && !focus && (
          <div className="normal-banner">
            <span /> Normal day · {c.result.totalCount} people tracked
          </div>
        )}
        {focus && (
          <div className="focus-hud">
            <span className={`hud-dot phase-${c.phase}`} />
            <div className="hud-text">
              <b>{statusText}</b>
              {c.sweep ? (
                <span>
                  {c.sweep.index}/{c.sweep.total} · Fire blocks {c.sweep.label} →{" "}
                  <strong className={c.sweep.ok ? "ok" : "bad"}>{c.sweep.ok ? "another way out ✓" : "someone trapped ✕"}</strong>
                </span>
              ) : (
                <span>{lastLog?.text}</span>
              )}
            </div>
            {c.sweep && (
              <div className="hud-progress">
                <i style={{ width: `${(100 * c.sweep.index) / c.sweep.total}%` }} />
              </div>
            )}
            <div className="hud-stats">
              <span>
                <b>{c.runs.attacker}</b> attacks
              </span>
              <span>
                <b>{c.fixes.length}</b> fixes
              </span>
              <span>
                <b>£{c.spent.toLocaleString("en-GB")}</b> spent
              </span>
            </div>
            <button className="hud-stop" onClick={() => c.resetAll()}>
              Stop
            </button>
          </div>
        )}
        {c.approval && (
          <div className="approval">
            <span className="kicker-sm">Your decision</span>
            <b>{describeRepair(c.approval.proposal.repair)}</b>
            <p>
              Fixes <em>{c.approval.scenarioName}</em>. The judge has verified it works. It costs <strong>£{c.approval.proposal.repair.cost.toLocaleString("en-GB")}</strong>, which is over your £
              {constraints.approveOver.toLocaleString("en-GB")} limit.
            </p>
            <div className="dl">
              <button className="btn btn-sm btn-dark" onClick={() => c.approval?.resolve(true)}>
                Approve £{c.approval.proposal.repair.cost.toLocaleString("en-GB")}
              </button>
              <button className="btn btn-sm" onClick={() => c.approval?.resolve(false)}>
                Decline, find cheaper
              </button>
            </div>
          </div>
        )}
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

      {c.report && !preview && <ReportModal c={c} changes={planned.changes} onDownload={onDownload} onPlan={() => setPreview(planSvg())} />}

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

function prettyModel(id: string): string {
  if (/argon/i.test(id)) return "Gemini 4 Argon";
  const m = id.match(/gemini-([\d.]+)-(flash-lite|flash|pro)/i);
  return m ? `Gemini ${m[1]} ${m[2].replace("-", " ").replace(/\b\w/g, (x) => x.toUpperCase())}` : id;
}

function ReportModal({ c, changes, onDownload, onPlan }: { c: ReturnType<typeof useDemoController>; changes: PlanChange[]; onDownload: (k: "svg" | "png" | "json") => void; onPlan: () => void }) {
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
            <b>{ok ? "Everyone can get out" : "Not everyone can get out yet"}</b>
            <span>
              {ok
                ? `With the fire alarm on and lifts recalled, whichever ${r.certificate.tolerance === 1 ? "path" : `${r.certificate.tolerance} paths`} fire blocks, everyone still has another way out. ${r.certificate.scenariosChecked} scenarios checked exhaustively.`
                : `${r.certificate.failures.length} combination(s) still strand someone${r.remaining ? `, e.g. ${r.remaining.blockedConnectionIds.join(" + ")}` : ""}. Raise the budget or allow more repair types and run again.`}
            </span>
          </div>
          <h4>What the agents found, and what fixed it</h4>
          {r.fixes.length === 0 ? (
            <p className="muted">No changes were needed.</p>
          ) : (
            <ol className="fixes">
              {r.fixes.map((f, i) => (
                <li key={i}>
                  <div className="fx-scn">
                    <span className="fx-n">{i + 1}</span>
                    <div>
                      <b>{f.scenario.name.replace(" (found by exhaustive sweep)", "")}</b>
                      <span>
                        {f.stranded.map((id) => c.building.occupants.find((o) => o.id === id)?.label ?? id).join(", ")} would have been trapped
                      </span>
                    </div>
                  </div>
                  <div className="fx-fix">
                    <span className="fx-arrow">Change {i + 1} · £{f.repair.cost.toLocaleString("en-GB")}</span>
                    <b>{changes[i]?.title ?? describeRepair(f.repair)}</b>
                    <span>{changes[i]?.detail}</span>
                    <span className="fx-src">
                      {f.source === "gemini" ? "Designed by Gemini 4 Argon" : f.source === "scripted" ? "Scripted proposal" : "Lowest-cost fix found by search"}
                      {f.rejected ? ` · ${f.rejected} earlier idea(s) rejected by the judge` : ""} · verified
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
