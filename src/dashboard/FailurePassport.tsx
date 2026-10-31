"use client";

import { useState } from "react";
import type { FailurePassport as Passport } from "@/contracts/types";
import type { PassportMeta } from "./useDemoController";
import { describeRepair } from "./useDemoController";
import { SourceBadge } from "./ResultsPanel";

export function passportText(p: Passport, meta?: PassportMeta): string {
  const lines = [
    `EXITZERO FAILURE PASSPORT ${p.id}`,
    `Scenario: ${p.scenario.id} (${p.scenario.name})`,
    `Found by: ${meta?.source ?? "unknown"}`,
    `Blocked connections: ${p.scenario.blockedConnectionIds.join(", ") || "none"}`,
    `Unreachable occupants: ${p.result.unreachableOccupantIds.join(", ") || "none"} (${p.result.reachableCount}/${p.result.totalCount} reachable)`,
    ...p.result.explanations.map((e) => `  - ${e}`),
  ];
  if (p.repair) lines.push(`Proposed repair: ${describeRepair(p.repair)}, cost £${p.repair.cost.toLocaleString("en-GB")}`);
  if (p.audit) {
    lines.push(`Auditor decision: ${p.audit.accepted ? "ACCEPTED" : "REJECTED"}`);
    lines.push(...p.audit.reasons.map((r) => `  - ${r}`));
    lines.push(`After repair: ${p.audit.after.unreachableOccupantIds.join(", ") || "nobody"} stranded`);
    for (const g of p.audit.regressions) lines.push(`  regression ${g.scenarioId}: ${g.beforeUnreachable} → ${g.afterUnreachable} stranded (${g.passed ? "pass" : "fail"})`);
  }
  lines.push("Connectivity model only; not a fire-safety certification.");
  return lines.join("\n");
}

export function FailurePassport({ passport, meta }: { passport: Passport; meta?: PassportMeta }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (kind: "text" | "json") => {
    const payload = kind === "json" ? JSON.stringify({ ...passport, meta }, null, 2) : passportText(passport, meta);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied("blocked");
    }
  };
  const status = passport.audit ? (passport.audit.accepted ? "fixed" : "rejected") : "open";

  return (
    <article className={`passport is-${status}`}>
      <header>
        <span className="pid">{passport.id}</span>
        <span className={`pstatus ${status}`}>{status === "fixed" ? "Repaired & verified" : status === "rejected" ? "Repair rejected" : "Open failure"}</span>
        <SourceBadge source={meta?.source} />
      </header>
      <dl>
        <dt>Scenario</dt>
        <dd>{passport.scenario.id}</dd>
        <dt>Blocked</dt>
        <dd className="mono">{passport.scenario.blockedConnectionIds.join(", ")}</dd>
        <dt>Stranded</dt>
        <dd className="bad mono">{passport.result.unreachableOccupantIds.join(", ")}</dd>
        {passport.repair && (
          <>
            <dt>Repair</dt>
            <dd>
              {describeRepair(passport.repair)} · £{passport.repair.cost.toLocaleString("en-GB")}
            </dd>
          </>
        )}
        {passport.audit && (
          <>
            <dt>After</dt>
            <dd className={passport.audit.after.unreachableOccupantIds.length ? "bad" : "good"}>
              {passport.audit.after.reachableCount}/{passport.audit.after.totalCount} reachable
            </dd>
            <dt>Regressions</dt>
            <dd>
              {passport.audit.regressions.length
                ? `${passport.audit.regressions.filter((g) => g.passed).length}/${passport.audit.regressions.length} pass`
                : "none run"}
            </dd>
          </>
        )}
      </dl>
      {passport.audit && <p className="preason">{passport.audit.reasons[0]}</p>}
      <footer>
        <button onClick={() => copy("text")}>{copied === "text" ? "Copied ✓" : "Copy report"}</button>
        <button onClick={() => copy("json")}>{copied === "json" ? "Copied ✓" : "Copy JSON"}</button>
        {copied === "blocked" && <span className="small muted">Clipboard blocked by browser</span>}
      </footer>
    </article>
  );
}
