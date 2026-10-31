import type { Building, Repair } from "@/contracts/types";

export type CostRates = {
  currency: "GBP";
  /** Where the rates came from. */
  source: "gemini-search" | "built-in";
  asOf: string;
  rates: {
    corridorPerMetre: number;
    doorOpening: number;
    stairsPerFlight: number;
    passengerLift: number;
    evacuationLift: number;
    rampPerMetre: number;
    clearObstruction: number;
    liftSecondaryPower: number;
    liftExtraStop: number;
  };
  sources: { title: string; url: string }[];
  notes?: string;
  model?: string;
};

export type RateKey = keyof CostRates["rates"];

/** Sanity bounds: a live rate outside these is discarded in favour of the default. */
export const RATE_BOUNDS: Record<RateKey, [number, number]> = {
  corridorPerMetre: [150, 4000],
  doorOpening: [400, 8000],
  stairsPerFlight: [8000, 150000],
  passengerLift: [25000, 250000],
  evacuationLift: [40000, 400000],
  rampPerMetre: [300, 6000],
  clearObstruction: [200, 15000],
  liftSecondaryPower: [5000, 120000],
  liftExtraStop: [3000, 60000],
};

/** Indicative placeholder rates used when no live pricing is available. Not a quotation. */
export const DEFAULT_RATES: CostRates = {
  currency: "GBP",
  source: "built-in",
  asOf: "indicative",
  rates: {
    corridorPerMetre: 460,
    doorOpening: 1500,
    stairsPerFlight: 30000,
    passengerLift: 70000,
    evacuationLift: 95000,
    rampPerMetre: 1200,
    clearObstruction: 2500,
    liftSecondaryPower: 25000,
    liftExtraStop: 12000,
  },
  sources: [],
  notes: "Built-in indicative rates for a hackathon demo. Not a quotation.",
};

export const RATE_LABELS: Record<RateKey, string> = {
  corridorPerMetre: "New internal corridor (per m)",
  doorOpening: "Form opening + fire door set",
  stairsPerFlight: "New staircase (per flight)",
  passengerLift: "Passenger lift (2 stops)",
  evacuationLift: "Evacuation lift (2 stops, secondary power)",
  rampPerMetre: "Ramp (per m)",
  clearObstruction: "Clear / re-hang obstructed door",
  liftSecondaryPower: "Upgrade lift: secondary power + evac controls",
  liftExtraStop: "Each extra lift stop / landing door",
};

export type CostLine = { label: string; qty: number; unit: string; rate: number; total: number };
export type CostEstimate = { total: number; lines: CostLine[]; source: CostRates["source"] };

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Prices a repair from the rate table, so cost never depends on what the AI claims. */
export function priceRepair(repair: Repair, building: Building, rates: CostRates = DEFAULT_RATES): CostEstimate {
  const r = rates.rates;
  const lines: CostLine[] = [];
  const line = (label: string, qty: number, unit: string, rate: number) => lines.push({ label, qty, unit, rate, total: qty * rate });

  if (repair.kind === "add_connection") {
    const c = repair.connection;
    const kind = c.kind ?? (c.stepFree ? "corridor" : "stairs");
    if (kind === "lift") line(c.evacuationLift ? RATE_LABELS.evacuationLift : RATE_LABELS.passengerLift, 1, "item", c.evacuationLift ? r.evacuationLift : r.passengerLift);
    else if (kind === "stairs") line(RATE_LABELS.stairsPerFlight, 1, "flight", r.stairsPerFlight);
    else if (kind === "ramp") line(RATE_LABELS.rampPerMetre, round1(c.length), "m", r.rampPerMetre);
    else line(RATE_LABELS.corridorPerMetre, round1(c.length), "m", r.corridorPerMetre);
    line(RATE_LABELS.doorOpening, 2, "nr", r.doorOpening);
  } else if (repair.kind === "add_connections") {
    const cs = repair.connections;
    if (cs.length && cs.every((c) => c.kind === "lift")) {
      // One lift serving several floors: one installation plus a landing per extra stop.
      const evac = cs.some((c) => c.evacuationLift);
      line(evac ? RATE_LABELS.evacuationLift : RATE_LABELS.passengerLift, 1, "item", evac ? r.evacuationLift : r.passengerLift);
      const stops = new Set(cs.flatMap((c) => [c.from, c.to])).size;
      if (stops > 2) line(RATE_LABELS.liftExtraStop, stops - 2, "nr", r.liftExtraStop);
    } else {
      for (const c of cs) {
        const sub = priceRepair({ kind: "add_connection", connection: c, cost: 0 }, building, rates);
        for (const l of sub.lines) line(`${c.id}: ${l.label}`, l.qty, l.unit, l.rate);
      }
    }
  } else {
    const c = building.connections.find((x) => x.id === repair.connectionId);
    if (c?.kind === "lift") line(RATE_LABELS.liftSecondaryPower, 1, "item", r.liftSecondaryPower);
    else line(RATE_LABELS.clearObstruction, 1, "item", r.clearObstruction);
  }
  return { total: round100(lines.reduce((s, l) => s + l.total, 0)), lines, source: rates.source };
}

/** Returns a copy of the repair whose cost is the modelled cost. */
export function withModelledCost(repair: Repair, building: Building, rates: CostRates): { repair: Repair; estimate: CostEstimate } {
  const estimate = priceRepair(repair, building, rates);
  const priced: Repair =
    repair.kind === "add_connection" ? { ...repair, cost: estimate.total, connection: { ...repair.connection, costToAdd: estimate.total } } : { ...repair, cost: estimate.total };
  return { repair: priced, estimate };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Validates live rates; out-of-range values fall back to defaults. */
export function sanitiseRates(raw: Partial<Record<RateKey, unknown>>): { rates: CostRates["rates"]; replaced: RateKey[] } {
  const replaced: RateKey[] = [];
  const out = { ...DEFAULT_RATES.rates };
  for (const k of Object.keys(RATE_BOUNDS) as RateKey[]) {
    const v = Number(raw[k]);
    const [lo, hi] = RATE_BOUNDS[k];
    if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = Math.round(v);
    else replaced.push(k);
  }
  return { rates: out, replaced };
}
