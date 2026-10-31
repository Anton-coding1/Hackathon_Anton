"use client";

import type { StressStats } from "./useStressTest";
import type { Constraints, DemoController, RepairKind } from "./useDemoController";

const fmt = (n: number) => n.toLocaleString("en-GB");

export function ControlPanel({
  c,
  stress,
  stressOn,
  setStressOn,
  exploded,
  setExploded,
  labels,
  setLabels,
  constraints,
  setConstraints,
}: {
  c: DemoController;
  stress: StressStats;
  stressOn: boolean;
  setStressOn: (v: boolean) => void;
  exploded: boolean;
  setExploded: (v: boolean) => void;
  labels: boolean;
  setLabels: (v: boolean) => void;
  constraints: Constraints;
  setConstraints: (c: Constraints) => void;
}) {
  const hasLifts = c.building.connections.some((x) => x.kind === "lift");
  const canRedesign = !c.busy && c.result.unreachableOccupantIds.length > 0 && c.phase !== "accepted";
  const canVerify = !c.busy && !!c.proposal && c.phase === "proposed";
  const failPct = stress.evaluated ? (100 * stress.failing) / stress.evaluated : 0;
  const role = (r: "attacker" | "defender" | "judge") => {
    const live = (r === "attacker" && c.phase === "attacking") || (r === "defender" && c.phase === "defending") || (r === "judge" && c.phase === "auditing");
    return live ? "is-live" : "";
  };

  return (
    <aside className="panel panel-left">
      <section>
        <h3>AI agents</h3>
        <button
          className={`btn btn-primary ${c.autopilot ? "is-running" : ""}`}
          disabled={c.busy && !c.autopilot}
          onClick={() => (c.autopilot ? c.reset() : c.setAutopilot(true))}
        >
          <span className="btn-icon">{c.autopilot ? "■" : "▶"}</span>
          <span>
            {c.autopilot ? "Stop autopilot" : "Run autopilot"}
            <small>{c.gemini.configured ? `Gemini ${c.gemini.model} · attack → repair → judge` : "deterministic agents · add a Gemini key to use Gemini"}</small>
          </span>
        </button>
        <div className="agents">
          <div className={`agent a-att ${role("attacker")}`}>
            <i />
            <b>Attacker</b>
            <span>{c.gemini.configured ? "Gemini" : "search"}</span>
          </div>
          <div className={`agent a-def ${role("defender")}`}>
            <i />
            <b>Defender</b>
            <span>{c.gemini.configured ? "Gemini" : "search"}</span>
          </div>
          <div className={`agent a-jud ${role("judge")}`}>
            <i />
            <b>Judge</b>
            <span>engine</span>
          </div>
        </div>
      </section>

      <section className="stress">
        <div className="sec-head">
          <h3>Live stress test</h3>
          <label className="switch">
            <input type="checkbox" checked={stressOn} onChange={(e) => setStressOn(e.target.checked)} />
            <span />
          </label>
        </div>
        <div className="kpi">
          <b>{fmt(stress.evaluated)}</b>
          <span>failure scenarios evaluated</span>
        </div>
        <div className="kpi-row">
          <div>
            <b>{fmt(stress.perSecond)}</b>
            <span>per second</span>
          </div>
          <div>
            <b className={failPct > 0 ? "bad" : "good"}>{failPct.toFixed(1)}%</b>
            <span>strand someone</span>
          </div>
          <div>
            <b>{stress.failureModes}</b>
            <span>failure modes</span>
          </div>
        </div>
        <p className="hint">Random 1–3 link failures, each solved by the deterministic engine. Restarts on every verified change.</p>
      </section>

      <section>
        <h3>Design constraints</h3>
        <label className="field">
          <span>
            Budget <b>£{constraints.budget.toLocaleString("en-GB")}</b>
          </span>
          <input
            type="range"
            min={5000}
            max={300000}
            step={5000}
            value={constraints.budget}
            disabled={c.busy}
            onChange={(e) => setConstraints({ ...constraints, budget: Number(e.target.value) })}
          />
        </label>
        <div className="field" style={{ marginTop: 10 }}>
          <span>Resilience target</span>
          <div className="seg">
            {([1, 2] as const).map((t) => (
              <button key={t} className={constraints.tolerance === t ? "on" : ""} disabled={c.busy} onClick={() => setConstraints({ ...constraints, tolerance: t })}>
                Any {t} failure{t > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={constraints.liftsRecalled}
            disabled={c.busy}
            onChange={(e) => setConstraints({ ...constraints, liftsRecalled: e.target.checked })}
          />
          <span>
            Assume lifts are recalled in an emergency
            <small>{hasLifts ? "Non-evacuation lifts become unusable in every scenario" : "No lifts in this building"}</small>
          </span>
        </label>
        <div className="chips">
          {(["corridor", "stairs", "lift", "ramp", "unblock"] as RepairKind[]).map((k) => (
            <button
              key={k}
              className={constraints.allow[k] ? "on" : ""}
              disabled={c.busy}
              onClick={() => setConstraints({ ...constraints, allow: { ...constraints.allow, [k]: !constraints.allow[k] } })}
            >
              {k === "unblock" ? "reopen" : k}
            </button>
          ))}
        </div>
        <p className="hint">Repair types the defender may propose. The judge rejects anything outside them.</p>
      </section>

      <section>
        <h3>Step through</h3>
        <div className="step-grid">
          <button className="btn btn-sm" disabled={c.busy} onClick={() => c.attack()}>
            Attack
          </button>
          <button className="btn btn-sm" disabled={!canRedesign} onClick={() => c.redesign()}>
            Redesign
          </button>
          <button className="btn btn-sm" disabled={!canVerify} onClick={() => c.verify()}>
            Judge
          </button>
          <button className="btn btn-sm" onClick={() => c.reset()}>
            Reset
          </button>
        </div>
        {c.preset.scripted && (
          <button className="btn btn-sm btn-quiet" disabled={c.busy} onClick={() => c.runSignatureDemo()}>
            Scripted demo · guaranteed rejection
          </button>
        )}
      </section>

      <section>
        <h3>View</h3>
        <div className="seg">
          <button className={exploded ? "on" : ""} onClick={() => setExploded(true)}>
            Exploded
          </button>
          <button className={!exploded ? "on" : ""} onClick={() => setExploded(false)}>
            Stacked
          </button>
        </div>
        <div className="seg">
          <button className={labels ? "on" : ""} onClick={() => setLabels(true)}>
            Labels
          </button>
          <button className={!labels ? "on" : ""} onClick={() => setLabels(false)}>
            Clean
          </button>
        </div>
        <button className="link" onClick={c.resetCamera}>
          Reset camera
        </button>
        <p className="hint">Click any corridor or stair to block it manually; the engine re-solves instantly.</p>
      </section>

      <p className="disclaimer">Connectivity model of a fictional building. Not fire-safety software: no fire, smoke, crowd or evacuation-time modelling.</p>
    </aside>
  );
}
