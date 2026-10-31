"use client";

import type { StressStats } from "./useStressTest";
import type { DemoController, Source } from "./useDemoController";
import { describeRepair } from "./useDemoController";

export function SourceBadge({ source }: { source?: Source }) {
  if (!source) return null;
  const label = { gemini: "Gemini", fallback: "deterministic", judge: "manual", scripted: "scripted" }[source];
  return <span className={`badge badge-${source}`}>{label}</span>;
}

export function ResultsPanel({ c, stress, onDownload }: { c: DemoController; stress: StressStats; onDownload: (kind: "svg" | "png" | "json") => void }) {
  const r = c.result;
  const ok = r.unreachableOccupantIds.length === 0;
  const pct = Math.round((c.spent / c.budget) * 100);
  const verified = c.passports.filter((p) => p.audit?.accepted);
  const heat = Object.entries(stress.heat).sort((a, b) => b[1] - a[1]);

  return (
    <aside className="panel panel-right">
      <section className={`hero ${ok ? "is-good" : "is-bad"}`}>
        <div className="hero-num">
          {r.reachableCount}
          <span>/{r.totalCount}</span>
        </div>
        <div>
          <div className="hero-title">{ok ? "All occupants have a route" : `${r.unreachableOccupantIds.join(", ")} has no route`}</div>
          <div className="hero-sub">{c.scenario.blockedConnectionIds.length ? `Blocked: ${c.scenario.blockedConnectionIds.join(", ")}` : "No disruptions"} · engine-verified</div>
        </div>
      </section>

      <section className={`card ${c.phase === "attacking" ? "is-live" : ""}`}>
        <header>
          <span className="role r-att">Attacker</span>
          <SourceBadge source={c.attackInfo?.source} />
        </header>
        {c.phase === "attacking" ? (
          <p className="thinking">Probing the graph for single points of failure</p>
        ) : c.attackInfo ? (
          <>
            <p className="big">{c.scenario.name}</p>
            {c.attackInfo.reasoning && <p className="quote">{c.attackInfo.reasoning}</p>}
          </>
        ) : (
          <p className="muted">Waiting to attack.</p>
        )}
      </section>

      <section className={`card ${c.phase === "defending" ? "is-live" : ""} ${c.proposal ? "has-proposal" : ""}`}>
        <header>
          <span className="role r-def">Proposed change</span>
          <SourceBadge source={c.proposal?.source} />
          {c.proposal && <span className="attempt">attempt {c.proposal.attempt}</span>}
        </header>
        {c.phase === "defending" ? (
          <p className="thinking">{c.feedback.length ? "Revising with the judge's reasons" : "Designing a repair within budget"}</p>
        ) : c.proposal ? (
          <>
            <div className="proposal-row">
              <p className="big">{describeRepair(c.proposal.repair)}</p>
              <p className="price">£{c.proposal.repair.cost.toLocaleString("en-GB")}</p>
            </div>
            {c.proposal.reasoning && <p className="quote">{c.proposal.reasoning}</p>}
          </>
        ) : (
          <p className="muted">No change proposed yet.</p>
        )}
      </section>

      <section className={`card ${c.phase === "auditing" ? "is-live" : ""} ${c.audit ? (c.audit.accepted ? "is-pass" : "is-fail") : ""}`}>
        <header>
          <span className="role r-jud">Judge</span>
          <span className="badge badge-engine">deterministic</span>
        </header>
        {c.phase === "auditing" ? (
          <p className="thinking">Re-solving target + {c.regressions.length} regression scenario(s)</p>
        ) : c.audit ? (
          <>
            <p className={`verdict ${c.audit.accepted ? "pass" : "fail"}`}>{c.audit.accepted ? "Accepted" : "Rejected"}</p>
            <ul className="reasons">
              {c.audit.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {c.audit.regressions.length > 0 && (
              <table className="regs">
                <thead>
                  <tr>
                    <th>Regression</th>
                    <th>Before</th>
                    <th>After</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.audit.regressions.map((g) => (
                    <tr key={g.scenarioId}>
                      <td>{g.scenarioId}</td>
                      <td>{g.beforeUnreachable}</td>
                      <td>{g.afterUnreachable}</td>
                      <td className={g.passed ? "pass" : "fail"}>{g.passed ? "pass" : "fail"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="muted">The judge never trusts the AI: every proposal is re-solved.</p>
        )}
      </section>

      <section className="card">
        <header>
          <span className="role">Budget</span>
          <span className="muted small">fictional</span>
        </header>
        <div className="meter">
          <div style={{ width: `${pct}%` }} />
        </div>
        <p className="small">
          £{c.spent.toLocaleString("en-GB")} committed · £{c.budgetLeft.toLocaleString("en-GB")} of £{c.budget.toLocaleString("en-GB")} left
        </p>
      </section>

      <section className="card">
        <header>
          <span className="role">Link criticality</span>
          <span className="muted small">from stress test</span>
        </header>
        <ul className="heat">
          {heat.map(([id, v]) => (
            <li key={id}>
              <span className="mono">{id}</span>
              <span className="bar">
                <i style={{ width: `${Math.round(v * 100)}%` }} className={v > 0.6 ? "hi" : v > 0.25 ? "mid" : "lo"} />
              </span>
              <b>{Math.round(v * 100)}%</b>
            </li>
          ))}
        </ul>
        <p className="small muted">Share of sampled failures involving the link that strand someone.</p>
      </section>

      <section className="card card-download">
        <header>
          <span className="role">Verified plan</span>
          <span className="muted small">{verified.length} change(s)</span>
        </header>
        <p className="small">Architect-style floor plans of both levels with verified changes, escape routes and the cost schedule.</p>
        <div className="dl">
          <button className="btn btn-sm btn-dark" onClick={() => onDownload("png")}>
            Download PNG
          </button>
          <button className="btn btn-sm" onClick={() => onDownload("svg")}>
            SVG
          </button>
          <button className="btn btn-sm" onClick={() => onDownload("json")}>
            Report JSON
          </button>
        </div>
      </section>
    </aside>
  );
}
