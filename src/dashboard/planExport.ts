import type { Building, Connection, RepairAudit, Repair, TestResult } from "@/contracts/types";
import { rectArea, type BuildingPlan, type FloorPlan, type Rect } from "@/data/demoPlan";
import { buildWalls } from "@/data/planWalls";

export type PlanExportInput = {
  building: Building;
  plan: BuildingPlan;
  result: TestResult;
  repairs: { repair: Repair; audit?: RepairAudit }[];
  budget: number;
  regressionsPassed?: { passed: number; total: number };
};

const S = 26; // px per metre
const PAD = 70;
const M2_TO_FT2 = 10.7639;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ftIn = (m: number) => {
  const inches = Math.round(m * 39.3701);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

/**
 * Estate-agent / architect style floor plan of every level, with verified repairs
 * highlighted, escape routes, a cost schedule and a title block. Returns SVG text.
 */
export function buildPlanSvg({ building, plan, result, repairs, budget, regressionsPassed }: PlanExportInput): string {
  const floors = plan.floors;
  const minX = Math.min(...floors.map((f) => f.footprint[0])) - 6;
  const maxX = Math.max(...floors.map((f) => f.footprint[2])) + 6;
  const width = Math.round((maxX - minX) * S + PAD * 2);
  const headerH = 150;
  const floorBlocks = floors.map((f) => (f.footprint[3] - f.footprint[1]) * S + 110);
  const scheduleH = 70 + Math.max(1, repairs.length) * 26 + 60;
  const height = Math.round(headerH + floorBlocks.reduce((a, b) => a + b, 0) + scheduleH + 90);
  const X = (x: number) => PAD + (x - minX) * S;
  const nodes = new Map(building.nodes.map((n) => [n.id, n]));
  const addedIds = new Set(repairs.filter((r) => r.audit?.accepted && r.repair.kind === "add_connection").map((r) => (r.repair as { connection: Connection }).connection.id));
  const totalArea = floors.reduce((s, f) => s + floorArea(f), 0);
  const spent = repairs.filter((r) => r.audit?.accepted).reduce((s, r) => s + r.repair.cost, 0);
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Helvetica, Arial, sans-serif">`);
  out.push(`<defs>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e8f0ff"/><line x1="0" y1="0" x2="0" y2="8" stroke="#2563eb" stroke-width="2" opacity="0.55"/></pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#0f766e"/></marker>
  </defs>`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // Header / title block
  out.push(`<text x="${PAD}" y="62" font-size="30" font-weight="800" letter-spacing="3" fill="#111827">${esc(building.name.replace(/\s*\(fictional\)/i, "").toUpperCase())}</text>`);
  out.push(`<text x="${PAD}" y="90" font-size="14" fill="#4b5563">Proposed floor plans · resilience improvements verified by ExitZero · ${esc(date)}</text>`);
  out.push(`<text x="${PAD}" y="116" font-size="13" fill="#111827" font-weight="600">Approx. gross internal area ${totalArea.toFixed(0)} m² (${Math.round(totalArea * M2_TO_FT2).toLocaleString("en-GB")} sq ft)</text>`);
  out.push(`<line x1="${PAD}" y1="134" x2="${width - PAD}" y2="134" stroke="#111827" stroke-width="2"/>`);
  compass(out, width - PAD - 30, 72);

  let y0 = headerH;
  floors.forEach((f, i) => {
    const Z = (z: number) => y0 + 70 + (z - f.footprint[1]) * S;
    const area = floorArea(f);
    out.push(`<text x="${X(f.footprint[0])}" y="${y0 + 32}" font-size="18" font-weight="800" letter-spacing="2" fill="#111827">${esc(f.name.toUpperCase())}</text>`);
    out.push(`<text x="${X(f.footprint[0])}" y="${y0 + 52}" font-size="12" fill="#6b7280">Approx. ${area.toFixed(1)} m² (${Math.round(area * M2_TO_FT2).toLocaleString("en-GB")} sq ft)</text>`);

    // Room fills
    for (const s of f.spaces) {
      const [x0, z0, x1, z1] = s.rect;
      const fill = s.kind === "void" ? "#f3f4f6" : s.kind === "circulation" || s.kind === "lobby" ? "#f8fafc" : s.kind === "stair" ? "#f3f4f6" : "#ffffff";
      out.push(`<rect x="${X(x0)}" y="${Z(z0)}" width="${(x1 - x0) * S}" height="${(z1 - z0) * S}" fill="${fill}"/>`);
    }

    // Proposed / verified new connections: hatched band now, callout drawn last (on top)
    const callouts: string[] = [];
    for (const c of building.connections) {
      if (!addedIds.has(c.id)) continue;
      const a = nodes.get(c.from);
      const b = nodes.get(c.to);
      if (!a || !b || a.floor !== f.floor || b.floor !== f.floor) continue;
      const [ax, az] = [a.position[0], a.position[2]];
      const [bx, bz] = [b.position[0], b.position[2]];
      const horiz = Math.abs(bx - ax) >= Math.abs(bz - az);
      const r: Rect = horiz ? [Math.min(ax, bx), az - 1.2, Math.max(ax, bx), az + 1.2] : [ax - 1.2, Math.min(az, bz), ax + 1.2, Math.max(az, bz)];
      out.push(`<rect x="${X(r[0])}" y="${Z(r[1])}" width="${(r[2] - r[0]) * S}" height="${(r[3] - r[1]) * S}" fill="url(#hatch)" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 4"/>`);
      out.push(`<rect x="${X(r[0])}" y="${Z(r[1])}" width="${(r[2] - r[0]) * S}" height="${(r[3] - r[1]) * S}" fill="none"/>`);
      const cost = repairs.find((x) => x.repair.kind === "add_connection" && x.repair.connection.id === c.id)?.repair.cost ?? 0;
      const hx = X((r[0] + r[2]) / 2);
      const hy = Z((r[1] + r[3]) / 2);
      const lx = Math.min(Math.max(hx, X(f.footprint[0]) + 430), X(f.footprint[2]) - 160);
      const ly = Z(f.footprint[1]) - 12;
      callouts.push(`<line x1="${hx}" y1="${hy}" x2="${lx}" y2="${ly}" stroke="#2563eb" stroke-width="1.5"/><circle cx="${hx}" cy="${hy}" r="4" fill="#2563eb"/>`);
      callouts.push(`<g><rect x="${lx - 150}" y="${ly - 30}" width="300" height="34" rx="5" fill="#2563eb"/><text x="${lx}" y="${ly - 16}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="1">PROPOSED · ${esc(c.id)}${c.stepFree ? " · STEP-FREE" : ""}</text><text x="${lx}" y="${ly - 3}" font-size="10.5" fill="#dbeafe" text-anchor="middle">New ${c.length.toFixed(1)} m link ${esc(c.from)} ↔ ${esc(c.to)} · £${cost.toLocaleString("en-GB")}</text></g>`);
    }

    // Stair treads for links that change level and touch this floor
    for (const c of building.connections) {
      const a = nodes.get(c.from);
      const b = nodes.get(c.to);
      if (!a || !b || a.floor === b.floor) continue;
      if (a.floor !== f.floor && b.floor !== f.floor) continue;
      const U = a.floor > b.floor ? a : b;
      const L = a.floor > b.floor ? b : a;
      const dir = Math.sign(L.position[0] - U.position[0]) || 1;
      const xEnd = L.position[0];
      const xStart = Math.abs(L.position[0] - U.position[0]) > 6 ? xEnd - dir * 6 : U.position[0];
      const zc = U.position[2];
      const [sx0, sx1] = [Math.min(xStart, xEnd), Math.max(xStart, xEnd)];
      out.push(`<rect x="${X(sx0)}" y="${Z(zc - 0.75)}" width="${(sx1 - sx0) * S}" height="${1.5 * S}" fill="#fff" stroke="#374151" stroke-width="1.2"/>`);
      for (let t = 1; t < 20; t++) {
        const xx = X(sx0 + ((sx1 - sx0) * t) / 20);
        out.push(`<line x1="${xx}" y1="${Z(zc - 0.75)}" x2="${xx}" y2="${Z(zc + 0.75)}" stroke="#6b7280" stroke-width="0.8"/>`);
      }
      const up = f.floor === L.floor;
      const ax0 = up ? X(xEnd) - dir * 8 : X(xStart) + dir * 8;
      const ax1 = up ? X(xStart) + dir * 10 : X(xEnd) - dir * 10;
      out.push(`<line x1="${ax0}" y1="${Z(zc)}" x2="${ax1}" y2="${Z(zc)}" stroke="#374151" stroke-width="1.2" marker-end="url(#arrow)"/>`);
      out.push(`<text x="${(ax0 + ax1) / 2}" y="${Z(zc) - 6}" font-size="9" fill="#374151" text-anchor="middle" font-weight="700">${up ? "UP" : "DN"} · ${esc(c.id)}</text>`);
    }

    // Walls (with door gaps and the openings that repairs cut)
    for (const w of buildWalls(f, new Set(building.connections.map((c) => c.id)))) {
      const t = w.exterior ? 0.3 : 0.14;
      if (w.axis === "x") out.push(`<rect x="${X(w.from)}" y="${Z(w.at) - (t * S) / 2}" width="${(w.to - w.from) * S}" height="${t * S}" fill="#2b2f36"/>`);
      else out.push(`<rect x="${X(w.at) - (t * S) / 2}" y="${Z(w.from)}" width="${t * S}" height="${(w.to - w.from) * S}" fill="#2b2f36"/>`);
    }

    // Door swings and exits
    for (const o of f.openings) {
      if (o.connectionId && !building.connections.some((c) => c.id === o.connectionId)) continue;
      const w = (o.to - o.from) * S;
      if (o.kind === "door") {
        if (o.axis === "x") {
          const hx = X(o.from);
          const hy = Z(o.at);
          out.push(`<path d="M${hx},${hy} L${hx},${hy + w} A${w},${w} 0 0,0 ${hx + w},${hy}" fill="none" stroke="#9ca3af" stroke-width="1"/>`);
        } else {
          const hx = X(o.at);
          const hy = Z(o.from);
          out.push(`<path d="M${hx},${hy} L${hx + w},${hy} A${w},${w} 0 0,1 ${hx},${hy + w}" fill="none" stroke="#9ca3af" stroke-width="1"/>`);
        }
      }
      if (o.kind === "exit") {
        const cx = o.axis === "z" ? X(o.at) : X((o.from + o.to) / 2);
        const cy = o.axis === "z" ? Z((o.from + o.to) / 2) : Z(o.at);
        const outward = o.axis === "z" ? (o.at <= f.footprint[0] + 1e-3 ? -1 : 1) : 0;
        out.push(`<rect x="${cx + outward * 34 - 26}" y="${cy - 11}" width="52" height="22" rx="3" fill="#16a34a"/><text x="${cx + outward * 34}" y="${cy + 4}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="1.5">EXIT</text>`);
      }
    }

    // Verified escape routes from the engine (only legs on this floor)
    for (const [occId, path] of Object.entries(result.paths)) {
      const occ = building.occupants.find((o) => o.id === occId);
      const pts = path.map((id) => nodes.get(id)).filter((n) => n && n.floor === f.floor);
      if (pts.length < 2) continue;
      const d = pts.map((n, k) => `${k ? "L" : "M"}${X(n!.position[0])},${Z(n!.position[2]) + (occ?.requiresStepFree ? 5 : -5)}`).join(" ");
      out.push(`<path d="${d}" fill="none" stroke="${occ?.requiresStepFree ? "#0891b2" : "#16a34a"}" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round"/>`);
    }

    // Room labels with dimensions
    for (const s of f.spaces) {
      if (s.kind === "void") continue;
      const [x0, z0, x1, z1] = s.rect;
      const w = x1 - x0;
      const d = z1 - z0;
      const cx = X((x0 + x1) / 2);
      const cy = Z((z0 + z1) / 2);
      const small = w < 3.6 || d < 2.4;
      if (s.kind === "circulation" && (w < 3 || d < 3)) continue;
      out.push(`<text x="${cx}" y="${cy - (small ? 2 : 6)}" font-size="${small ? 9 : 11.5}" font-weight="800" fill="#111827" text-anchor="middle" letter-spacing="0.8">${esc(s.name.toUpperCase())}</text>`);
      if (!small && s.kind !== "circulation" && s.kind !== "stair") {
        out.push(`<text x="${cx}" y="${cy + 9}" font-size="9.5" fill="#4b5563" text-anchor="middle">${w.toFixed(2)}m x ${d.toFixed(2)}m</text>`);
        out.push(`<text x="${cx}" y="${cy + 21}" font-size="9.5" fill="#6b7280" text-anchor="middle">(${ftIn(w)} x ${ftIn(d)})</text>`);
      }
    }
    out.push(...callouts);
    if (i === 0) scaleBar(out, X(f.footprint[2]) - 5 * S, Z(f.footprint[3]) + 30);
    y0 += floorBlocks[i];
  });

  // Cost schedule
  const tableX = PAD;
  let ty = y0 + 20;
  out.push(`<text x="${tableX}" y="${ty}" font-size="15" font-weight="800" letter-spacing="2" fill="#111827">SCHEDULE OF VERIFIED CHANGES</text>`);
  ty += 14;
  out.push(`<line x1="${tableX}" y1="${ty}" x2="${width - PAD}" y2="${ty}" stroke="#111827"/>`);
  const cols = [tableX, tableX + 110, tableX + 520, tableX + 680, tableX + 820];
  ty += 20;
  ["Ref", "Change", "Judge verdict", "Length", "Cost"].forEach((h, k) => out.push(`<text x="${cols[k]}" y="${ty}" font-size="11" font-weight="700" fill="#6b7280">${h.toUpperCase()}</text>`));
  const accepted = repairs.filter((r) => r.audit?.accepted);
  if (accepted.length === 0) {
    ty += 26;
    out.push(`<text x="${cols[0]}" y="${ty}" font-size="12" fill="#6b7280">No changes verified yet: this is the existing layout.</text>`);
  }
  for (const r of accepted) {
    ty += 26;
    const c = r.repair.kind === "add_connection" ? r.repair.connection : null;
    const desc = c ? `New ${c.stepFree ? "step-free " : ""}link ${c.from} ↔ ${c.to}` : `Clear obstruction on ${(r.repair as { connectionId: string }).connectionId}`;
    out.push(`<text x="${cols[0]}" y="${ty}" font-size="12" font-weight="700" fill="#2563eb">${esc(c?.id ?? (r.repair as { connectionId: string }).connectionId)}</text>`);
    out.push(`<text x="${cols[1]}" y="${ty}" font-size="12" fill="#111827">${esc(desc)}</text>`);
    out.push(`<text x="${cols[2]}" y="${ty}" font-size="12" fill="#16a34a" font-weight="700">ACCEPTED</text>`);
    out.push(`<text x="${cols[3]}" y="${ty}" font-size="12" fill="#111827">${c ? `${c.length.toFixed(1)} m` : "—"}</text>`);
    out.push(`<text x="${cols[4]}" y="${ty}" font-size="12" fill="#111827">£${r.repair.cost.toLocaleString("en-GB")}</text>`);
  }
  ty += 14;
  out.push(`<line x1="${tableX}" y1="${ty}" x2="${width - PAD}" y2="${ty}" stroke="#d1d5db"/>`);
  ty += 22;
  out.push(`<text x="${cols[3]}" y="${ty}" font-size="12" font-weight="700" fill="#111827">Total</text><text x="${cols[4]}" y="${ty}" font-size="12" font-weight="800" fill="#111827">£${spent.toLocaleString("en-GB")} of £${budget.toLocaleString("en-GB")}</text>`);
  out.push(`<text x="${cols[0]}" y="${ty}" font-size="12" fill="#111827">${result.reachableCount}/${result.totalCount} occupants have a verified route${regressionsPassed ? ` · ${regressionsPassed.passed}/${regressionsPassed.total} regression scenarios pass` : ""}</text>`);

  // Legend + disclaimer
  ty += 34;
  const lg = [
    ["#2563eb", "Proposed change (hatched)"],
    ["#16a34a", "Escape route (engine-verified)"],
    ["#0891b2", "Step-free route"],
    ["#2b2f36", "Walls"],
  ];
  lg.forEach(([c, t], k) => {
    const lx = tableX + k * 240;
    out.push(`<rect x="${lx}" y="${ty - 10}" width="22" height="10" fill="${c}"/><text x="${lx + 30}" y="${ty}" font-size="11" fill="#374151">${t}</text>`);
  });
  ty += 26;
  out.push(`<text x="${tableX}" y="${ty}" font-size="10" fill="#9ca3af">For illustrative purposes only. Measurements are approximate and not to be used for construction. Connectivity study of a fictional building; not a fire-safety, evacuation-time or building-regulations assessment.</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

function floorArea(f: FloorPlan): number {
  return f.spaces.filter((s) => s.kind !== "void").reduce((s, sp) => s + rectArea(sp.rect), 0);
}

function compass(out: string[], cx: number, cy: number) {
  out.push(`<g transform="translate(${cx},${cy})"><circle r="24" fill="none" stroke="#111827" stroke-width="1.5"/><path d="M0,-20 L7,8 L0,3 L-7,8 z" fill="#111827"/><text y="-30" font-size="12" font-weight="800" text-anchor="middle" fill="#111827">N</text></g>`);
}

function scaleBar(out: string[], x: number, y: number) {
  for (let i = 0; i < 5; i++) out.push(`<rect x="${x + i * S}" y="${y}" width="${S}" height="6" fill="${i % 2 ? "#fff" : "#111827"}" stroke="#111827" stroke-width="1"/>`);
  out.push(`<text x="${x}" y="${y + 20}" font-size="10" fill="#374151">0</text><text x="${x + 5 * S}" y="${y + 20}" font-size="10" fill="#374151" text-anchor="end">5 m</text>`);
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadPng(filename: string, svg: string, scale = 2) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not render plan"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
