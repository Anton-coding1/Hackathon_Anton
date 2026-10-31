"use client";

import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { Html } from "./SceneHtml";
import type { Connection } from "@/contracts/types";
import { COLORS, Polyline, stateColor, type ConnectionState } from "./sceneUtils";

const X = new THREE.Vector3(1, 0, 0);
const LIFT = 0.04;

type Props = {
  connection: Connection;
  points: THREE.Vector3[];
  state: ConnectionState;
  isNew: boolean;
  showLabel: boolean;
  heat?: number;
  onClick?: (id: string) => void;
  onHover?: (id: string | null) => void;
};

function segments(points: THREE.Vector3[]) {
  const out: { a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3; len: number; quat: THREE.Quaternion; sloped: boolean }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = a.distanceTo(b);
    if (len < 1e-3) continue;
    const dir = b.clone().sub(a).normalize();
    out.push({ a, b, mid: a.clone().add(b).multiplyScalar(0.5), len, quat: new THREE.Quaternion().setFromUnitVectors(X, dir), sloped: Math.abs(a.y - b.y) > 0.3 });
  }
  return out;
}

/** A connection drawn as a lane on the floor (plus stair treads where it changes level). */
export function ConnectionVisual({ connection, points, state, isNew, showLabel, onClick, onHover }: Props) {
  const segs = useMemo(() => segments(points), [points]);
  const poly = useMemo(() => new Polyline(points), [points]);
  const mid = useMemo(() => {
    // Label/barrier on the longest flat segment so it sits on a floor, not mid-air.
    const flat = segs.filter((s) => !s.sloped).sort((p, q) => q.len - p.len)[0] ?? segs[0];
    return flat ? flat.mid.clone() : poly.midpoint();
  }, [segs, poly]);
  const laneMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const target = useMemo(() => new THREE.Color(), []);
  const barrier = useRef<THREE.Group>(null);
  laneMats.current = [];
  const reg = (m: THREE.MeshStandardMaterial | null) => {
    if (m && !laneMats.current.includes(m)) laneMats.current.push(m);
  };

  useFrame(({ clock }, dt) => {
    const k = 1 - Math.exp(-dt * 8);
    target.set(stateColor(state));
    for (const m of laneMats.current) {
      m.color.lerp(target, k);
      const op = state === "normal" ? 0.5 : 0.9;
      m.opacity = THREE.MathUtils.lerp(m.opacity, op, k);
      m.emissive.copy(m.color);
      m.emissiveIntensity = state === "blocked" ? 0.25 + 0.25 * Math.sin(clock.elapsedTime * 5) : state === "normal" ? 0 : 0.18;
    }
    if (barrier.current) {
      const s = state === "blocked" ? 1 : 0.0001;
      barrier.current.scale.lerp(new THREE.Vector3(s, s, s), 1 - Math.exp(-dt * 10));
    }
  });

  if (segs.length === 0) return null;
  const width = state === "normal" ? 0.3 : state === "route" ? 0.8 : 0.7;

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick?.(connection.id);
  };
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onHover?.(connection.id);
    if (onClick) document.body.style.cursor = "pointer";
  };
  const out = () => {
    onHover?.(null);
    document.body.style.cursor = "";
  };

  // Barrier orientation follows the lane at the label point.
  const flatSeg = segs.filter((s) => !s.sloped).sort((p, q) => q.len - p.len)[0] ?? segs[0];
  const yaw = Math.atan2(-(flatSeg.b.z - flatSeg.a.z), flatSeg.b.x - flatSeg.a.x);

  return (
    <group>
      {segs.map((s, i) => (
        <group key={i}>
          {s.sloped && connection.kind !== "lift" && <StairFlight a={s.a} b={s.b} />}
          {s.sloped && connection.kind === "lift" && <LiftShaft a={s.a} b={s.b} state={state} evac={!!connection.evacuationLift} />}
          <mesh visible={!(s.sloped && connection.kind === "lift")} position={[s.mid.x, s.mid.y + (s.sloped ? 0.22 : LIFT), s.mid.z]} quaternion={s.quat} receiveShadow>
            <boxGeometry args={[s.len + (s.sloped ? 0 : 0.3), 0.03, width]} />
            <meshStandardMaterial ref={reg} color={COLORS.lane} transparent opacity={0.55} roughness={0.6} depthWrite={false} />
          </mesh>
          {/* hit volume */}
          <mesh position={[s.mid.x, s.mid.y + 0.6, s.mid.z]} quaternion={s.quat} onClick={click} onPointerOver={over} onPointerOut={out}>
            <boxGeometry args={[s.len, 1.2, 1.6]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        </group>
      ))}

      {isNew && <FlowDashes points={points.map((p) => p.clone().setY(p.y + 0.09))} color={COLORS.added} />}

      <group ref={barrier} position={[mid.x, mid.y, mid.z]} rotation-y={yaw + Math.PI / 2} scale={0.0001}>
        <Barrier />
      </group>

      {showLabel && (
        <Html position={[mid.x, mid.y + (state === "blocked" ? 2.1 : 0.7), mid.z]} center zIndexRange={[30, 20]}>
          <button
            className={`p-chip is-${state}${isNew ? " is-new" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(connection.id);
            }}
            onPointerEnter={() => onHover?.(connection.id)}
            onPointerLeave={() => onHover?.(null)}
            title={`${connection.id}: ${connection.from} ↔ ${connection.to}, ${connection.length} m, ${connection.stepFree ? "step-free" : "stairs"}. Click to ${state === "blocked" ? "reopen" : "block"}.`}
          >
            <b>{connection.id}</b>
            {connection.kind === "lift" ? (
              <span>{state === "blocked" ? "lift recalled" : connection.evacuationLift ? "evac lift" : "lift"}</span>
            ) : state === "blocked" ? (
              <span>blocked</span>
            ) : !connection.stepFree ? (
              <span>stairs</span>
            ) : isNew ? (
              <span>new</span>
            ) : null}
          </button>
        </Html>
      )}
    </group>
  );
}

/** Straight flight of treads between two points at different heights. */
function StairFlight({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const lo = a.y < b.y ? a : b;
  const hi = a.y < b.y ? b : a;
  const rise = hi.y - lo.y;
  const flat = new THREE.Vector3(hi.x - lo.x, 0, hi.z - lo.z);
  const run = flat.length();
  const dir = flat.normalize();
  const n = Math.max(10, Math.round(rise / 0.3));
  const yaw = Math.atan2(-dir.z, dir.x);
  const width = 1.5;
  const stringerLen = Math.hypot(run, rise);
  const stringerQuat = new THREE.Quaternion().setFromUnitVectors(X, hi.clone().sub(lo).normalize());
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2 + 0.05);
  const mid = lo.clone().add(hi).multiplyScalar(0.5);
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const p = lo.clone().addScaledVector(dir, (run * (i + 0.5)) / n);
        p.y = lo.y + (rise * (i + 1)) / n - 0.06;
        return (
          <group key={i} position={p} rotation-y={yaw}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[run / n + 0.02, 0.1, width]} />
              <meshStandardMaterial color={COLORS.tread} roughness={0.8} />
            </mesh>
            <mesh position={[-(run / n) / 2, 0.03, 0]}>
              <boxGeometry args={[0.04, 0.05, width]} />
              <meshStandardMaterial color={COLORS.nosing} roughness={0.6} />
            </mesh>
          </group>
        );
      })}
      {[1, -1].map((s) => (
        <mesh key={s} position={mid.clone().addScaledVector(side, s).setY(mid.y - 0.1)} quaternion={stringerQuat} castShadow>
          <boxGeometry args={[stringerLen, 0.28, 0.06]} />
          <meshStandardMaterial color="#c4cad3" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {[1, -1].map((s) => (
        <mesh key={`r${s}`} position={mid.clone().addScaledVector(side, s).setY(mid.y + 0.9)} quaternion={stringerQuat}>
          <boxGeometry args={[stringerLen, 0.04, 0.04]} />
          <meshStandardMaterial color="#8b95a3" roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Glass lift shaft with a car that runs while the lift is in use. */
function LiftShaft({ a, b, state, evac }: { a: THREE.Vector3; b: THREE.Vector3; state: ConnectionState; evac: boolean }) {
  const lo = a.y < b.y ? a : b;
  const hi = a.y < b.y ? b : a;
  const h = hi.y - lo.y + 2.2;
  const car = useRef<THREE.Mesh>(null);
  const carMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!car.current || !carMat.current) return;
    const t = clock.elapsedTime;
    const moving = state === "route";
    const y = moving ? lo.y + 1.1 + ((Math.sin(t * 0.8) + 1) / 2) * (hi.y - lo.y) : lo.y + 1.1;
    car.current.position.y += (y - car.current.position.y) * 0.1;
    carMat.current.color.set(state === "blocked" ? COLORS.blocked : evac ? COLORS.exit : "#d0d5dd");
  });
  const frame = state === "blocked" ? COLORS.blocked : evac ? COLORS.exit : "#98a2b3";
  const w = 1.7;
  return (
    <group position={[hi.x, 0, hi.z]}>
      <mesh position={[0, lo.y + h / 2 - 0.1, 0]}>
        <boxGeometry args={[w, h, w]} />
        <meshPhysicalMaterial color="#cfe0ee" transparent opacity={0.28} roughness={0.05} depthWrite={false} />
      </mesh>
      {[
        [-w / 2, -w / 2],
        [w / 2, -w / 2],
        [-w / 2, w / 2],
        [w / 2, w / 2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, lo.y + h / 2 - 0.1, z]} castShadow>
          <boxGeometry args={[0.08, h, 0.08]} />
          <meshStandardMaterial color={frame} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
      <mesh ref={car} position={[0, lo.y + 1.1, 0]} castShadow>
        <boxGeometry args={[w - 0.25, 2, w - 0.25]} />
        <meshStandardMaterial ref={carMat} color="#d0d5dd" metalness={0.5} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** Red/white site barrier marking a blocked link. */
function Barrier() {
  const stripes = 6;
  return (
    <group>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.45, 0]} castShadow>
          <boxGeometry args={[0.08, 0.9, 0.08]} />
          <meshStandardMaterial color="#3f4652" />
        </mesh>
      ))}
      {Array.from({ length: stripes }, (_, i) => (
        <mesh key={i} position={[-0.85 + (1.7 * (i + 0.5)) / stripes, 0.78, 0]} castShadow>
          <boxGeometry args={[1.7 / stripes, 0.18, 0.06]} />
          <meshStandardMaterial color={i % 2 ? "#ffffff" : COLORS.blocked} roughness={0.5} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.0, 1.15, 40]} />
        <meshBasicMaterial color={COLORS.blocked} transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FlowDashes({ points, color }: { points: THREE.Vector3[]; color: string }) {
  const line = useRef<THREE.Object3D>(null);
  useFrame((_, dt) => {
    const mat = (line.current as unknown as { material?: { dashOffset: number } })?.material;
    if (mat) mat.dashOffset -= dt * 1.4;
  });
  return <Line ref={line as never} points={points} color={color} lineWidth={3} dashed dashSize={0.45} gapSize={0.3} />;
}

/** Ghost of a repair the defender proposed but the judge has not accepted. */
export function ProposalVisual({ connection, points, status }: { connection: Connection; points: THREE.Vector3[]; status: "pending" | "rejected" | "accepted" }) {
  const line = useRef<THREE.Object3D>(null);
  const slab = useRef<THREE.MeshStandardMaterial>(null);
  const segs = useMemo(() => segments(points), [points]);
  const poly = useMemo(() => new Polyline(points), [points]);
  useFrame(({ clock }, dt) => {
    const mat = (line.current as unknown as { material?: { dashOffset: number; opacity: number } })?.material;
    const t = clock.elapsedTime;
    if (mat) {
      mat.dashOffset -= dt * 2;
      mat.opacity = status === "rejected" ? 0.4 + 0.6 * Math.abs(Math.sin(t * 7)) : 0.7 + 0.3 * Math.sin(t * 3);
    }
    if (slab.current) slab.current.opacity = status === "rejected" ? 0.18 + 0.15 * Math.abs(Math.sin(t * 7)) : 0.22 + 0.08 * Math.sin(t * 3);
  });
  if (segs.length === 0) return null;
  const color = status === "rejected" ? COLORS.blocked : COLORS.added;
  const mid = poly.midpoint();
  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.mid.x, s.mid.y + 0.06, s.mid.z]} quaternion={s.quat}>
          <boxGeometry args={[s.len, 0.04, 2.2]} />
          <meshStandardMaterial ref={i === 0 ? slab : undefined} color={color} transparent opacity={0.25} depthWrite={false} />
        </mesh>
      ))}
      <Line ref={line as never} points={points.map((p) => p.clone().setY(p.y + 0.12))} color={color} lineWidth={4} dashed dashSize={0.3} gapSize={0.2} transparent />
      <Html position={[mid.x, mid.y + 1.6, mid.z]} center zIndexRange={[40, 30]} pointerEvents="none">
        <div className={`p-proposal is-${status}`}>
          {status === "rejected" ? "✕ Rejected" : "Proposed"} · {connection.id}
        </div>
      </Html>
    </group>
  );
}
