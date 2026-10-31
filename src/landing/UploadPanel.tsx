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

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/heic", "image/heif", "application/pdf"];
const MAX_SIDE = 2400;

/** Normalises any browser-readable image (incl. SVG and huge scans) to a ≤2400 px PNG/JPEG for Gemini. */
async function normaliseImage(file: File): Promise<{ data: string; mimeType: string }> {
  const passThrough = file.type === "application/pdf" || file.type === "image/heic" || file.type === "image/heif";
  if (!passThrough) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode"));
        i.src = url;
      });
      const w0 = img.naturalWidth || 1600;
      const h0 = img.naturalHeight || 1200;
      const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w0 * k);
      canvas.height = Math.round(h0 * k);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const jpeg = file.type === "image/jpeg";
      const out = canvas.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.9);
      return { data: out.split(",")[1] ?? "", mimeType: jpeg ? "image/jpeg" : "image/png" };
    } catch {
      /* fall through and send the original */
    }
  }
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
  return { data, mimeType: file.type };
}

/** Upload a building JSON, or a floor-plan image/PDF that Gemini reads into a graph. */
export function UploadPanel() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
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
      const type = file.type || (/\.(heic|heif)$/i.test(file.name) ? "image/heic" : /\.svg$/i.test(file.name) ? "image/svg+xml" : "");
      if (!IMAGE_TYPES.includes(type)) throw new Error("Use a floor plan image (PNG, JPEG, WebP, HEIC, SVG), a PDF, or an ExitZero .json file.");
      if (file.size > 25 * 1024 * 1024) throw new Error("File too large (max 25 MB).");
      const img = await normaliseImage(new File([file], file.name, { type }));
      if (img.data.length * 0.75 > 8 * 1024 * 1024) throw new Error("That PDF is too large to send (max 8 MB). Export just the floor-plan pages.");
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(img) });
      const j = await res.json().catch(() => ({ success: false, error: "The server could not read that file." }));
      if (!j.success) throw new Error(j.error ?? "Gemini could not read the plan.");
      setNotes([j.meta?.planStyle ? `Read as: ${j.meta.planStyle}` : "", ...(j.meta?.notes ?? [])].filter(Boolean));
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
        <input ref={input} type="file" accept=".json,application/json,image/*,.heic,.heif,.svg,application/pdf" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
        <div className="drop-icon">⇪</div>
        <b>Drop a floor plan or building file</b>
        <span>Any floor plan: estate-agent, CAD export, fire plan, scan or phone photo · PNG, JPEG, HEIC, SVG, PDF · or ExitZero JSON</span>
      </div>

      {state.kind === "reading" && <p className="upload-msg">Reading {state.name}… Gemini 4 Argon is tracing rooms, doors, stairs and lifts, and checking it really is a floor plan.</p>}
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
          {notes.length > 0 && <span className="upload-notes">{notes.join(" · ")}</span>}
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
