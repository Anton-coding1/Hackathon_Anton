"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { PRESETS } from "@/data/buildings";
import { simulate } from "@/engine";
import { UploadPanel } from "./UploadPanel";
import "./landing.css";

const BuildingScene = dynamic(() => import("@/scene/BuildingScene").then((m) => m.BuildingScene), {
  ssr: false,
  loading: () => <div className="l-scene-loading">Loading model…</div>,
});

export function Landing() {
  const [bid, setBid] = useState<"clinic" | "industrial">("industrial");
  const preset = PRESETS[bid];
  const [sid, setSid] = useState("base");
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

      <header className="l-hero">
        <p className="kicker">Adversarial building resilience</p>
        <h1>
          Find the door that strands someone.
          <br />
          <span>Before it happens.</span>
        </h1>
        <p className="l-sub">
          AI agents attack your floor plan, propose costed fixes, and an independent judge proves which ones actually work, down to the lift that gets recalled when the fire alarm sounds.
        </p>
        <div className="l-ctas">
          <a className="l-btn l-btn-primary" href={`/lab?b=${bid}&autoplay=1`}>
            Run the live demo
          </a>
          <a className="l-btn" href="#upload">
            Upload your floor plan
          </a>
        </div>
      </header>

      <section className="l-demo" id="demo">
        <div className="l-section-head">
          <p className="kicker">Interactive demo</p>
          <h2>Watch a decision being made.</h2>
        </div>
        <div className="l-demo-card">
          <div className="l-demo-scene">
            <BuildingScene building={preset.building} scenario={sc.scenario} result={result} plan={preset.plan} showLabels={false} exploded />
            <div className="l-scene-tag">Live engine · every route solved in your browser</div>
          </div>
          <aside className="l-demo-side">
            <div className="l-toggle-group">
              <span>Building</span>
              <div className="l-toggles">
                {(["industrial", "clinic"] as const).map((k) => (
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
                {preset.scenarios.map((s) => (
                  <button key={s.id} className={sid === s.id ? "on" : ""} onClick={() => setSid(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`l-verdict ${atRisk ? "risk" : "ok"}`}>
              <b>{atRisk ? "AT RISK" : "ALL CLEAR"}</b>
              <span>
                {result.reachableCount}/{result.totalCount} occupants can reach an eligible exit
              </span>
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
              Let the agents fix it →
            </a>
            <p className="l-muted small">Fictional buildings · illustrative scenarios</p>
          </aside>
        </div>
      </section>

      <section className="l-how" id="how">
        <div className="l-section-head">
          <p className="kicker">Method</p>
          <h2>Three agents. One judge that can say no.</h2>
        </div>
        <div className="l-cards">
          <article>
            <i className="dot red" />
            <h3>Attacker</h3>
            <p>Gemini studies the graph and previous results, then blocks the door, stair or lift most likely to strand someone. Lift recall in a fire alarm is modelled.</p>
          </article>
          <article>
            <i className="dot blue" />
            <h3>Defender</h3>
            <p>Gemini proposes one change within your budget and design constraints: a corridor, a stair, an evacuation lift or secondary power.</p>
          </article>
          <article>
            <i className="dot green" />
            <h3>Judge</h3>
            <p>A deterministic graph engine re-solves the failure and every stored regression. If the fix doesn’t work, it’s rejected with reasons and the defender tries again.</p>
          </article>
          <article>
            <i className="dot amber" />
            <h3>Cost model</h3>
            <p>Every proposal is re-priced from current UK rates pulled live with Gemini + Google Search, with sources, instead of trusting the AI’s own number.</p>
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
            <span>Gemini never marks its own work. Every verdict comes from a deterministic engine with 24 automated tests.</span>
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
        <h2>Stress-test a building in under a minute.</h2>
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
          <p>Adversarial building resilience lab · Gemini Halloween Hackathon · demo version</p>
        </div>
        <p className="l-muted small">
          Decision support for early design conversations. Not a fire risk assessment, building-regulations check or certified evacuation model. Buildings shown are fictional.
        </p>
      </footer>
    </div>
  );
}
