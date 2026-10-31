import * as THREE from "three";
import type { Building, Connection, RoomNode, Scenario, TestResult } from "@/contracts/types";
import type { BuildingPlan } from "@/data/demoPlan";

export const COLORS = {
  background: "#e6eaf0",
  ground: "#f3f5f8",
  slab: "#fbfbfc",
  wall: "#ffffff",
  wallExt: "#f4f4f2",
  glass: "#9fc2dc",
  lane: "#98a2b3",
  route: "#12a150",
  routeSF: "#0891b2",
  blocked: "#dc2626",
  added: "#2563eb",
  selected: "#f59e0b",
  exit: "#16a34a",
  tread: "#e3e6ea",
  nosing: "#9aa3ae",
  text: "#1d2939",
} as const;

export const FLOOR_FINISH: Record<string, string> = {
  room: "#f4f1ec",
  circulation: "#e8ebef",
  lobby: "#eef1f5",
  stair: "#e2e5ea",
  ancillary: "#efefef",
  void: "#000000",
  core: "#dbeafe",
};

export type Activity = "idle" | "attacking" | "defending" | "auditing";
export type ConnectionState = "normal" | "blocked" | "route" | "selected" | "added";

/** Real storey height in the data is 4.5 m; the exploded view lifts upper floors further apart. */
export const STOREY = 4.5;

export function levelY(floor: number, exploded: boolean): number {
  return floor * (exploded ? 9 : STOREY);
}

export function nodeMap(b: Building): Map<string, RoomNode> {
  return new Map(b.nodes.map((n) => [n.id, n]));
}

export function nodePos(n: RoomNode, exploded: boolean): THREE.Vector3 {
  return new THREE.Vector3(n.position[0], levelY(n.floor, exploded), n.position[2]);
}

/**
 * Drawn path of a connection, from `from` to `to`.
 * Same-floor links are straight. Links between floors become: short flat run on the
 * upper floor, a straight flight along the dominant axis, and a landing to the lower node.
 */
export type Anchor = { foot: [number, number]; head: [number, number] };

export function connectionPolyline(c: Connection, nodes: Map<string, RoomNode>, exploded: boolean, anchors?: Record<string, Anchor>): THREE.Vector3[] {
  const a = nodes.get(c.from);
  const b = nodes.get(c.to);
  if (!a || !b) return [];
  const pa = nodePos(a, exploded);
  const pb = nodePos(b, exploded);
  if (a.floor === b.floor) return [pa, pb];
  const upperIsA = a.floor > b.floor;
  const U = upperIsA ? pa : pb;
  const L = upperIsA ? pb : pa;
  const an = anchors?.[c.id];
  if (an) {
    // Drawn through the shaft or stair enclosure the plan carved for it.
    const pts = dedupe([L, new THREE.Vector3(an.foot[0], L.y, an.foot[1]), new THREE.Vector3(an.head[0], U.y, an.head[1]), U]);
    return upperIsA ? pts.reverse() : pts;
  }
  if (c.kind === "lift" || c.kind === "ramp") {
    // Lift: walk to the shaft (under the upper node), then straight up.
    const foot = new THREE.Vector3(U.x, L.y, U.z);
    const pts = dedupe([L, foot, U]);
    return upperIsA ? pts.reverse() : pts;
  }
  const alongX = Math.abs(L.x - U.x) >= Math.abs(L.z - U.z);
  const RUN = 6;
  let pts: THREE.Vector3[];
  if (alongX) {
    const dir = Math.sign(L.x - U.x) || 1;
    const foot = new THREE.Vector3(L.x, L.y, U.z);
    const headX = Math.abs(L.x - U.x) > RUN ? L.x - dir * RUN : U.x;
    const head = new THREE.Vector3(headX, U.y, U.z);
    pts = [U, head, foot, L];
  } else {
    const dir = Math.sign(L.z - U.z) || 1;
    const foot = new THREE.Vector3(U.x, L.y, L.z);
    const headZ = Math.abs(L.z - U.z) > RUN ? L.z - dir * RUN : U.z;
    const head = new THREE.Vector3(U.x, U.y, headZ);
    pts = [U, head, foot, L];
  }
  pts = dedupe(pts);
  return upperIsA ? pts : pts.reverse();
}

function dedupe(pts: THREE.Vector3[]): THREE.Vector3[] {
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-3);
}

/** The connection a route uses between two consecutive nodes (shortest unblocked). */
export function connectionBetween(b: Building, x: string, y: string, blocked: Set<string>): Connection | undefined {
  return b.connections
    .filter((c) => !blocked.has(c.id) && ((c.from === x && c.to === y) || (c.from === y && c.to === x)))
    .sort((p, q) => p.length - q.length || (p.id < q.id ? -1 : 1))[0];
}

/** Connections used by any route in the result (paths are node IDs). */
export function routeConnectionIds(b: Building, result?: TestResult, scenario?: Scenario): Set<string> {
  const used = new Set<string>();
  if (!result) return used;
  const blocked = new Set(scenario?.blockedConnectionIds ?? []);
  for (const path of Object.values(result.paths)) {
    for (let i = 0; i < path.length - 1; i++) {
      const c = connectionBetween(b, path[i], path[i + 1], blocked);
      if (c) used.add(c.id);
    }
  }
  return used;
}

/** Full drawn polyline for an occupant's route, extended out of the exit door to the assembly point. */
export function routePolyline(
  b: Building,
  path: string[],
  blocked: Set<string>,
  exploded: boolean,
  plan?: BuildingPlan,
  anchors?: Record<string, Anchor>,
): THREE.Vector3[] {
  const nodes = nodeMap(b);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const c = connectionBetween(b, path[i], path[i + 1], blocked);
    let seg = c ? connectionPolyline(c, nodes, exploded, anchors) : [];
    if (seg.length === 0) {
      const p = nodes.get(path[i]);
      const q = nodes.get(path[i + 1]);
      if (p && q) seg = [nodePos(p, exploded), nodePos(q, exploded)];
    } else if (c && c.from !== path[i]) {
      seg = [...seg].reverse();
    }
    for (const p of seg) if (out.length === 0 || out[out.length - 1].distanceTo(p) > 1e-3) out.push(p.clone());
  }
  const last = path[path.length - 1];
  const door = plan?.exitDoors[last];
  if (door && out.length) {
    const y = out[out.length - 1].y;
    const d = new THREE.Vector3(door[0], y, door[1]);
    const outward = d.clone().sub(out[out.length - 1]).setY(0).normalize();
    out.push(d, d.clone().addScaledVector(outward, 4));
  }
  return out;
}

export function connectionState(
  c: Connection,
  blocked: Set<string>,
  routed: Set<string>,
  added: Set<string>,
  selected?: string,
  hovered?: string | null,
): ConnectionState {
  if (blocked.has(c.id)) return "blocked";
  if (c.id === selected || c.id === hovered) return "selected";
  if (routed.has(c.id)) return "route";
  if (added.has(c.id)) return "added";
  return "normal";
}

export function stateColor(s: ConnectionState): string {
  return { normal: COLORS.lane, blocked: COLORS.blocked, route: COLORS.route, selected: COLORS.selected, added: COLORS.added }[s];
}

/** Polyline helper with constant-time-ish sampling by arc length. */
export class Polyline {
  readonly pts: THREE.Vector3[];
  readonly cum: number[];
  readonly length: number;
  constructor(pts: THREE.Vector3[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum[this.cum.length - 1] ?? 0;
  }
  /** Writes the point at fraction u into `out`, and the horizontal unit normal into `normal`. */
  sample(u: number, out: THREE.Vector3, normal: THREE.Vector3): void {
    const d = Math.min(Math.max(u, 0), 1) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (d - this.cum[i - 1]) / seg;
    out.copy(a).lerp(b, f);
    normal.set(-(b.z - a.z), 0, b.x - a.x);
    if (normal.lengthSq() < 1e-9) normal.set(0, 0, 1);
    normal.normalize();
  }
  midpoint(): THREE.Vector3 {
    const p = new THREE.Vector3();
    this.sample(0.5, p, new THREE.Vector3());
    return p;
  }
}

export function buildingCentre(b: Building, plan?: BuildingPlan): THREE.Vector3 {
  if (plan?.floors.length) {
    const f = plan.floors[0].footprint;
    return new THREE.Vector3((f[0] + f[2]) / 2, 0, (f[1] + f[3]) / 2);
  }
  if (b.nodes.length === 0) return new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const n of b.nodes) c.add(new THREE.Vector3(n.position[0], 0, n.position[2]));
  return c.divideScalar(b.nodes.length);
}
