"use client";

import { useRef, useState } from "react";
import type { Building } from "@/contracts/types";
import { CUSTOM_STORAGE_KEY, PRESETS } from "@/data/buildings";
import { buildingIssues } from "@/engine";

type State =
  | { kind: "idle" }
  | { kind: "reading"; name: string }
  | { kind: "ok"; building: Building; source: "json" | "gemini" }
  | { kind: "error"; message: string };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

/** Upload a building JSON, or a floor-plan image/PDF that Gemini reads into a graph. */
export function UploadPanel() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const accept = (b: Building, source: "json" | "gemini") => {
    const issues = buildingIssues(b);
    if (issues.length) {
      setState({ kind: "error", message: `That building isn't a valid graph: ${issues.slice(0, 3).join(" ")}` });
      return;
    }
    try {
      sessionStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(b));
    } catch {
      /* storage may be blocked; the lab will say so */
    }
    setState({ kind: "ok", building: b, source });
  };

  const handle = async (file: File) => {
    setState({ kind: "reading", name: file.name });
    try {
      if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
        const parsed = JSON.parse(await file.text());
        accept((parsed.building ?? parsed) as Building, "json");
        return;
      }
      if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a .json building file, or a PNG, JPEG, WebP or PDF floor plan.");
      if (file.size > 8 * 1024 * 1024) throw new Error("File too large (max 8 MB).");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, mimeType: file.type }) });
      const j = await res.json();
      if (!j.success) throw new Error(j.error ?? "Gemini could not read the plan.");
      accept(j.data as Building, "gemini");
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const template = () => {
    const blob = new Blob([JSON.stringify({ building: PRESETS.industrial.building }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "exitzero-building-template.json";
    a.click();
  };

  return (
    <div className="upload">
      <div
        className={`drop ${drag ? "is-drag" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) handle(f);
        }}
        role="button"
        tabIndex={0}
      >
        <input ref={input} type="file" accept=".json,application/json,image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
        <div className="drop-icon">⇪</div>
        <b>Drop a floor plan or building file</b>
        <span>PNG, JPEG or PDF floor plan (read by Gemini) · or ExitZero JSON</span>
      </div>

      {state.kind === "reading" && <p className="upload-msg">Reading {state.name}… Gemini is tracing rooms, doors, stairs and lifts.</p>}
      {state.kind === "error" && <p className="upload-msg is-bad">{state.message}</p>}
      {state.kind === "ok" && (
        <div className="upload-ok">
          <div>
            <b>{state.building.name}</b>
            <span>
              {state.building.nodes.length} spaces · {state.building.connections.length} connections ·{" "}
              {state.building.connections.filter((c) => c.kind === "lift").length} lifts · {new Set(state.building.nodes.map((n) => n.floor)).size} floor(s) ·{" "}
              {state.building.occupants.length} occupants {state.source === "gemini" ? "· extracted by Gemini, check before relying on it" : ""}
            </span>
          </div>
          <a className="l-btn l-btn-primary" href="/lab?b=custom">
            Analyse in the lab →
          </a>
        </div>
      )}
      <button className="l-link" onClick={template}>
        Download the JSON template
      </button>
    </div>
  );
}
