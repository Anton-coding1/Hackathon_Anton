import type { Building, RepairAudit, Repair, TestResult } from "@/contracts/types";
import { rectArea, type BuildingPlan, type FloorPlan, type Rect } from "@/data/demoPlan";
import { autoPlan } from "@/data/autoPlan";
import { planChanges } from "@/data/planChanges";
import type { CostRates } from "@/cost/costModel";
import { buildWalls } from "@/data/planWalls";

export type PlanExportInput = {
  building: Building;
  plan?: BuildingPlan;
  runs?: { attacker: number; defender: number; judge: number; geminiCalls: number; fallbackCalls: number; regressionChecks: number };
  scenariosEvaluated?: number;
  rates?: CostRates;
  result: TestResult;
  repairs: { repair: Repair; audit?: RepairAudit; scenario?: { name: string; blockedConnectionIds: string[] } }[];
  certificate?: { faultFree: boolean; tolerance: number; checked: number };
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
export function buildPlanSvg({ building, plan: planIn, result, repairs, budget, regressionsPassed, runs, scenariosEvaluated, rates, certificate }: PlanExportInput): string {
  const accepted = repairs.filter((r) => r.audit?.accepted);
  // The plan as built: every verified change applied to walls, rooms and shafts.
  const { plan, changes, anchors } = planChanges(planIn ?? autoPlan(building), building, accepted.map((r) => r.repair));
  const floors = plan.floors;
  const minX = Math.min(...floors.map((f) => f.footprint[0])) - 6;
  const maxX = Math.max(...floors.map((f) => f.footprint[2])) + 6;
  const width = Math.max(1100, Math.round((maxX - minX) * S + PAD * 2));
  const headerH = 150;
  const floorBlocks = floors.map((f) => (f.footprint[3] - f.footprint[1]) * S + 110);
  const scheduleH = 70 + Math.max(1, changes.length) * 52 + 140;
  const height = Math.round(headerH + floorBlocks.reduce((a, b) => a + b, 0) + scheduleH + 90);
  const X = (x: number) => PAD + (x - minX) * S;
  const nodes = new Map(building.nodes.map((n) => [n.id, n]));
  const totalArea = floors.reduce((s, f) => s + floorArea(f), 0);
  const spent = accepted.reduce((s, r) => s + r.repair.cost, 0);
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Helvetica, Arial, sans-serif">`);
  out.push(`<defs>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#eaf1ff"/><line x1="0" y1="0" x2="0" y2="8" stroke="#2563eb" stroke-width="1.6" opacity="0.45"/></pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker>
  </defs>`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  out.push(`<text x="${PAD}" y="62" font-size="30" font-weight="800" letter-spacing="3" fill="#111827">${esc(building.name.replace(/\s*\(fictional\)/i, "").toUpperCase())}</text>`);
  out.push(`<text x="${PAD}" y="90" font-size="14" fill="#4b5563">${changes.length ? "Proposed floor plans with verified resilience changes" : "Existing floor plans"} · ExitZero · ${esc(date)}</text>`);
  out.push(`<text x="${PAD}" y="116" font-size="13" fill="#111827" font-weight="600">Approx. gross internal area ${totalArea.toFixed(0)} m² (${Math.round(totalArea * M2_TO_FT2).toLocaleString("en-GB")} sq ft)</text>`);
  out.push(`<line x1="${PAD}" y1="134" x2="${width - PAD}" y2="134" stroke="#111827" stroke-width="2"/>`);
  compass(out, width - PAD - 30, 72);

  let y0 = headerH;
  floors.forEach((f, i) => {
    const Z = (z: number) => y0 + 70 + (z - f.footprint[1]) * S;
    const R = ([x0, z0, x1, z1]: Rect) => `x="${X(x0)}" y="${Z(z0)}" width="${(x1 - x0) * S}" height="${(z1 - z0) * S}"`;
    const area = floorArea(f);
    out.push(`<text x="${X(f.footprint[0])}" y="${y0 + 32}" font-size="18" font-weight="800" letter-spacing="2" fill="#111827">${esc(f.name.toUpperCase())}</text>`);
    out.push(`<text x="${X(f.footprint[0])}" y="${y0 + 52}" font-size="12" fill="#6b7280">Approx. ${area.toFixed(1)} m² (${Math.round(area * M2_TO_FT2).toLocaleString("en-GB")} sq ft)</text>`);

    // Room fills: changed spaces (converted rooms, new shafts, new stairs) are hatched blue.
    for (const sp of f.spaces) {
      const fill = sp.changeNo !== undefined ? "url(#hatch)" : sp.kind === "void" ? "#f3f4f6" : sp.kind === "circulation" || sp.kind === "lobby" ? "#f8fafc" : sp.kind === "stair" ? "#f3f4f6" : "#ffffff";
      out.push(`<rect ${R(sp.rect)} fill="${fill}"${sp.changeNo !== undefined ? ` stroke="#2563eb" stroke-width="1.5"` : ""}/>`);
      if (sp.changeNo !== undefined && sp.kind === "core") {
        const [x0, z0, x1, z1] = sp.rect;
        out.push(`<line x1="${X(x0)}" y1="${Z(z0)}" x2="${X(x1)}" y2="${Z(z1)}" stroke="#2563eb" stroke-width="1.2"/><line x1="${X(x1)}" y1="${Z(z0)}" x2="${X(x0)}" y2="${Z(z1)}" stroke="#2563eb" stroke-width="1.2"/>`);
      }
      if (sp.changeNo !== undefined && sp.kind === "stair") {
        const [x0, z0, x1, z1] = sp.rect;
        const alongX = x1 - x0 > z1 - z0;
        for (let t = 1; t < 14; t++) {
          if (alongX) {
            const xx = X(x0 + ((x1 - x0) * t) / 14);
            out.push(`<line x1="${xx}" y1="${Z(z0)}" x2="${xx}" y2="${Z(z1)}" stroke="#2563eb" stroke-width="0.8"/>`);
          } else {
            const zz = Z(z0 + ((z1 - z0) * t) / 14);
            out.push(`<line x1="${X(x0)}" y1="${zz}" x2="${X(x1)}" y2="${zz}" stroke="#2563eb" stroke-width="0.8"/>`);
          }
        }
      }
    }

    // Existing stairs and lifts (one symbol per shaft per floor). New ones are drawn as spaces above.
    const liftSeen = new Set<string>();
    for (const c of building.connections) {
      const a = nodes.get(c.from);
      const b = nodes.get(c.to);
      if (!a || !b || a.floor === b.floor || anchors[c.id]) continue;
      const lo = Math.min(a.floor, b.floor);
      const hi = Math.max(a.floor, b.floor);
      if (f.floor < lo || f.floor > hi) continue;
      if (c.kind === "lift") {
        const U0 = a.floor > b.floor ? a : b;
        const key = `${U0.position[0].toFixed(1)},${U0.position[2].toFixed(1)}`;
        if (liftSeen.has(key)) continue;
        liftSeen.add(key);
        const lx = X(U0.position[0]);
        const lz = Z(U0.position[2] - 1.2);
        const h = 0.8 * S;
        const col = c.evacuationLift ? "#16a34a" : "#374151";
        out.push(`<rect x="${lx - h}" y="${lz - h}" width="${2 * h}" height="${2 * h}" fill="#fff" stroke="${col}" stroke-width="2"/><line x1="${lx - h}" y1="${lz - h}" x2="${lx + h}" y2="${lz + h}" stroke="${col}" stroke-width="1"/><line x1="${lx + h}" y1="${lz - h}" x2="${lx - h}" y2="${lz + h}" stroke="${col}" stroke-width="1"/>`);
        out.push(`<text x="${lx}" y="${lz + h + 11}" font-size="8.5" font-weight="700" fill="${col}" text-anchor="middle">${c.evacuationLift ? "EVAC LIFT" : "LIFT"}</text>`);
        continue;
      }
      if (f.floor !== a.floor && f.floor !== b.floor) continue;
      const U = a.floor > b.floor ? a : b;
      const L = a.floor > b.floor ? b : a;
      const dir = Math.sign(L.position[0] - U.position[0]) || 1;
      const xEnd = L.position[0];
      const xStart = Math.abs(L.position[0] - U.position[0]) > 6 ? xEnd - dir * 6 : U.position[0];
      const zc = U.position[2];
      const [sx0, sx1] = [Math.min(xStart, xEnd), Math.max(xStart, xEnd)];
      if (sx1 - sx0 < 0.5) continue;
      out.push(`<rect x="${X(sx0)}" y="${Z(zc - 0.75)}" width="${(sx1 - sx0) * S}" height="${1.5 * S}" fill="#fff" stroke="#374151" stroke-width="1.2"/>`);
      for (let t = 1; t < 20; t++) {
        const xx = X(sx0 + ((sx1 - sx0) * t) / 20);
        out.push(`<line x1="${xx}" y1="${Z(zc - 0.75)}" x2="${xx}" y2="${Z(zc + 0.75)}" stroke="#9ca3af" stroke-width="0.8"/>`);
      }
      const up = f.floor === L.floor;
      const ax0 = up ? X(xEnd) - dir * 8 : X(xStart) + dir * 8;
      const ax1 = up ? X(xStart) + dir * 10 : X(xEnd) - dir * 10;
      out.push(`<line x1="${ax0}" y1="${Z(zc)}" x2="${ax1}" y2="${Z(zc)}" stroke="#374151" stroke-width="1.2" marker-end="url(#arrow)"/>`);
      out.push(`<text x="${(ax0 + ax1) / 2}" y="${Z(zc) - 6}" font-size="9" fill="#374151" text-anchor="middle" font-weight="700">${up ? "UP" : "DN"}</text>`);
    }

    // Walls with door gaps (incl. the doors that verified changes cut)
    for (const w of buildWalls(f, new Set(building.connections.map((c) => c.id)))) {
      const t = w.exterior ? 0.3 : 0.14;
      if (w.axis === "x") out.push(`<rect x="${X(w.from)}" y="${Z(w.at) - (t * S) / 2}" width="${(w.to - w.from) * S}" height="${t * S}" fill="#2b2f36"/>`);
      else out.push(`<rect x="${X(w.at) - (t * S) / 2}" y="${Z(w.from)}" width="${t * S}" height="${(w.to - w.from) * S}" fill="#2b2f36"/>`);
    }

    // Door swings (new doors in blue) and exits
    for (const o of f.openings) {
      if (o.connectionId && !building.connections.some((c) => c.id === o.connectionId)) continue;
      const w = (o.to - o.from) * S;
      const col = o.changeNo !== undefined ? "#2563eb" : "#9ca3af";
      const sw = o.changeNo !== undefined ? 1.8 : 1;
      if (o.kind === "door") {
        if (o.axis === "x") {
          const hx = X(o.from);
          const hy = Z(o.at);
          out.push(`<path d="M${hx},${hy} L${hx},${hy + w} A${w},${w} 0 0,0 ${hx + w},${hy}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
        } else {
          const hx = X(o.at);
          const hy = Z(o.from);
          out.push(`<path d="M${hx},${hy} L${hx + w},${hy} A${w},${w} 0 0,1 ${hx},${hy + w}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
        }
      }
      if (o.kind === "exit") {
        const cx = o.axis === "z" ? X(o.at) : X((o.from + o.to) / 2);
        const cy = o.axis === "z" ? Z((o.from + o.to) / 2) : Z(o.at);
        const outward = o.axis === "z" ? (o.at <= f.footprint[0] + 1e-3 ? -1 : 1) : 0;
        const dy = o.axis === "x" ? (o.at >= f.footprint[3] - 1e-3 ? 18 : -18) : 0;
        out.push(`<rect x="${cx + outward * 34 - 26}" y="${cy + dy - 11}" width="52" height="22" rx="3" fill="#16a34a"/><text x="${cx + outward * 34}" y="${cy + dy + 4}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="1.5">EXIT</text>`);
      }
    }

    // Room labels with dimensions; changed spaces say what they were.
    for (const sp of f.spaces) {
      if (sp.kind === "void") continue;
      const [x0, z0, x1, z1] = sp.rect;
      const w = x1 - x0;
      const d = z1 - z0;
      const cx = X((x0 + x1) / 2);
      const cy = Z((z0 + z1) / 2);
      const small = w < 3.6 || d < 2.4;
      if (sp.kind === "circulation" && sp.changeNo === undefined && (w < 3 || d < 3)) continue;
      if (sp.kind === "stair" && sp.changeNo === undefined) continue;
      const blue = sp.changeNo !== undefined;
      const name = sp.kind === "core" ? "EVAC LIFT" : sp.name.toUpperCase();
      // Rooms reduced by a shaft: label sits in the remaining part.
      const shift = sp.reducedBy ? 10 : 0;
      out.push(`<text x="${cx}" y="${cy - (small ? 2 : 6) + shift}" font-size="${small ? 9 : 11.5}" font-weight="800" fill="${blue ? "#1d4ed8" : "#111827"}" text-anchor="middle" letter-spacing="0.8">${esc(name)}</text>`);
      if (sp.replaces && sp.kind !== "core") out.push(`<text x="${cx}" y="${cy + 8}" font-size="9.5" fill="#1d4ed8" text-anchor="middle">was ${esc(sp.replaces)} · removed</text>`);
      else if (!small && sp.kind !== "circulation" && sp.kind !== "stair" && sp.kind !== "core") {
        const a = rectArea(sp.rect) - (sp.reducedBy ?? 0);
        out.push(`<text x="${cx}" y="${cy + 9 + shift}" font-size="9.5" fill="#4b5563" text-anchor="middle">${sp.reducedBy ? `${a.toFixed(1)} m² (reduced)` : `${w.toFixed(2)}m x ${d.toFixed(2)}m`}</text>`);
        if (!sp.reducedBy) out.push(`<text x="${cx}" y="${cy + 21}" font-size="9.5" fill="#6b7280" text-anchor="middle">(${ftIn(w)} x ${ftIn(d)})</text>`);
      }
    }

    // Verified escape routes from the engine (only legs on this floor)
    for (const [occId, path] of Object.entries(result.paths)) {
      const occ = building.occupants.find((o) => o.id === occId);
      const pts = path.map((id) => nodes.get(id)).filter((n) => n && n.floor === f.floor);
      if (pts.length < 2) continue;
      const d = pts.map((n, k) => `${k ? "L" : "M"}${X(n!.position[0])},${Z(n!.position[2]) + (occ?.requiresStepFree ? 5 : -5)}`).join(" ");
      out.push(`<path d="${d}" fill="none" stroke="${occ?.requiresStepFree ? "#0891b2" : "#16a34a"}" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" opacity="0.8"/>`);
    }

    // One numbered marker per change on this floor, matching the schedule.
    const placed: [number, number][] = [];
    for (const ch of changes) {
      const m = ch.markers.find((mk) => mk.floor === f.floor);
      if (!m) continue;
      let px = X(m.x);
      const py = Z(m.z);
      while (placed.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < 24)) px += 24;
      placed.push([px, py]);
      out.push(`<g><circle cx="${px}" cy="${py}" r="11" fill="#2563eb" stroke="#fff" stroke-width="2"/><text x="${px}" y="${py + 4}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">${ch.n}</text></g>`);
    }
    if (i === 0) scaleBar(out, X(f.footprint[2]) - 5 * S, Z(f.footprint[3]) + 30);
    y0 += floorBlocks[i];
  });

  // Schedule of verified changes
  const tableX = PAD;
  let ty = y0 + 20;
  out.push(`<text x="${tableX}" y="${ty}" font-size="15" font-weight="800" letter-spacing="2" fill="#111827">SCHEDULE OF VERIFIED CHANGES</text>`);
  ty += 14;
  out.push(`<line x1="${tableX}" y1="${ty}" x2="${width - PAD}" y2="${ty}" stroke="#111827"/>`);
  const costX = width - PAD - 10;
  ty += 20;
  out.push(`<text x="${tableX}" y="${ty}" font-size="11" font-weight="700" fill="#6b7280">NO.</text><text x="${tableX + 46}" y="${ty}" font-size="11" font-weight="700" fill="#6b7280">CHANGE · WHY IT IS NEEDED</text><text x="${costX}" y="${ty}" font-size="11" font-weight="700" fill="#6b7280" text-anchor="end">COST</text>`);
  if (changes.length === 0) {
    ty += 26;
    out.push(`<text x="${tableX}" y="${ty}" font-size="12" fill="#6b7280">No changes needed: this is the existing layout.</text>`);
  }
  changes.forEach((ch, k) => {
    ty += 30;
    const why = accepted[k]?.scenario;
    out.push(`<circle cx="${tableX + 11}" cy="${ty - 4}" r="11" fill="#2563eb"/><text x="${tableX + 11}" y="${ty}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">${ch.n}</text>`);
    out.push(`<text x="${tableX + 46}" y="${ty}" font-size="13" font-weight="700" fill="#111827">${esc(ch.title)}</text>`);
    out.push(`<text x="${costX}" y="${ty}" font-size="13" font-weight="700" fill="#111827" text-anchor="end">£${ch.cost.toLocaleString("en-GB")}</text>`);
    for (const line of wrap(ch.detail, 120)) {
      ty += 15;
      out.push(`<text x="${tableX + 46}" y="${ty}" font-size="11" fill="#374151">${esc(line)}</text>`);
    }
    if (why) {
      ty += 15;
      out.push(`<text x="${tableX + 46}" y="${ty}" font-size="11" fill="#6b7280">Needed because: ${esc(plainScenario(why.name))}</text>`);
    }
  });
  ty += 18;
  out.push(`<line x1="${tableX}" y1="${ty}" x2="${width - PAD}" y2="${ty}" stroke="#d1d5db"/>`);
  ty += 22;
  out.push(`<text x="${tableX}" y="${ty}" font-size="12" fill="#111827">${result.reachableCount}/${result.totalCount} tracked occupants have a verified route${regressionsPassed ? ` · ${regressionsPassed.passed}/${regressionsPassed.total} past failures re-checked` : ""}</text>`);
  out.push(`<text x="${costX}" y="${ty}" font-size="13" font-weight="800" fill="#111827" text-anchor="end">Total £${spent.toLocaleString("en-GB")}</text>`);
  if (certificate) {
    ty += 26;
    out.push(`<rect x="${tableX}" y="${ty - 16}" width="${width - PAD * 2}" height="24" rx="4" fill="${certificate.faultFree ? "#ecfdf3" : "#fef3f2"}"/><text x="${tableX + 10}" y="${ty}" font-size="12" font-weight="700" fill="${certificate.faultFree ? "#067647" : "#b42318"}">${certificate.faultFree ? `EVERYONE CAN GET OUT: with the fire alarm on, whichever ${certificate.tolerance === 1 ? "path" : `${certificate.tolerance} paths`} fire blocks, there is another way out (${certificate.checked} scenarios checked).` : `NOT YET: some blocked-path scenarios still trap someone.`}</text>`);
  }
  ty += 26;
  const costSrc = rates?.source === "gemini-search" ? `Costs from live UK rates via Gemini + Google Search (${rates.asOf}${rates.sources.length ? `, ${rates.sources.length} sources` : ""})` : "Costs from built-in indicative rates (not a quotation)";
  if (runs) out.push(`<text x="${tableX}" y="${ty}" font-size="11.5" fill="#374151">Analysis: ${runs.attacker} attacks, ${runs.defender} proposals, ${runs.judge} judge verdicts, ${(scenariosEvaluated ?? 0).toLocaleString("en-GB")} stress-test scenarios. Lowest-cost verified fix chosen each time. ${costSrc}.</text>`);
  ty += 30;
  const lg: [string, string][] = [
    ["url(#hatch)", "Changed area (numbered, see schedule)"],
    ["#2563eb", "New door"],
    ["#16a34a", "Escape route (engine-verified)"],
    ["#0891b2", "Step-free route"],
  ];
  lg.forEach(([c, t], k) => {
    const lx = tableX + k * 260;
    out.push(`<rect x="${lx}" y="${ty - 11}" width="22" height="12" fill="${c}" stroke="${c.startsWith("url") ? "#2563eb" : "none"}"/><text x="${lx + 30}" y="${ty}" font-size="11" fill="#374151">${t}</text>`);
  });
  ty += 26;
  out.push(`<text x="${tableX}" y="${ty}" font-size="10" fill="#9ca3af">For illustrative purposes only. Measurements are approximate and not to be used for construction. Connectivity study of a fictional building; not a fire-safety, evacuation-time or building-regulations assessment.</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

function wrap(text: string, n: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function plainScenario(name: string): string {
  return name.replace(/\(found by exhaustive sweep\)/, "").replace(/^Fire alarm: all lifts recalled$/, "in a fire alarm the lifts are recalled and some occupants cannot use stairs").replace(/^Fire blocks /, "if fire blocks the ").trim();
}

function floorArea(f: FloorPlan): number {
  // Shafts and new stairs are carved out of existing rooms, so they are not added again.
  return f.spaces.filter((s) => s.kind !== "void" && !(s.changeNo !== undefined && (s.kind === "core" || s.kind === "stair"))).reduce((s, sp) => s + rectArea(sp.rect), 0);
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
