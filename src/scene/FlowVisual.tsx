"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { COLORS, Polyline } from "./sceneUtils";

export type FlowStream = {
  occupantId: string;
  label: string;
  stepFree: boolean;
  /** Drawn route from the engine, or null if the occupant has no route. */
  points: THREE.Vector3[] | null;
  start: THREE.Vector3;
  /** Rectangle (plan) of the start room, used to mill stranded particles around inside it. */
  room?: [number, number, number, number];
};

const PER_STREAM = 900;
const SPEED = 2.6; // m/s

/**
 * Thousands of particles streaming along each engine route (a flow visualisation,
 * not a crowd simulation). Stranded streams circulate in their start room in red.
 */
export function FlowVisual({ streams, showLabels }: { streams: FlowStream[]; showLabels: boolean }) {
  const count = streams.length * PER_STREAM;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const polys = useMemo(() => streams.map((s) => (s.points && s.points.length > 1 ? new Polyline(s.points) : null)), [streams]);
  const seeds = useMemo(() => {
    const rnd = mulberry(42);
    return Array.from({ length: count }, () => ({ phase: rnd(), lane: (rnd() - 0.5) * 1.1, speed: 0.75 + rnd() * 0.5, wob: rnd() * 6.28, r: rnd() }));
  }, [count]);
  const born = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    born.current = performance.now() / 1000;
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    streams.forEach((s, si) => {
      const base = s.points ? (s.stepFree ? COLORS.routeSF : COLORS.route) : COLORS.blocked;
      for (let i = 0; i < PER_STREAM; i++) {
        c.set(base).offsetHSL(0, 0, (seeds[si * PER_STREAM + i].r - 0.5) * 0.12);
        m.setColorAt(si * PER_STREAM + i, c);
      }
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [streams, seeds]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const age = performance.now() / 1000 - born.current;
    streams.forEach((s, si) => {
      const poly = polys[si];
      for (let i = 0; i < PER_STREAM; i++) {
        const k = si * PER_STREAM + i;
        const sd = seeds[k];
        if (poly && poly.length > 0) {
          const u = (sd.phase + (t * SPEED * sd.speed) / poly.length) % 1;
          // Release particles progressively when a route first appears.
          const released = sd.phase < age * 0.6;
          poly.sample(u, p, n);
          p.addScaledVector(n, sd.lane);
          p.y += 0.16;
          const fadeOut = u > 0.97 ? (1 - u) / 0.03 : 1;
          dummy.scale.setScalar(released ? 0.9 * fadeOut + 0.05 : 0.0001);
        } else if (s.room) {
          const [x0, z0, x1, z1] = s.room;
          const cx = (x0 + x1) / 2;
          const cz = (z0 + z1) / 2;
          const rx = (x1 - x0) / 2 - 0.4;
          const rz = (z1 - z0) / 2 - 0.4;
          const ang = sd.wob + t * (0.25 + sd.speed * 0.3) * (sd.r > 0.5 ? 1 : -1);
          const rad = 0.25 + 0.75 * Math.sqrt(sd.phase);
          p.set(cx + Math.cos(ang) * rx * rad, s.start.y + 0.16, cz + Math.sin(ang) * rz * rad);
          dummy.scale.setScalar(0.9);
        } else {
          const ang = sd.wob + t * 0.6;
          p.set(s.start.x + Math.cos(ang) * 1.5 * sd.phase, s.start.y + 0.16, s.start.z + Math.sin(ang) * 1.5 * sd.phase);
          dummy.scale.setScalar(0.9);
        }
        dummy.position.copy(p);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, Math.max(1, count)]} frustumCulled={false} castShadow>
        <sphereGeometry args={[0.1, 8, 6]} />
        <meshStandardMaterial roughness={0.35} metalness={0} emissive="#ffffff" emissiveIntensity={0.08} />
      </instancedMesh>
      {showLabels &&
        streams.map((s) => (
          <Html key={s.occupantId} position={[s.start.x, s.start.y + 2.9, s.start.z]} center zIndexRange={[50, 40]} pointerEvents="none">
            <div className={`p-occ ${s.points ? (s.stepFree ? "is-sf" : "") : "is-alert"}`}>
              <b>{s.occupantId}</b> {s.label}
              {s.stepFree ? <i>step-free</i> : null}
              {s.points ? null : <em>no route</em>}
            </div>
          </Html>
        ))}
    </group>
  );
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
