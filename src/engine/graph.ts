import type { Building, Connection, Occupant, RoomNode, Scenario } from "@/contracts/types";

/** Thrown when a building, scenario or occupant is malformed. Never silently ignored. */
export class EngineValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid input: ${issues.join("; ")}`);
    this.name = "EngineValidationError";
    this.issues = issues;
  }
}

/** Collects every problem with a building rather than stopping at the first. */
export function buildingIssues(building: Building): string[] {
  const issues: string[] = [];
  if (!building || !Array.isArray(building.nodes) || !Array.isArray(building.connections) || !Array.isArray(building.occupants)) {
    return ["Building must have nodes, connections and occupants arrays."];
  }
  const nodeIds = new Set<string>();
  for (const node of building.nodes) {
    if (!node || typeof node.id !== "string" || node.id.length === 0) {
      issues.push("Every node needs a non-empty string id.");
      continue;
    }
    if (nodeIds.has(node.id)) issues.push(`Duplicate node id "${node.id}".`);
    nodeIds.add(node.id);
    if (!["room", "junction", "exit"].includes(node.kind)) issues.push(`Node "${node.id}" has unknown kind "${String(node.kind)}".`);
    if (!Array.isArray(node.position) || node.position.length !== 3 || !node.position.every(Number.isFinite)) {
      issues.push(`Node "${node.id}" position must be three finite numbers.`);
    }
  }
  const connectionIds = new Set<string>();
  for (const c of building.connections) {
    issues.push(...connectionIssues(c, nodeIds, connectionIds));
    if (c && typeof c.id === "string") connectionIds.add(c.id);
  }
  const occupantIds = new Set<string>();
  for (const o of building.occupants) {
    if (!o || typeof o.id !== "string" || o.id.length === 0) {
      issues.push("Every occupant needs a non-empty string id.");
      continue;
    }
    if (occupantIds.has(o.id)) issues.push(`Duplicate occupant id "${o.id}".`);
    occupantIds.add(o.id);
    if (!nodeIds.has(o.startNodeId)) issues.push(`Occupant "${o.id}" starts at unknown node "${o.startNodeId}".`);
    if (typeof o.requiresStepFree !== "boolean") issues.push(`Occupant "${o.id}" requiresStepFree must be a boolean.`);
  }
  return issues;
}

/** Problems with one connection, given known node ids and ids already taken. */
export function connectionIssues(c: Connection, nodeIds: Set<string>, takenIds: Set<string>): string[] {
  const issues: string[] = [];
  if (!c || typeof c.id !== "string" || c.id.length === 0) return ["Every connection needs a non-empty string id."];
  if (takenIds.has(c.id)) issues.push(`Duplicate connection id "${c.id}".`);
  if (!nodeIds.has(c.from)) issues.push(`Connection "${c.id}" starts at unknown node "${c.from}".`);
  if (!nodeIds.has(c.to)) issues.push(`Connection "${c.id}" ends at unknown node "${c.to}".`);
  if (typeof c.length !== "number" || !Number.isFinite(c.length) || c.length < 0) {
    issues.push(`Connection "${c.id}" length must be a finite, non-negative number.`);
  }
  if (typeof c.stepFree !== "boolean") issues.push(`Connection "${c.id}" stepFree must be a boolean.`);
  return issues;
}

export function scenarioIssues(building: Building, scenario: Scenario): string[] {
  if (!scenario || typeof scenario.id !== "string" || !Array.isArray(scenario.blockedConnectionIds)) {
    return ["Scenario must have an id and a blockedConnectionIds array."];
  }
  const known = new Set(building.connections.map((c) => c.id));
  return scenario.blockedConnectionIds
    .filter((id) => !known.has(id))
    .map((id) => `Scenario "${scenario.id}" blocks unknown connection "${id}".`);
}

export function assertValid(building: Building, scenario?: Scenario): void {
  const issues = buildingIssues(building);
  if (issues.length === 0 && scenario) issues.push(...scenarioIssues(building, scenario));
  if (issues.length > 0) throw new EngineValidationError(issues);
}

export type Edge = { to: string; connectionId: string; length: number; stepFree: boolean };
export type Adjacency = Map<string, Edge[]>;

/**
 * Undirected adjacency list for the traversable graph.
 * Blocked connections are removed; if stepFreeOnly, non-step-free connections are removed too.
 * Edges are sorted so traversal order never depends on input order.
 */
export function buildAdjacency(building: Building, blocked: Iterable<string>, stepFreeOnly: boolean): Adjacency {
  const blockedSet = new Set(blocked);
  const adj: Adjacency = new Map();
  for (const n of building.nodes) adj.set(n.id, []);
  for (const c of building.connections) {
    if (blockedSet.has(c.id)) continue;
    if (stepFreeOnly && !c.stepFree) continue;
    adj.get(c.from)!.push({ to: c.to, connectionId: c.id, length: c.length, stepFree: c.stepFree });
    if (c.from !== c.to) adj.get(c.to)!.push({ to: c.from, connectionId: c.id, length: c.length, stepFree: c.stepFree });
  }
  for (const edges of adj.values()) {
    edges.sort((a, b) => cmp(a.to, b.to) || a.length - b.length || cmp(a.connectionId, b.connectionId));
  }
  return adj;
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Exits an occupant may use: any exit, or only step-free exits if they need step-free access. */
export function eligibleExits(building: Building, occupant: Occupant): RoomNode[] {
  return building.nodes
    .filter((n) => n.kind === "exit" && (!occupant.requiresStepFree || n.stepFreeExit === true))
    .sort((a, b) => cmp(a.id, b.id));
}

export type Route = { nodes: string[]; connections: string[]; length: number; exitId: string };

/**
 * Dijkstra from one start node to the nearest of several targets.
 * Ties are broken by node id so the same input always gives the same route.
 */
export function shortestRoute(adj: Adjacency, start: string, targets: Set<string>): Route | null {
  if (!adj.has(start) || targets.size === 0) return null;
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; connectionId: string }>();
  const done = new Set<string>();
  // Graphs here are small; a sorted frontier keeps the code obviously correct and deterministic.
  const frontier: { node: string; d: number }[] = [{ node: start, d: 0 }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.d - b.d || cmp(a.node, b.node));
    const { node, d } = frontier.shift()!;
    if (done.has(node)) continue;
    done.add(node);
    if (targets.has(node)) {
      const nodes: string[] = [node];
      const connections: string[] = [];
      let cur = node;
      while (prev.has(cur)) {
        const p = prev.get(cur)!;
        connections.unshift(p.connectionId);
        nodes.unshift(p.node);
        cur = p.node;
      }
      return { nodes, connections, length: round(d), exitId: node };
    }
    for (const e of adj.get(node) ?? []) {
      if (done.has(e.to)) continue;
      const nd = d + e.length;
      const old = dist.get(e.to);
      if (old === undefined || nd < old - 1e-9) {
        dist.set(e.to, nd);
        prev.set(e.to, { node, connectionId: e.connectionId });
        frontier.push({ node: e.to, d: nd });
      }
    }
  }
  return null;
}

export function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Deep copy so callers can never mutate a shared building by accident. */
export function cloneBuilding(building: Building): Building {
  return {
    id: building.id,
    name: building.name,
    nodes: building.nodes.map((n) => ({ ...n, position: [...n.position] as RoomNode["position"] })),
    connections: building.connections.map((c) => ({ ...c })),
    occupants: building.occupants.map((o) => ({ ...o })),
  };
}

/**
 * Maximum number of edge-disjoint routes from start to any eligible exit,
 * which equals the minimum number of connection failures that disconnects it
 * (Menger's theorem). Unit-capacity Edmonds–Karp on the undirected graph.
 */
export function edgeConnectivityToExits(adj: Adjacency, start: string, exits: Set<string>): number {
  if (exits.has(start)) return Infinity;
  const SINK = "\u0000sink";
  // residual capacity keyed by "u->v"; parallel connections add capacity.
  const cap = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>();
  const link = (u: string, v: string, c: number) => {
    cap.set(`${u}->${v}`, (cap.get(`${u}->${v}`) ?? 0) + c);
    if (!cap.has(`${v}->${u}`)) cap.set(`${v}->${u}`, 0);
    if (!neighbours.has(u)) neighbours.set(u, new Set());
    if (!neighbours.has(v)) neighbours.set(v, new Set());
    neighbours.get(u)!.add(v);
    neighbours.get(v)!.add(u);
  };
  const seen = new Set<string>();
  for (const [u, edges] of adj) {
    for (const e of edges) {
      const key = `${e.connectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (u === e.to) continue;
      link(u, e.to, 1);
      link(e.to, u, 1);
    }
  }
  for (const x of exits) link(x, SINK, 1e9);

  let flow = 0;
  for (;;) {
    const parent = new Map<string, string>();
    const queue = [start];
    parent.set(start, start);
    while (queue.length && !parent.has(SINK)) {
      const u = queue.shift()!;
      for (const v of [...(neighbours.get(u) ?? [])].sort(cmp)) {
        if (!parent.has(v) && (cap.get(`${u}->${v}`) ?? 0) > 0) {
          parent.set(v, u);
          queue.push(v);
        }
      }
    }
    if (!parent.has(SINK)) return flow;
    let v = SINK;
    while (v !== start) {
      const u = parent.get(v)!;
      cap.set(`${u}->${v}`, cap.get(`${u}->${v}`)! - 1);
      cap.set(`${v}->${u}`, cap.get(`${v}->${u}`)! + 1);
      v = u;
    }
    flow += 1;
  }
}
