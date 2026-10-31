import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { geminiConfig } from "@/agents";
import { buildingIssues } from "@/engine";
import type { Building, Connection, RoomNode } from "@/contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STOREY = 4.5;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          z: { type: "number" },
          floor: { type: "integer" },
          kind: { type: "string", enum: ["room", "junction", "exit"] },
          stepFreeExit: { type: "boolean" },
        },
        required: ["id", "label", "x", "z", "floor", "kind"],
      },
    },
    connections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          length: { type: "number" },
          stepFree: { type: "boolean" },
          kind: { type: "string", enum: ["corridor", "door", "stairs", "lift", "ramp"] },
        },
        required: ["id", "from", "to", "length", "stepFree", "kind"],
      },
    },
    occupants: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, label: { type: "string" }, startNodeId: { type: "string" }, requiresStepFree: { type: "boolean" } },
        required: ["id", "label", "startNodeId", "requiresStepFree"],
      },
    },
  },
  required: ["name", "nodes", "connections", "occupants"],
};

const PROMPT = `You convert an architectural floor plan into an evacuation connectivity graph.
Rules:
- Coordinates x (east) and z (south) in metres, origin at the plan's top-left. Estimate scale from dimensions or typical door widths (~0.9 m).
- floor: 0 = ground, 1 = first, etc. If several floors are drawn, give each its own floor number.
- nodes: one "room" per significant room, a "junction" for corridor/lobby/landing points, and an "exit" for each final exit door. stepFreeExit = true only for level exits with no steps.
- connections: undirected links people walk. kind "stairs" (stepFree false) and "lift" (stepFree true) join different floors; "door"/"corridor" join nodes on one floor. length = walking distance in metres (at least the straight-line distance).
- occupants: one per main room (id O1, O2…); mark at least one occupant on an upper floor as requiresStepFree = true if any upper floor exists.
- IDs: short, uppercase, unique, letters/digits/underscore only.
Return JSON only.`;

export async function POST(req: Request) {
  const { key, model } = geminiConfig();
  if (!key) return NextResponse.json({ success: false, error: "Reading floor-plan images needs GEMINI_API_KEY on the server. You can still upload a building JSON file." }, { status: 503 });
  let body: { data?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON." }, { status: 400 });
  }
  const mimeType = String(body.mimeType ?? "");
  const data = String(body.data ?? "");
  if (!TYPES.includes(mimeType)) return NextResponse.json({ success: false, error: "Upload a PNG, JPEG, WebP or PDF floor plan." }, { status: 400 });
  if (data.length * 0.75 > MAX_BYTES) return NextResponse.json({ success: false, error: "File too large (max 8 MB)." }, { status: 413 });

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data } }, { text: PROMPT }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.1 },
    });
    const raw = JSON.parse(res.text ?? "{}");
    const building = toBuilding(raw);
    const issues = buildingIssues(building);
    if (issues.length) return NextResponse.json({ success: false, error: `Gemini's reading of the plan was not a valid graph: ${issues.slice(0, 3).join(" ")}` }, { status: 422 });
    return NextResponse.json({ success: true, data: building, source: "gemini" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `Could not read the floor plan: ${msg.slice(0, 200)}` }, { status: 502 });
  }
}

type RawNode = { id: string; label: string; x: number; z: number; floor: number; kind: RoomNode["kind"]; stepFreeExit?: boolean };
type RawConn = { id: string; from: string; to: string; length: number; stepFree: boolean; kind: Connection["kind"] };

function toBuilding(raw: { name?: string; nodes?: RawNode[]; connections?: RawConn[]; occupants?: Building["occupants"] }): Building {
  const nodes: RoomNode[] = (raw.nodes ?? []).slice(0, 150).map((n) => ({
    id: clean(n.id),
    label: String(n.label ?? n.id).slice(0, 40),
    position: [Number(n.x) || 0, (Number(n.floor) || 0) * STOREY, Number(n.z) || 0],
    floor: Number(n.floor) || 0,
    kind: n.kind,
    ...(n.kind === "exit" ? { stepFreeExit: Boolean(n.stepFreeExit) } : {}),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connections: Connection[] = (raw.connections ?? []).slice(0, 400).map((c) => {
    const a = byId.get(clean(c.from));
    const b = byId.get(clean(c.to));
    const straight = a && b ? Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]) : 0;
    return {
      id: clean(c.id),
      from: clean(c.from),
      to: clean(c.to),
      length: Math.max(Number(c.length) || 0, Math.round(straight * 10) / 10),
      stepFree: c.kind === "stairs" ? false : Boolean(c.stepFree),
      floor: a && b ? Math.min(a.floor, b.floor) : 0,
      kind: c.kind,
    };
  });
  const occupants = (raw.occupants ?? []).slice(0, 50).map((o) => ({ id: clean(o.id), label: String(o.label).slice(0, 40), startNodeId: clean(o.startNodeId), requiresStepFree: Boolean(o.requiresStepFree) }));
  return { id: "uploaded", name: String(raw.name ?? "Uploaded building").slice(0, 60), nodes, connections, occupants };
}

function clean(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 24);
}
