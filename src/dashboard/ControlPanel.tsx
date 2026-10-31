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
          className={`btn btn-fire ${c.alarm ? "is-running" : ""}`}
          disabled={c.busy && !c.alarm}
          onClick={() => (c.alarm ? c.resetAll() : c.activateAlarm())}
        >
          <span className="btn-icon">{c.alarm ? "■" : "🔔"}</span>
          <span>
            {c.alarm ? "Stop and reset" : "Activate fire alarm"}
            <small>{c.gemini.configured ? "Gemini 4 Argon tests every escape route" : "AI agents test every escape route"}</small>
          </span>
        </button>
        <div className="agents">
          <div className={`agent a-att ${role("attacker")}`}>
            <i />
            <b>Attacker</b>
            <span>{c.gemini.configured ? "Argon" : "search"}</span>
          </div>
          <div className={`agent a-def ${role("defender")}`}>
            <i />
            <b>Defender</b>
            <span>{c.gemini.configured ? "Argon + Flash" : "search"}</span>
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
          <h3>Stress test {stress.done ? <span className="tag-done">complete</span> : <span className="tag-run">running</span>}</h3>
          <label className="switch">
            <input type="checkbox" checked={stressOn} onChange={(e) => setStressOn(e.target.checked)} />
            <span />
          </label>
        </div>
        <div className="kpi">
          <b>{fmt(stress.evaluated)}</b>
          <span>
            of {stress.target.toLocaleString("en-GB")} random failure scenarios{stress.done ? ` · ${stress.seconds.toFixed(1)} s` : ""}
          </span>
        </div>
        <div className="kpi-row">
          <div>
            <b>{fmt(stress.done ? Math.round(stress.evaluated / Math.max(stress.seconds, 0.001)) : stress.perSecond)}</b>
            <span>{stress.done ? "avg / second" : "per second"}</span>
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
        <p className="hint">Random 1–3 link failures, each solved by the engine. Runs once per design and again after every verified change.</p>
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
        <details className="adv">
          <summary>Advanced</summary>
        <div className="field" style={{ marginTop: 10 }}>
          <span>Resilience target</span>
          <div className="seg">
            {([1, 2] as const).map((t) => (
              <button
                key={t}
                className={constraints.tolerance === t ? "on" : ""}
                disabled={c.busy || (t === 2 && c.building.connections.length > 45)}
                title={t === 2 && c.building.connections.length > 45 ? "Too many combinations to check live for a building this size" : undefined}
                onClick={() => setConstraints({ ...constraints, tolerance: t })}>
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
            Lifts recalled even without an alarm
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
        </details>
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
          <button className={!labels ? "on" : ""} onClick={() => setLabels(false)}>
            Key labels
          </button>
          <button className={labels ? "on" : ""} onClick={() => setLabels(true)}>
            All labels
          </button>
        </div>
        <button className="link" onClick={c.resetCamera}>
          Reset camera
        </button>
      </section>

      <p className="disclaimer">Connectivity model of a fictional building. Not fire-safety software: no fire, smoke, crowd or evacuation-time modelling.</p>
    </aside>
  );
}
