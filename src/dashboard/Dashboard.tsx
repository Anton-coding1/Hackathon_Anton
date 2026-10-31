"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoPlan } from "@/data/demoPlan";
import type { Activity } from "@/scene";
import { ControlPanel } from "./ControlPanel";
import { FailurePassport } from "./FailurePassport";
import { buildPlanSvg, downloadPng, downloadText } from "./planExport";
import { ResultsPanel } from "./ResultsPanel";
import { useDemoController } from "./useDemoController";
import { useStressTest } from "./useStressTest";

const BuildingScene = dynamic(() => import("@/scene/BuildingScene").then((m) => m.BuildingScene), {
  ssr: false,
  loading: () => <div className="scene-loading">Loading model…</div>,
});

export function Dashboard() {
  const c = useDemoController();
  const [stressOn, setStressOn] = useState(true);
  const [exploded, setExploded] = useState(true);
  const [labels, setLabels] = useState(true);
  const [drawer, setDrawer] = useState<"log" | "passports">("log");
  const [preview, setPreview] = useState<string | null>(null);
  const stress = useStressTest(c.building, stressOn);
  const logBox = useRef<HTMLDivElement>(null);

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
    const repairs = c.passports.filter((p) => p.repair).map((p) => ({ repair: p.repair!, audit: p.audit }));
    const last = [...c.passports].reverse().find((p) => p.audit?.accepted)?.audit;
    return buildPlanSvg({
      building: c.building,
      plan: demoPlan,
      result: c.result,
      repairs,
      budget: c.budget,
      regressionsPassed: last ? { passed: last.regressions.filter((g) => g.passed).length, total: last.regressions.length } : undefined,
    });
  }, [c.building, c.budget, c.passports, c.result]);

  const onDownload = useCallback(
    async (kind: "svg" | "png" | "json") => {
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "svg") downloadText(`blackwood-hall-verified-plan-${stamp}.svg`, planSvg(), "image/svg+xml");
      else if (kind === "png") await downloadPng(`blackwood-hall-verified-plan-${stamp}.png`, planSvg());
      else
        downloadText(
          `exitzero-report-${stamp}.json`,
          JSON.stringify({ building: c.building, scenario: c.scenario, result: c.result, passports: c.passports, meta: c.passportMeta, stress: { ...stress, heat: stress.heat } }, null, 2),
          "application/json",
        );
    },
    [planSvg, c, stress],
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
            <span>Projects</span>/<span>Blackwood Hall</span>/<b>Resilience study</b>
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
          plan={demoPlan}
          onConnectionClick={c.toggleConnection}
          addedConnectionIds={c.addedIds}
          proposal={proposalConn}
          activity={activity}
          heat={stress.heat}
          exploded={exploded}
          showLabels={labels}
          cameraResetKey={c.cameraResetKey}
        />
        <div className="viewport-tag">
          <b>3D model</b> · {exploded ? "exploded axonometric" : "stacked"} · {(stress.perSecond || 0).toLocaleString("en-GB")} scenarios/s
        </div>
        {c.verdictFlash && <VerdictStamp key={c.verdictFlash.key} accepted={c.verdictFlash.accepted} text={c.verdictFlash.text} />}
        <ControlPanel c={c} stress={stress} stressOn={stressOn} setStressOn={setStressOn} exploded={exploded} setExploded={setExploded} labels={labels} setLabels={setLabels} />
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
