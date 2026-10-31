"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { PRESETS } from "@/data/buildings";
import { certify, describeBlocked, simulate } from "@/engine";
import type { Scenario } from "@/contracts/types";
import { UploadPanel } from "./UploadPanel";
import "./landing.css";

const BuildingScene = dynamic(() => import("@/scene/BuildingScene").then((m) => m.BuildingScene), {
  ssr: false,
  loading: () => <div className="l-scene-loading">Loading model…</div>,
});

export function Landing() {
  const bid = "tower" as const;
  const preset = PRESETS[bid];
  const b = preset.building;
  const lifts = useMemo(() => b.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id), [b]);
  const alarmScenario: Scenario = useMemo(() => ({ id: "FIRE_ALARM", name: "Fire alarm", blockedConnectionIds: lifts }), [lifts]);
  const alarmResult = useMemo(() => simulate(b, alarmScenario), [b, alarmScenario]);
  // A deterministic sample of the sweep: every scenario that traps someone extra, plus some that don't.
  const sample = useMemo(() => {
    const all = certify(b, 1, lifts, { collectAll: true, skipEvacuationLifts: true }).all ?? [];
    const base = new Set(alarmResult.unreachableOccupantIds);
    const tagged = all.map((it) => ({ ...it, extra: it.result.unreachableOccupantIds.filter((id) => !base.has(id)) }));
    const bad = tagged.filter((t) => t.extra.length);
    const good = tagged.filter((t) => !t.extra.length).filter((_, k) => k % 6 === 0);
    const out: typeof tagged = [];
    for (let k = 0; k < Math.max(bad.length, good.length); k++) {
      if (good[k]) out.push(good[k]);
      if (bad[k]) out.push(bad[k]);
    }
    return { items: out.slice(0, 22), total: all.length, badTotal: bad.length };
  }, [b, lifts, alarmResult]);

  const [step, setStep] = useState(0); // 0 normal · 1 alarm · 2..n sweep · last verdict
  const [playing, setPlaying] = useState(false);
  const last = sample.items.length + 2;
  // Waits for a click, then plays once: alarm → sweep → verdict.
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const ms = step === 0 ? 300 : step === 1 ? 2600 : 480;
    const t = setTimeout(() => setStep((x) => x + 1), ms);
    return () => clearTimeout(t);
  }, [step, last, playing]);
  const start = () => {
    setStep(0);
    setPlaying(true);
  };

  const phase = step === 0 ? "normal" : step === 1 ? "alarm" : step === last ? "verdict" : "sweep";
  const current = phase === "sweep" ? sample.items[step - 2] : null;
  const shownScenario = phase === "normal" ? { id: "BASE", name: "Normal day", blockedConnectionIds: [] } : current?.scenario ?? alarmScenario;
  const result = useMemo(() => (current ? current.result : simulate(b, shownScenario)), [b, current, shownScenario]);
  const ticker = phase === "sweep" || phase === "verdict" ? sample.items.slice(Math.max(0, Math.min(step - 2, sample.items.length) - 5), Math.min(step - 1, sample.items.length)) : [];
  const atRisk = result.unreachableOccupantIds.length > 0;
  const nameOf = (id: string) => b.occupants.find((o) => o.id === id)?.label.toLowerCase() ?? id;
  /** "two wheelchair users", "a resident and a wheelchair user" */
  const people = (ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(nameOf(id), (counts.get(nameOf(id)) ?? 0) + 1);
    const words = ["", "a", "two", "three", "four", "five"];
    const parts = [...counts].map(([label, n]) => (n === 1 ? `the ${label}` : `${words[n] ?? n} ${label}s`));
    return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  };

  return (
    <div className="landing">
      <nav className="l-nav">
        <a className="l-logo" href="/">
          <span className="mark" />
          ExitZero
        </a>
        <div className="l-links">
          <a href="#demo">Product</a>
          <a href="#how">Method</a>
          <a href="#trust">About</a>
        </div>
        <a className="l-btn l-btn-small" href="/lab?b=industrial">
          Open the lab
        </a>
      </nav>

      <header className="l-hero2" id="demo">
        <div className="l-hero-copy">
          <p className="kicker">Adversarial building resilience · Gemini 4 Argon</p>
          <h1>
            Find the door that strands someone.
            <span> Before it happens.</span>
          </h1>
          <p className="l-sub">
            Gemini 4 Argon attacks your floor plan, designs costed fixes and argues with an independent judge until no single failure can trap anyone, down to the lift that gets recalled when the fire alarm sounds.
          </p>
          <div className="l-ctas">
            <a className="l-btn l-btn-primary" href={`/lab?b=${bid}`}>
              Run the live demo
            </a>
            <a className="l-btn" href="#upload">
              Upload your floor plan
            </a>
          </div>
          <div className="l-stats">
            <div>
              <b>&lt; 3 min</b>
              <span>to a certified fault-free plan</span>
            </div>
            <div>
              <b>20,000</b>
              <span>failure scenarios per design</span>
            </div>
            <div>
              <b>0</b>
              <span>unverified AI claims shipped</span>
            </div>
          </div>
        </div>

        <div className="l-demo-card l-hero-card">
          <div className="l-demo-scene">
            <BuildingScene building={b} scenario={shownScenario} result={result} plan={preset.plan} labelMode="minimal" exploded={preset.defaultExploded ?? true} />
            <div className={`l-verdict-float ${atRisk ? "risk" : "ok"}`}>
              <b>{atRisk ? "AT RISK" : "ALL CLEAR"}</b>
              <span>
                {result.reachableCount}/{result.totalCount} can reach an eligible exit
              </span>
            </div>
            {phase !== "normal" && <div className="l-fire">FIRE ALARM · LIFTS RECALLED</div>}
            {phase === "normal" && !playing && (
              <button className="l-scene-cta" onClick={start}>
                🔔 Activate fire alarm
              </button>
            )}
            <div className="l-scene-tag">Live engine · every route solved in your browser</div>
          </div>
          <aside className="l-demo-side">
            <div className={`l-phase ${phase}`}>
              <span className="l-phase-dot" />
              {phase === "normal" ? "Normal day" : phase === "alarm" ? "Fire alarm activated" : phase === "sweep" ? "AI agents testing every escape route" : "Verdict"}
            </div>
            <p className="l-explain">
              {phase === "normal"
                ? `${preset.title}: ${new Set(b.nodes.map((n) => n.floor)).size} floors, one lift, two stairs. On a normal day everyone can get out. Press the button to sound the fire alarm.`
                : phase === "alarm"
                  ? `Lifts are recalled. ${alarmResult.unreachableOccupantIds.length ? `${people(alarmResult.unreachableOccupantIds).replace(/^./, (x) => x.toUpperCase())} can't use stairs, so they're trapped before fire blocks anything.` : "Everyone can still use the stairs."}`
                  : phase === "sweep"
                    ? "Now fire blocks one path at a time. Is there another way out?"
                    : `${sample.badTotal} of the ${sample.total} blocked-path scenarios trap someone else as well. Nobody had to guess which ones: the agents tested them all.`}
            </p>
            <ul className="l-ticker">
              {ticker.map((t, k) => (
                <li key={`${t.scenario.id}-${k}`} className={t.extra.length ? "bad" : "ok"}>
                  <span>Fire blocks {describeBlocked(b, t.scenario.blockedConnectionIds.filter((id) => !lifts.includes(id)))}</span>
                  <b>{t.extra.length ? `✕ ${people(t.extra)} trapped` : "✓ another way out"}</b>
                </li>
              ))}
            </ul>
            {phase === "sweep" && (
              <div className="l-progress">
                <i style={{ width: `${(100 * (step - 1)) / sample.items.length}%` }} />
              </div>
            )}
            {phase === "normal" && !playing ? (
              <button className="l-fire-btn" onClick={start}>
                🔔 Activate fire alarm
              </button>
            ) : phase === "verdict" ? (
              <div className="l-after">
                <a className="l-btn l-btn-primary l-block" href={`/lab?b=${bid}`}>
                  Watch the agents fix it →
                </a>
                <button className="l-link" onClick={start}>
                  Replay
                </button>
              </div>
            ) : null}
            <p className="l-muted small">Fictional building · nobody chooses the blocked paths, the agents test them all</p>
          </aside>
        </div>
      </header>

      <section className="l-how" id="how">
        <div className="l-section-head">
          <p className="kicker">Method</p>
          <h2>Three agents. One judge that can say no.</h2>
        </div>
        <div className="l-cards">
          <article>
            <i className="dot red" />
            <h3>Attacker · Gemini 4 Argon</h3>
            <p>Argon reads the whole building graph and every previous result, then picks the door, stair or lift whose failure is most likely to trap someone. Fire-alarm lift recall is modelled.</p>
          </article>
          <article>
            <i className="dot blue" />
            <h3>Defender · Argon + Flash</h3>
            <p>Argon designs headline fixes, from a new corridor to an evacuation lift serving every floor. Gemini 3.8 Flash subagents mop up the many small follow-ups fast. Rejected? It reads the judge’s reasons and tries again.</p>
          </article>
          <article>
            <i className="dot green" />
            <h3>Judge · deterministic engine</h3>
            <p>Graph maths, not opinion. It re-solves the failure and every past failure, then sweeps every combination exhaustively. Nothing is accepted until it is proven, and big spends wait for your approval.</p>
          </article>
          <article>
            <i className="dot amber" />
            <h3>Cost model · Search grounding</h3>
            <p>Every proposal is re-priced from current UK rates fetched live by Gemini with Google Search, with sources, instead of trusting the AI’s own number.</p>
          </article>
        </div>
        <div className="l-steps">
          <span>Attack</span>→<span>Simulate</span>→<span>Find failure</span>→<span>Propose fix</span>→<span>Judge</span>→<span>Retest every past failure</span>→<span>Download plan</span>
        </div>
      </section>

      <section className="l-upload" id="upload">
        <div className="l-section-head">
          <p className="kicker">Your building</p>
          <h2>Try it with your own floor plan.</h2>
          <p className="l-sub small">Upload a plan image or PDF and Gemini traces rooms, doors, stairs and lifts into a graph. Or upload JSON for full control. Files stay in your browser session.</p>
        </div>
        <UploadPanel />
      </section>

      <section className="l-trust" id="trust">
        <div className="l-section-head">
          <p className="kicker">Built to be trusted</p>
          <h2>The AI proposes. The maths decides.</h2>
        </div>
        <ul>
          <li>
            <b>Independent</b>
            <span>Gemini never marks its own work. Every verdict comes from a deterministic engine with 30+ automated tests.</span>
          </li>
          <li>
            <b>Repeatable</b>
            <span>Same input, same answer. Every failure becomes a regression test that later designs must keep passing.</span>
          </li>
          <li>
            <b>Costed with sources</b>
            <span>Live construction rates with citations, or clearly labelled built-in rates when offline.</span>
          </li>
          <li>
            <b>Clear about its limits</b>
            <span>A connectivity study, not fire engineering: no smoke, fire spread, crowd or evacuation-time modelling.</span>
          </li>
        </ul>
      </section>

      <section className="l-final">
        <h2>From floor plan to fault-free in under three minutes.</h2>
        <div className="l-ctas">
          <a className="l-btn l-btn-primary" href={`/lab?b=${bid}`}>
            Run the live demo
          </a>
          <a className="l-btn" href="#upload">
            Upload your floor plan
          </a>
        </div>
      </section>

      <footer className="l-footer">
        <div>
          <a className="l-logo" href="/">
            <span className="mark" />
            ExitZero
          </a>
          <p>Adversarial building resilience lab · built with Gemini 4 Argon at Google DeepMind’s Halloween at Imperial · demo version</p>
        </div>
        <p className="l-muted small">
          Decision support for early design conversations. Not a fire risk assessment, building-regulations check or certified evacuation model. Buildings shown are fictional.
        </p>
      </footer>
    </div>
  );
}
