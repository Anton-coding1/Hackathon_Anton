"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { PRESETS } from "@/data/buildings";
import { simulate } from "@/engine";
import { UploadPanel } from "./UploadPanel";
import "./landing.css";

const BuildingScene = dynamic(() => import("@/scene/BuildingScene").then((m) => m.BuildingScene), {
  ssr: false,
  loading: () => <div className="l-scene-loading">Loading model…</div>,
});

export function Landing() {
  const [bid, setBid] = useState<"tower" | "hospital" | "industrial" | "clinic">("tower");
  const preset = PRESETS[bid];
  const [sid, setSid] = useState("base");
  const [auto, setAuto] = useState(true);
  // The hero plays by itself until someone touches it.
  useEffect(() => {
    if (!auto) return;
    const ids = preset.scenarios.map((x) => x.id);
    const t = setInterval(() => setSid((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]), 4200);
    return () => clearInterval(t);
  }, [auto, preset]);
  const sc = preset.scenarios.find((s) => s.id === sid) ?? preset.scenarios[0];
  const result = useMemo(() => simulate(preset.building, sc.scenario), [preset, sc]);
  const atRisk = result.unreachableOccupantIds.length > 0;

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
            <a className="l-btn l-btn-primary" href={`/lab?b=${bid}&autoplay=1`}>
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
            <BuildingScene building={preset.building} scenario={sc.scenario} result={result} plan={preset.plan} labelMode="minimal" exploded={preset.defaultExploded ?? true} />
            <div className={`l-verdict-float ${atRisk ? "risk" : "ok"}`}>
              <b>{atRisk ? "AT RISK" : "ALL CLEAR"}</b>
              <span>
                {result.reachableCount}/{result.totalCount} can reach an eligible exit
              </span>
            </div>
            <div className="l-scene-tag">{auto ? "Live · cycling scenarios" : "Live engine"} · every route solved in your browser</div>
          </div>
          <aside className="l-demo-side">
            <div className="l-toggle-group">
              <span>Building</span>
              <div className="l-toggles">
                {(["tower", "hospital", "industrial", "clinic"] as const).map((k) => (
                  <button
                    key={k}
                    className={bid === k ? "on" : ""}
                    onClick={() => {
                      setBid(k);
                      setSid("base");
                    }}
                  >
                    {PRESETS[k].title}
                  </button>
                ))}
              </div>
              <p className="l-muted">{preset.sector}</p>
            </div>
            <div className="l-toggle-group">
              <span>Scenario</span>
              <div className="l-toggles">
                {preset.scenarios.map((x) => (
                  <button
                    key={x.id}
                    className={sid === x.id ? "on" : ""}
                    onClick={() => {
                      setAuto(false);
                      setSid(x.id);
                    }}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="l-occ">
              {preset.building.occupants.map((o) => {
                const stuck = result.unreachableOccupantIds.includes(o.id);
                return (
                  <li key={o.id}>
                    <span>
                      {o.label}
                      {o.requiresStepFree ? <em>step-free</em> : null}
                    </span>
                    <b className={stuck ? "bad" : "good"}>{stuck ? "No route" : "Route OK"}</b>
                  </li>
                );
              })}
            </ul>
            <p className="l-explain">{result.explanations.find((e) => /cannot|no /.test(e)) ?? "Every occupant has a graph route to an eligible exit."}</p>
            <a className="l-btn l-btn-primary l-block" href={`/lab?b=${bid}&autoplay=1`}>
              Let Argon fix it →
            </a>
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
          <a className="l-btn l-btn-primary" href={`/lab?b=${bid}&autoplay=1`}>
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
