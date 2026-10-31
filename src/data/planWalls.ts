import type { FloorPlan } from "./demoPlan";

export type Wall = { axis: "x" | "z"; at: number; from: number; to: number; exterior: boolean };

/** Every space edge becomes wall, minus openings; edges on the footprint are exterior. */
export function buildWalls(floor: FloorPlan, active: Set<string>): Wall[] {
  const lines = new Map<string, { axis: "x" | "z"; at: number; spans: [number, number][] }>();
  const add = (axis: "x" | "z", at: number, a: number, b: number) => {
    const key = `${axis}:${at.toFixed(3)}`;
    const e = lines.get(key) ?? { axis, at, spans: [] };
    e.spans.push([Math.min(a, b), Math.max(a, b)]);
    lines.set(key, e);
  };
  for (const s of floor.spaces) {
    if (s.kind === "void") continue;
    const [x0, z0, x1, z1] = s.rect;
    add("x", z0, x0, x1);
    add("x", z1, x0, x1);
    add("z", x0, z0, z1);
    add("z", x1, z0, z1);
  }
  const [fx0, fz0, fx1, fz1] = floor.footprint;
  const openings = floor.openings.filter((o) => !o.connectionId || active.has(o.connectionId));
  const walls: Wall[] = [];
  for (const { axis, at, spans } of lines.values()) {
    const merged = union(spans);
    const cuts = openings.filter((o) => o.axis === axis && Math.abs(o.at - at) < 1e-3).map((o) => [o.from, o.to] as [number, number]);
    const exterior = axis === "x" ? Math.abs(at - fz0) < 1e-3 || Math.abs(at - fz1) < 1e-3 : Math.abs(at - fx0) < 1e-3 || Math.abs(at - fx1) < 1e-3;
    for (const [a, b] of subtract(merged, cuts)) if (b - a > 0.05) walls.push({ axis, at, from: a, to: b, exterior });
  }
  return walls;
}

function union(spans: [number, number][]): [number, number][] {
  const s = [...spans].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(spans: [number, number][], cuts: [number, number][]): [number, number][] {
  let cur = spans;
  for (const [ca, cb] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of cur) {
      if (cb <= a || ca >= b) next.push([a, b]);
      else {
        if (ca > a) next.push([a, ca]);
        if (cb < b) next.push([cb, b]);
      }
    }
    cur = next;
  }
  return cur;
}

