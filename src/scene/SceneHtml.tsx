"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
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
 * Each mount gets its own container and React root, and roots are unmounted
 * after the current render (drei's synchronous unmount trips React 19).
 */
export function Html({ position = [0, 0, 0], center = false, zIndexRange = [100, 0], pointerEvents = "auto", children }: Props) {
  const { gl, camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const el = useRef<HTMLDivElement | null>(null);
  const root = useRef<Root | null>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector3(), []);
  const latest = useRef<ReactNode>(null);
  latest.current = <div style={center ? { transform: "translate(-50%, -50%)" } : undefined}>{children}</div>;

  useLayoutEffect(() => {
    const target = gl.domElement.parentNode as HTMLElement | null;
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;top:0;left:0;will-change:transform;display:none;pointer-events:${pointerEvents};`;
    target?.appendChild(div);
    const r = createRoot(div);
    r.render(latest.current);
    el.current = div;
    root.current = r;
    return () => {
      el.current = null;
      root.current = null;
      div.remove();
      setTimeout(() => r.unmount(), 0);
    };
  }, [gl, pointerEvents]);

  useLayoutEffect(() => {
    root.current?.render(latest.current);
  });

  useFrame(() => {
    const g = group.current;
    const div = el.current;
    if (!g || !div) return;
    g.updateWorldMatrix(true, false);
    world.setFromMatrixPosition(g.matrixWorld);
    ndc.copy(world).project(camera);
    if (ndc.z >= 1 || ndc.z <= -1) {
      div.style.display = "none";
      return;
    }
    div.style.display = "block";
    const x = (ndc.x * 0.5 + 0.5) * size.width;
    const y = (-ndc.y * 0.5 + 0.5) * size.height;
    div.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const d = Math.min(1, camera.position.distanceTo(world) / 200);
    div.style.zIndex = String(Math.round(zIndexRange[1] + (zIndexRange[0] - zIndexRange[1]) * (1 - d)));
  });

  const p = position instanceof THREE.Vector3 ? position : new THREE.Vector3(...position);
  return <group ref={group} position={p} />;
}
