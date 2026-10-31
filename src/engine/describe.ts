import type { Building, Connection } from "@/contracts/types";

/** Plain-English name for a connection, e.g. "West stair (level 2 to 3)" or "Main entrance door". */
export function describeConnection(building: Building, c: Connection | string): string {
  const conn = typeof c === "string" ? building.connections.find((x) => x.id === c) : c;
  if (!conn) return String(c);
  const a = building.nodes.find((n) => n.id === conn.from);
  const b = building.nodes.find((n) => n.id === conn.to);
  const la = a?.label ?? conn.from;
  const lb = b?.label ?? conn.to;
  const lvl = (f: number) => (f === 0 ? "ground" : `level ${f}`);
  if (conn.kind === "lift" && a && b) return `${conn.evacuationLift ? "Evacuation lift" : "Lift"} (${lvl(Math.min(a.floor, b.floor))} to ${lvl(Math.max(a.floor, b.floor))})`;
  if ((conn.kind === "stairs" || !conn.stepFree) && a && b && a.floor !== b.floor) {
    const name = /west/i.test(la + lb) ? "West stair" : /east/i.test(la + lb) ? "East stair" : "Staircase";
    return `${name} (${lvl(Math.min(a.floor, b.floor))} to ${lvl(Math.max(a.floor, b.floor))})`;
  }
  if (b?.kind === "exit") return `${lb} door`;
  if (a?.kind === "exit") return `${la} door`;
  if (/corridor/i.test(la) && /corridor/i.test(lb)) return `${a ? lvl(a.floor) : ""} corridor fire door`.trim().replace(/^./, (x) => x.toUpperCase());
  return `Door between ${la} and ${lb}`;
}

/** Plain-English description of a blocked set. */
export function describeBlocked(building: Building, ids: string[]): string {
  const names = ids.map((id) => describeConnection(building, id));
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Internal headcount estimate per occupant (never shown to the user): each tracked
 * occupant stands in for the typical population of their floor, estimated from
 * room count and a building-type density. Used only to rank which failures matter most.
 */
export function occupantWeights(building: Building, perRoom = 2.5): Record<string, number> {
  const roomsPerFloor = new Map<number, number>();
  for (const n of building.nodes) if (n.kind === "room") roomsPerFloor.set(n.floor, (roomsPerFloor.get(n.floor) ?? 0) + 1);
  const occPerFloor = new Map<number, number>();
  const floorOf = (id: string) => building.nodes.find((n) => n.id === id)?.floor ?? 0;
  for (const o of building.occupants) occPerFloor.set(floorOf(o.startNodeId), (occPerFloor.get(floorOf(o.startNodeId)) ?? 0) + 1);
  const w: Record<string, number> = {};
  for (const o of building.occupants) {
    const f = floorOf(o.startNodeId);
    const people = Math.max(1, (roomsPerFloor.get(f) ?? 1) * perRoom * 4); // assume ~4x more rooms than tracked
    w[o.id] = people / (occPerFloor.get(f) ?? 1) * (o.requiresStepFree ? 1.5 : 1);
  }
  return w;
}
