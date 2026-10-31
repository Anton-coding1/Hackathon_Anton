import type { Building, Connection, Repair, RoomNode } from "@/contracts/types";
import type { BuildingPlan, FloorPlan, Opening, Rect, Space } from "./demoPlan";

/**
 * Turns verified repairs into real floor-plan changes, so a proposal never
 * "passes through" a room on paper:
 *  - a new door is cut into the wall it crosses,
 *  - a room a new corridor passes through is converted (and relabelled),
 *  - a new lift or stair gets its own shaft, carved out of a named neighbouring room,
 *  - an upgraded lift keeps its shaft and is relabelled.
 * Purely visual: the engine's verdict never depends on this.
 */
export type PlanChange = {
  n: number;
  title: string;
  detail: string;
  cost: number;
  floors: number[];
  markers: { floor: number; x: number; z: number }[];
};

/** Where to draw a lift/stair connection: foot on the lower floor, head on the upper. */
export type Anchor = { foot: [number, number]; head: [number, number] };

export type PlannedBuilding = { plan: BuildingPlan; changes: PlanChange[]; anchors: Record<string, Anchor> };

const EPS = 1e-6;
const SHAFT = 2.4;
const area = ([x0, z0, x1, z1]: Rect) => Math.abs(x1 - x0) * Math.abs(z1 - z0);
const inside = ([x0, z0, x1, z1]: Rect, x: number, z: number, e = 1e-3) => x >= x0 - e && x <= x1 + e && z >= z0 - e && z <= z1 + e;

function clonePlan(p: BuildingPlan): BuildingPlan {
  return {
    ...p,
    exitDoors: { ...p.exitDoors },
    floors: p.floors.map((f) => ({
      ...f,
      spaces: f.spaces.map((s) => ({ ...s, rect: [...s.rect] as Rect })),
      openings: f.openings.map((o) => ({ ...o })),
      voids: f.voids.map((v) => [...v] as Rect),
      fixtures: f.fixtures?.map((x) => [...x] as [number, number, number, number, number]),
    })),
  };
}

/** Smallest non-void space containing the point. */
function spaceAt(f: FloorPlan, x: number, z: number): Space | undefined {
  return f.spaces.filter((s) => s.kind !== "void" && inside(s.rect, x, z)).sort((a, b) => area(a.rect) - area(b.rect))[0];
}

/** Shared wall between two touching rects: axis, line and overlap range. */
function sharedWall(a: Rect, b: Rect): { axis: "x" | "z"; at: number; from: number; to: number } | null {
  const ov = (p0: number, p1: number, q0: number, q1: number) => [Math.max(p0, q0), Math.min(p1, q1)] as const;
  for (const [ea, eb] of [
    [a[2], b[0]],
    [a[0], b[2]],
  ] as const) {
    if (Math.abs(ea - eb) < 1e-3) {
      const [f, t] = ov(a[1], a[3], b[1], b[3]);
      if (t - f > 0.8) return { axis: "z", at: ea, from: f, to: t };
    }
  }
  for (const [ea, eb] of [
    [a[3], b[1]],
    [a[1], b[3]],
  ] as const) {
    if (Math.abs(ea - eb) < 1e-3) {
      const [f, t] = ov(a[0], a[2], b[0], b[2]);
      if (t - f > 0.8) return { axis: "x", at: ea, from: f, to: t };
    }
  }
  return null;
}

/** Adds a door of width w on a wall, near `along`, avoiding existing openings and staying within [from, to]. */
function addDoor(f: FloorPlan, wall: { axis: "x" | "z"; at: number; from: number; to: number }, along: number, n: number, w = 1): Opening {
  const taken = f.openings.filter((o) => o.axis === wall.axis && Math.abs(o.at - wall.at) < 1e-3);
  const fits = (a: number) => a - w / 2 >= wall.from + 0.25 && a + w / 2 <= wall.to - 0.25 && !taken.some((o) => a + w / 2 > o.from - 0.2 && a - w / 2 < o.to + 0.2);
  let pos = Math.min(Math.max(along, wall.from + 0.25 + w / 2), wall.to - 0.25 - w / 2);
  for (let k = 0; k < 20 && !fits(pos); k++) {
    const step = 0.6 * Math.ceil((k + 1) / 2) * (k % 2 ? -1 : 1);
    const cand = along + step;
    if (fits(cand)) {
      pos = cand;
      break;
    }
  }
  const o: Opening = { axis: wall.axis, at: wall.at, from: pos - w / 2, to: pos + w / 2, kind: "door", changeNo: n };
  f.openings.push(o);
  return o;
}

const doorMid = (o: Opening) => (o.axis === "z" ? { x: o.at, z: (o.from + o.to) / 2 } : { x: (o.from + o.to) / 2, z: o.at });

export function planChanges(plan: BuildingPlan, building: Building, accepted: Repair[]): PlannedBuilding {
  const out = clonePlan(plan);
  const nodes = new Map(building.nodes.map((n) => [n.id, n]));
  const floorOf = (k: number) => out.floors.find((f) => f.floor === k);
  const changes: PlanChange[] = [];
  const anchors: Record<string, Anchor> = {};
  const centre = (f: FloorPlan) => [(f.footprint[0] + f.footprint[2]) / 2, (f.footprint[1] + f.footprint[3]) / 2] as const;

  /** Carves a w×d shaft (lift or stair) on every floor, next to the space holding (ax, az). */
  const carve = (n: number, floors: number[], ax: number, az: number, w: number, d: number, name: string, kind: "core" | "stair") => {
    const fl = floors.map(floorOf).filter(Boolean) as FloorPlan[];
    if (!fl.length) return null;
    const lobby = (f: FloorPlan) => spaceAt(f, ax, az);
    const dirs = ["E", "W", "N", "S"] as const;
    const neighbour = (f: FloorPlan, l: Space, dir: (typeof dirs)[number]) =>
      f.spaces.find((s) => {
        if (s === l || s.kind === "void" || s.kind === "stair" || s.kind === "core") return false;
        if (s.nodeId && building.nodes.find((x) => x.id === s.nodeId)?.kind === "exit") return false;
        const wall = sharedWall(l.rect, s.rect);
        if (!wall) return false;
        const ok = dir === "E" ? wall.axis === "z" && Math.abs(wall.at - l.rect[2]) < 1e-3 : dir === "W" ? wall.axis === "z" && Math.abs(wall.at - l.rect[0]) < 1e-3 : dir === "N" ? wall.axis === "x" && Math.abs(wall.at - l.rect[1]) < 1e-3 : wall.axis === "x" && Math.abs(wall.at - l.rect[3]) < 1e-3;
        const sw = s.rect[2] - s.rect[0];
        const sd = s.rect[3] - s.rect[1];
        return ok && wall.to - wall.from >= Math.min(w, d) + 0.4 && Math.min(sw, sd) >= Math.min(w, d) + 0.6 && Math.max(sw, sd) >= Math.max(w, d) + 0.6;
      });
    let rects: Rect[] | null = null;
    let hosts: Space[] = [];
    let lobbies: Space[] = [];
    for (const dir of dirs) {
      const ls = fl.map(lobby);
      if (ls.some((l) => !l)) break;
      const ns = fl.map((f, i) => neighbour(f, ls[i]!, dir));
      if (ns.some((x) => !x)) continue;
      const r0 = ns[0]!.rect;
      const wall = sharedWall(ls[0]!.rect, r0)!;
      const [cx, cz] = centre(fl[0]);
      // Against the shared wall, at the end of it furthest from the middle of the building.
      const farEnd = wall.axis === "z" ? (Math.abs(wall.from - cz) > Math.abs(wall.to - cz) ? "lo" : "hi") : Math.abs(wall.from - cx) > Math.abs(wall.to - cx) ? "lo" : "hi";
      const a0 = farEnd === "lo" ? wall.from + 0.2 : wall.to - 0.2 - (wall.axis === "z" ? d : w);
      const span = wall.axis === "z" ? d : w;
      const deep = wall.axis === "z" ? w : d;
      let r: Rect;
      if (wall.axis === "z") r = dir === "E" ? [wall.at, a0, wall.at + deep, a0 + span] : [wall.at - deep, a0, wall.at, a0 + span];
      else r = dir === "S" ? [a0, wall.at, a0 + span, wall.at + deep] : [a0, wall.at - deep, a0 + span, wall.at];
      if (ns.every((h) => inside(h!.rect, r[0], r[1]) && inside(h!.rect, r[2], r[3]))) {
        rects = fl.map(() => r);
        hosts = ns as Space[];
        lobbies = ls as Space[];
        break;
      }
    }
    if (!rects) {
      // No suitable neighbour: form it in the corner of the space itself.
      const ls = fl.map(lobby);
      if (ls.some((l) => !l)) return null;
      const [x0, z0, x1, z1] = ls[0]!.rect;
      const r: Rect = [x1 - 0.2 - w, z0 + 0.2, x1 - 0.2, z0 + 0.2 + d];
      rects = fl.map(() => r);
      hosts = ls as Space[];
      lobbies = ls as Space[];
    }
    fl.forEach((f, i) => {
      const r = rects![i];
      const host = hosts[i];
      host.reducedBy = (host.reducedBy ?? 0) + area(r);
      f.spaces.push({ id: `NEW_${n}_${f.floor}`, name, rect: r, kind, changeNo: n, replaces: host === lobbies[i] ? undefined : host.name });
      const wall = sharedWall(r, lobbies[i].rect) ?? sharedWall(r, host.rect);
      if (wall) {
        const mid = (wall.from + wall.to) / 2;
        addDoor(f, wall, mid, n, kind === "core" ? 1.1 : 1.2);
      } else {
        // Shaft inside its host: open the side facing the host's interior.
        const cx = (r[0] + r[2]) / 2;
        f.openings.push({ axis: "x", at: r[3], from: cx - 0.55, to: cx + 0.55, kind: "door", changeNo: n });
      }
      if (host !== lobbies[i]) {
        const hostWall = sharedWall(host.rect, lobbies[i].rect);
        if (hostWall && !f.openings.some((o) => o.axis === hostWall.axis && Math.abs(o.at - hostWall.at) < 1e-3 && o.to > hostWall.from && o.from < hostWall.to)) {
          // nothing: the shaft door already opens into the lobby through the shared wall
        }
      }
    });
    return { rects, hosts: [...new Set(hosts.map((h) => h.name))], same: hosts.every((h, i) => h !== lobbies[i]) };
  };

  accepted.forEach((rep, idx) => {
    const n = idx + 1;
    const markers: PlanChange["markers"] = [];
    const floors = new Set<number>();
    let title = "";
    let detail = "";

    if (rep.kind === "upgrade_lift") {
      const conns = building.connections.filter((c) => rep.connectionIds.includes(c.id));
      const seen = new Set<string>();
      for (const c of conns)
        for (const id of [c.from, c.to]) {
          const nd = nodes.get(id);
          if (!nd || seen.has(id)) continue;
          seen.add(id);
          floors.add(nd.floor);
          markers.push({ floor: nd.floor, x: nd.position[0], z: nd.position[2] });
        }
      title = "Existing lift upgraded to an evacuation lift";
      detail = `Secondary power supply, evacuation controls and a fire-protected lobby at each of ${seen.size} stops. No rooms lost.`;
    } else if (rep.kind === "unblock_connection") {
      const c = building.connections.find((x) => x.id === rep.connectionId);
      const a = c && nodes.get(c.from);
      const b = c && nodes.get(c.to);
      if (a && b) markers.push({ floor: a.floor, x: (a.position[0] + b.position[0]) / 2, z: (a.position[2] + b.position[2]) / 2 }), floors.add(a.floor);
      title = "Obstruction cleared";
      detail = `Door ${rep.connectionId} re-hung and kept clear.`;
    } else {
      const conns: Connection[] = rep.kind === "add_connection" ? [rep.connection] : rep.connections;
      const vertical = conns.filter((c) => (nodes.get(c.from)?.floor ?? 0) !== (nodes.get(c.to)?.floor ?? 0));
      const flat = conns.filter((c) => !vertical.includes(c));

      // Lifts / stairs: one shaft per change, through every floor it serves.
      if (vertical.length) {
        const isLift = vertical.every((c) => c.kind === "lift" || c.stepFree);
        const ends = vertical.flatMap((c) => [nodes.get(c.from), nodes.get(c.to)]).filter(Boolean) as RoomNode[];
        const lo = Math.min(...ends.map((e) => e.floor));
        const hi = Math.max(...ends.map((e) => e.floor));
        const served = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
        const bottom = ends.find((e) => e.floor === lo)!;
        const res = isLift ? carve(n, served, bottom.position[0], bottom.position[2], SHAFT, SHAFT, conns.some((c) => c.evacuationLift) ? "Evacuation lift (new)" : "Lift (new)", "core") : carve(n, served, bottom.position[0], bottom.position[2], 1.6, 5, "Staircase (new)", "stair");
        if (res) {
          const r = res.rects[0];
          const cx = (r[0] + r[2]) / 2;
          const cz = (r[1] + r[3]) / 2;
          for (const c of vertical) {
            if (isLift) anchors[c.id] = { foot: [cx, cz], head: [cx, cz] };
            else {
              const alongX = r[2] - r[0] > r[3] - r[1];
              anchors[c.id] = alongX ? { foot: [r[0] + 0.3, cz], head: [r[2] - 0.3, cz] } : { foot: [cx, r[3] - 0.3], head: [cx, r[1] + 0.3] };
            }
          }
          served.forEach((f) => {
            floors.add(f);
            markers.push({ floor: f, x: cx, z: cz });
          });
          const lost = Math.round(area(r));
          title = isLift ? (conns.some((c) => c.evacuationLift) ? "New evacuation lift" : "New lift") : "New staircase";
          detail = res.same
            ? `${isLift ? "Shaft" : "Stair enclosure"} (${lost} m² per floor) formed in ${res.hosts[0]}${res.hosts.length > 1 ? ` and the space above it on each floor (${res.hosts.slice(1, 3).join(", ")}${res.hosts.length > 3 ? ", …" : ""})` : ""}, opening onto the existing lobby.${isLift ? " Secondary power and protected lobbies." : ""}`
            : `${isLift ? "Shaft" : "Stair"} (${lost} m² per floor) formed in a corner of the existing space on ${served.length} floor(s).`;
        }
      }

      // Same-floor links: cut doors where they cross walls; convert rooms they pass through.
      const converted: string[] = [];
      let doors = 0;
      for (const c of flat) {
        const a = nodes.get(c.from);
        const b = nodes.get(c.to);
        const f = a && floorOf(a.floor);
        if (!a || !b || !f) continue;
        floors.add(a.floor);
        const [ax, az, bx, bz] = [a.position[0], a.position[2], b.position[0], b.position[2]];
        const seq: { s: Space; x: number; z: number }[] = [];
        const steps = Math.max(10, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05));
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((bx - ax) * k) / steps;
          const z = az + ((bz - az) * k) / steps;
          const s = spaceAt(f, x, z);
          if (s && (!seq.length || seq[seq.length - 1].s !== s)) seq.push({ s, x, z });
        }
        if (seq.length <= 1) {
          // Both ends in one space (e.g. two points on a corridor): an extra fire-door set beside the existing one.
          markers.push({ floor: a.floor, x: (ax + bx) / 2, z: (az + bz) / 2 + 0.6 });
          title ||= "Second fire-door set";
          detail ||= `Additional self-closing fire door set in the ${seq[0]?.s.name.toLowerCase() ?? "corridor"}, so one jammed door no longer cuts the route.`;
          continue;
        }
        for (let k = 0; k < seq.length - 1; k++) {
          const wall = sharedWall(seq[k].s.rect, seq[k + 1].s.rect);
          if (!wall) continue;
          const along = wall.axis === "z" ? seq[k + 1].z : seq[k + 1].x;
          const o = addDoor(f, wall, along, n);
          doors++;
          const m = doorMid(o);
          markers.push({ floor: a.floor, x: m.x, z: m.z });
        }
        for (const { s } of seq.slice(1, -1)) {
          if (s.kind === "room" || s.kind === "ancillary") {
            converted.push(s.name);
            s.replaces = s.name;
            s.name = "New corridor";
            s.kind = "circulation";
            s.changeNo = n;
          }
        }
        const ends = [seq[0].s.name, seq[seq.length - 1].s.name];
        if (!title || title === "Second fire-door set") {
          title = converted.length ? "New corridor" : doors > 1 ? "New doors" : "New door";
          detail = converted.length
            ? `New step-free route from ${ends[0]} to ${ends[1]}. ${converted.join(", ")} removed and converted to corridor.`
            : `New ${c.stepFree ? "step-free " : ""}door between ${ends[0]} and ${ends[1]}, giving a second way out.`;
        }
      }
    }
    if (!title) {
      title = "Change";
      detail = "";
    }
    changes.push({ n, title, detail, cost: rep.cost, floors: [...floors].sort((x, y) => x - y), markers });
  });

  return { plan: out, changes, anchors };
}
