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

      <section className={`card cert ${c.certificate.faultFree ? "is-pass" : ""}`}>
        <header>
          <span className="role">Fault-free check</span>
          <span className="muted small">any {c.certificate.tolerance} failure{c.certificate.tolerance > 1 ? "s" : ""}</span>
        </header>
        {c.certificate.faultFree ? (
          <p className="verdict pass">Certified fault-free</p>
        ) : (
          <p className="verdict fail">{c.certificate.failures.length} weak combination{c.certificate.failures.length === 1 ? "" : "s"}</p>
        )}
        <p className="small muted">
          {c.certificate.scenariosChecked} combinations checked exhaustively by the engine
          {!c.certificate.faultFree && c.certificate.failures[0] ? ` · worst: ${c.certificate.failures[0].scenario.blockedConnectionIds.join(" + ")} strands ${c.certificate.failures[0].result.unreachableOccupantIds.join(", ")}` : ""}
        </p>
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
            <table className="costs">
              <tbody>
                {c.proposal.estimate.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.label}</td>
                    <td>
                      {l.qty} {l.unit}
                    </td>
                    <td>£{Math.round(l.total).toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              Modelled cost{c.rates.source === "gemini-search" ? " from live rates" : " from built-in rates"}
              {c.proposal.aiCost && c.proposal.aiCost !== c.proposal.repair.cost ? ` · AI estimated £${c.proposal.aiCost.toLocaleString("en-GB")}` : ""}
            </p>
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

      <section className="card">
        <header>
          <span className="role">Cost model</span>
          <span className={`badge ${c.rates.source === "gemini-search" ? "badge-gemini" : "badge-fallback"}`}>{c.rates.source === "gemini-search" ? "live · Gemini + Search" : "built-in"}</span>
        </header>
        <ul className="rates">
          <li><span>Corridor</span><b>£{c.rates.rates.corridorPerMetre.toLocaleString("en-GB")}/m</b></li>
          <li><span>Fire door + opening</span><b>£{c.rates.rates.doorOpening.toLocaleString("en-GB")}</b></li>
          <li><span>Staircase</span><b>£{c.rates.rates.stairsPerFlight.toLocaleString("en-GB")}</b></li>
          <li><span>Evacuation lift</span><b>£{c.rates.rates.evacuationLift.toLocaleString("en-GB")}</b></li>
          <li><span>Lift secondary power</span><b>£{c.rates.rates.liftSecondaryPower.toLocaleString("en-GB")}</b></li>
        </ul>
        {c.rates.sources.length > 0 && (
          <details className="sources">
            <summary>{c.rates.sources.length} sources · {c.rates.asOf}</summary>
            {c.rates.sources.map((x, i) => (
              <a key={i} href={x.url} target="_blank" rel="noreferrer">
                {x.title || x.url}
              </a>
            ))}
          </details>
        )}
        <p className="small muted">{c.ratesNote || c.rates.notes}</p>
        <button className="link" disabled={c.ratesLoading} onClick={() => c.loadRates(true)}>
          {c.ratesLoading ? "Fetching live rates…" : "Refresh live rates"}
        </button>
      </section>

      <section className="card">
        <header>
          <span className="role">Run summary</span>
        </header>
        <div className="runs">
          <div><b>{c.runs.attacker}</b><span>attacker runs</span></div>
          <div><b>{c.runs.defender}</b><span>defender proposals</span></div>
          <div><b>{c.runs.judge}</b><span>judge verdicts</span></div>
          <div><b>{c.runs.regressionChecks}</b><span>regression re-checks</span></div>
          <div><b>{c.runs.geminiCalls}</b><span>Gemini calls</span></div>
          <div><b>{stress.evaluated.toLocaleString("en-GB")}</b><span>engine scenarios</span></div>
        </div>
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
