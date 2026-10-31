"use client";

import { useEffect, useRef, useState } from "react";
import type { Building } from "@/contracts/types";
import { simulate } from "@/engine";

export type StressStats = {
  evaluated: number;
  perSecond: number;
  failing: number;
  /** Distinct sets of blocked connections that strand someone. */
  failureModes: number;
  /** Per connection: share of sampled scenarios containing it that strand someone. */
  heat: Record<string, number>;
  worst: { blocked: string[]; stranded: string[] } | null;
};

const EMPTY: StressStats = { evaluated: 0, perSecond: 0, failing: 0, failureModes: 0, heat: {}, worst: null };

/**
 * Continuous Monte Carlo stress test: samples random 1–3 connection failures and
 * runs each through the real engine, thousands per second. Restarts when the
 * building changes (e.g. after a verified repair).
 */
export function useStressTest(building: Building, running: boolean, liftsRecalled = false): StressStats {
  const [stats, setStats] = useState<StressStats>(EMPTY);
  const acc = useRef({ evaluated: 0, failing: 0, modes: new Set<string>(), seen: {} as Record<string, number>, bad: {} as Record<string, number>, worst: null as StressStats["worst"], window: [] as [number, number][] });

  useEffect(() => {
    acc.current = { evaluated: 0, failing: 0, modes: new Set(), seen: {}, bad: {}, worst: null, window: [] };
    setStats(EMPTY);
    if (!running) return;
    const recalled = liftsRecalled ? building.connections.filter((c) => c.kind === "lift" && !c.evacuationLift).map((c) => c.id) : [];
    const ids = building.connections.map((c) => c.id).filter((id) => !recalled.includes(id));
    if (ids.length === 0) return;
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const tick = () => {
      const a = acc.current;
      const t0 = performance.now();
      let n = 0;
      // Spend up to ~12 ms per tick so the UI stays smooth.
      while (performance.now() - t0 < 12) {
        const k = 1 + Math.floor(rnd() * Math.min(3, ids.length));
        const pick = new Set<string>();
        while (pick.size < k) pick.add(ids[Math.floor(rnd() * ids.length)]);
        const blocked = [...pick].sort();
        const r = simulate(building, { id: "STRESS", name: "stress", blockedConnectionIds: [...blocked, ...recalled] });
        const fail = r.unreachableOccupantIds.length > 0;
        for (const id of blocked) {
          a.seen[id] = (a.seen[id] ?? 0) + 1;
          if (fail) a.bad[id] = (a.bad[id] ?? 0) + 1;
        }
        if (fail) {
          a.failing++;
          a.modes.add(blocked.join("+"));
          if (!a.worst || r.unreachableOccupantIds.length > a.worst.stranded.length || (r.unreachableOccupantIds.length === a.worst.stranded.length && blocked.length < a.worst.blocked.length)) {
            a.worst = { blocked, stranded: r.unreachableOccupantIds };
          }
        }
        n++;
      }
      a.evaluated += n;
      const now = performance.now();
      a.window.push([now, n]);
      while (a.window.length && now - a.window[0][0] > 1000) a.window.shift();
      const span = a.window.length > 1 ? (now - a.window[0][0]) / 1000 : 1;
      const perSecond = Math.round(a.window.reduce((s, [, c]) => s + c, 0) / Math.max(span, 0.25));
      const heat: Record<string, number> = {};
      for (const id of ids) heat[id] = a.seen[id] ? (a.bad[id] ?? 0) / a.seen[id] : 0;
      setStats({ evaluated: a.evaluated, perSecond, failing: a.failing, failureModes: a.modes.size, heat, worst: a.worst });
    };
    const h = setInterval(tick, 100);
    return () => clearInterval(h);
  }, [building, running, liftsRecalled]);

  return stats;
}
