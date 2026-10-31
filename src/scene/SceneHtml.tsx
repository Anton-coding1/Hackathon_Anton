"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type Props = {
  position?: [number, number, number] | THREE.Vector3;
  center?: boolean;
  zIndexRange?: [number, number];
  pointerEvents?: "auto" | "none";
  children?: ReactNode;
};

/**
 * Minimal replacement for drei's <Html>: a DOM label pinned to a 3D point.
 * drei unmounts each label's React root synchronously inside the R3F commit,
 * which React 19 reports as "Attempted to synchronously unmount a root while
 * React was already rendering". Here the unmount is deferred to a macrotask.
 */
export function Html({ position = [0, 0, 0], center = false, zIndexRange = [100, 0], pointerEvents = "auto", children }: Props) {
  const { gl, camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const [el] = useState(() => document.createElement("div"));
  const root = useRef<Root | null>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    const target = gl.domElement.parentNode as HTMLElement | null;
    el.style.cssText = `position:absolute;top:0;left:0;will-change:transform;pointer-events:${pointerEvents};`;
    target?.appendChild(el);
    const r = createRoot(el);
    root.current = r;
    return () => {
      root.current = null;
      el.remove();
      setTimeout(() => r.unmount(), 0);
    };
  }, [el, gl, pointerEvents]);

  useLayoutEffect(() => {
    root.current?.render(<div style={center ? { transform: "translate(-50%, -50%)" } : undefined}>{children}</div>);
  });

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    world.setFromMatrixPosition(g.matrixWorld);
    ndc.copy(world).project(camera);
    const visible = ndc.z < 1 && ndc.z > -1;
    if (!visible) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    const x = (ndc.x * 0.5 + 0.5) * size.width;
    const y = (-ndc.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const d = Math.min(1, camera.position.distanceTo(world) / 200);
    el.style.zIndex = String(Math.round(zIndexRange[1] + (zIndexRange[0] - zIndexRange[1]) * (1 - d)));
  });

  const p = position instanceof THREE.Vector3 ? position : new THREE.Vector3(...position);
  return <group ref={group} position={p} />;
}
