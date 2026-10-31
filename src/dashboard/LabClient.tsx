"use client";

import { useEffect, useState } from "react";
import type { Building } from "@/contracts/types";
import { CUSTOM_STORAGE_KEY, customPreset, PRESETS, type BuildingPreset } from "@/data/buildings";
import { buildingIssues } from "@/engine";
import { Dashboard } from "./Dashboard";

export function LabClient({ presetId, autoplay }: { presetId: string; autoplay: boolean }) {
  const [preset, setPreset] = useState<BuildingPreset | null>(presetId === "custom" ? null : (PRESETS[presetId as keyof typeof PRESETS] ?? PRESETS.tower));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presetId !== "custom") return;
    try {
      const raw = sessionStorage.getItem(CUSTOM_STORAGE_KEY);
      if (!raw) throw new Error("No uploaded building found in this browser session.");
      const b = JSON.parse(raw) as Building;
      const issues = buildingIssues(b);
      if (issues.length) throw new Error(issues.slice(0, 3).join(" "));
      setPreset(customPreset(b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [presetId]);

  if (error)
    return (
      <div className="lab-error">
        <h2>Couldn’t open your building</h2>
        <p>{error}</p>
        <a className="btn btn-primary" href="/#upload" style={{ width: "auto" }}>
          Upload again
        </a>
      </div>
    );
  if (!preset) return <div className="lab-error">Loading…</div>;
  return <Dashboard key={preset.id + preset.building.id} preset={preset} autoplay={autoplay} />;
}
