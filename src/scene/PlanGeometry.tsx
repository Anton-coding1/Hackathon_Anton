"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Building } from "@/contracts/types";
import { rectArea, type BuildingPlan, type FloorPlan, type Opening } from "@/data/demoPlan";
import { buildWalls, type Wall } from "@/data/planWalls";
import { COLORS, FLOOR_FINISH, levelY } from "./sceneUtils";

type Props = {
  plan: BuildingPlan;
  building: Building;
  exploded: boolean;
  strandedNodeIds: Set<string>;
  showLabels: boolean;
};

const SLAB = 0.32;
const WALL_T = 0.14;
const EXT_T = 0.3;

/** Architectural model of every floor: slab with voids, finishes, walls with door gaps, glazing and exits. */
export function PlanGeometry({ plan, building, exploded, strandedNodeIds, showLabels }: Props) {
  const connectionIds = useMemo(() => new Set(building.connections.map((c) => c.id)), [building]);
  return (
    <group>
      {plan.floors.map((f) => (
        <Floor
          key={f.floor}
          floor={f}
          y={levelY(f.floor, exploded)}
          wallHeight={plan.wallHeight}
          activeConnections={connectionIds}
          strandedNodeIds={strandedNodeIds}
          showLabels={showLabels}
          exploded={exploded}
        />
      ))}
    </group>
  );
}

function Floor({
  floor,
  y,
  wallHeight,
  activeConnections,
  strandedNodeIds,
  showLabels,
  exploded,
}: {
  floor: FloorPlan;
  y: number;
  wallHeight: number;
  activeConnections: Set<string>;
  strandedNodeIds: Set<string>;
  showLabels: boolean;
  exploded: boolean;
}) {
  const slab = useMemo(() => slabGeometry(floor), [floor]);
  const walls = useMemo(() => buildWalls(floor, activeConnections), [floor, activeConnections]);
  const [fx0, fz0, , fz1] = floor.footprint;

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={slab} castShadow receiveShadow>
        <meshStandardMaterial color={COLORS.slab} roughness={0.9} metalness={0} />
      </mesh>
      {/* slab edge band */}
      {floor.spaces
        .filter((s) => s.kind !== "void")
        .map((s) => {
          const [x0, z0, x1, z1] = s.rect;
          const alert = s.nodeId && strandedNodeIds.has(s.nodeId);
          return (
            <mesh key={s.id} position={[(x0 + x1) / 2, 0.012, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow>
              <planeGeometry args={[x1 - x0 - 0.04, z1 - z0 - 0.04]} />
              <meshStandardMaterial
                color={alert ? "#fde2e1" : FLOOR_FINISH[s.kind]}
                roughness={0.85}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          );
        })}
      {walls.map((w, i) => (
        <WallPiece key={i} w={w} height={wallHeight} />
      ))}
      {floor.voids.map(([x0, z0, x1, z1], i) => (
        <Balustrade key={i} rect={[x0, z0, x1, z1]} />
      ))}
      {floor.openings
        .filter((o) => o.kind === "exit")
        .map((o, i) => (
          <ExitDoor key={i} o={o} height={wallHeight} />
        ))}
      {showLabels &&
        floor.spaces
          .filter((s) => s.kind !== "void" && s.kind !== "stair")
          .map((s) => {
            const [x0, z0, x1, z1] = s.rect;
            const big = !!s.nodeId;
            const alert = s.nodeId && strandedNodeIds.has(s.nodeId);
            return (
              <Html key={s.id} position={[(x0 + x1) / 2, 0.05, (z0 + z1) / 2 + (big ? 1.2 : 0)]} center zIndexRange={[5, 0]} pointerEvents="none">
                <div className={`p-room ${big ? "is-node" : ""} ${alert ? "is-alert" : ""}`}>
                  <b>{s.name}</b>
                  <span>
                    {s.nodeId ? `${s.nodeId} · ` : ""}
                    {Math.round(rectArea(s.rect))} m²
                  </span>
                </div>
              </Html>
            );
          })}
      {showLabels && (
        <Html position={[fx0 - 0.4, 0, fz1 + 0.6]} zIndexRange={[5, 0]} pointerEvents="none">
          <div className="p-level">
            {floor.name.toUpperCase()}
            <span>{exploded && floor.floor > 0 ? " · exploded view" : ""}</span>
          </div>
        </Html>
      )}
      {/* invisible marker to keep footprint origin referenced */}
      <group position={[fx0, 0, fz0]} />
    </group>
  );
}

function slabGeometry(floor: FloorPlan): THREE.BufferGeometry {
  const [x0, z0, x1, z1] = floor.footprint;
  const shape = new THREE.Shape();
  shape.moveTo(x0, z0);
  shape.lineTo(x1, z0);
  shape.lineTo(x1, z1);
  shape.lineTo(x0, z1);
  shape.closePath();
  for (const [vx0, vz0, vx1, vz1] of floor.voids) {
    const h = new THREE.Path();
    h.moveTo(vx0, vz0);
    h.lineTo(vx0, vz1);
    h.lineTo(vx1, vz1);
    h.lineTo(vx1, vz0);
    h.closePath();
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
  // Shape lives in XY with z = plan z; rotate so extrusion points down and plan z maps to world z.
  g.rotateX(Math.PI / 2);
  return g;
}

function WallPiece({ w, height }: { w: Wall; height: number }) {
  const len = w.to - w.from;
  const mid = (w.from + w.to) / 2;
  const t = w.exterior ? EXT_T : WALL_T;
  const pos = (cy: number): [number, number, number] => (w.axis === "x" ? [mid, cy, w.at] : [w.at, cy, mid]);
  const size = (l: number, h: number): [number, number, number] => (w.axis === "x" ? [l, h, t] : [t, h, l]);

  if (!w.exterior || len < 2.2) {
    return (
      <mesh position={pos(height / 2)} castShadow receiveShadow>
        <boxGeometry args={size(len + (w.exterior ? t : WALL_T * 0.5), height)} />
        <meshStandardMaterial color={w.exterior ? COLORS.wallExt : COLORS.wall} roughness={0.9} />
      </mesh>
    );
  }
  // Exterior wall with a ribbon window: sill, glazing, head.
  const sill = 0.75;
  const head = height - 0.12;
  return (
    <group>
      <mesh position={pos(sill / 2)} castShadow receiveShadow>
        <boxGeometry args={size(len + t, sill)} />
        <meshStandardMaterial color={COLORS.wallExt} roughness={0.9} />
      </mesh>
      <mesh position={pos((head + height) / 2)} castShadow>
        <boxGeometry args={size(len + t, height - head)} />
        <meshStandardMaterial color={COLORS.wallExt} roughness={0.9} />
      </mesh>
      <mesh position={pos((sill + head) / 2)}>
        <boxGeometry args={size(len, head - sill)} />
        <meshPhysicalMaterial color={COLORS.glass} roughness={0.08} metalness={0.1} transparent opacity={0.38} depthWrite={false} />
      </mesh>
      {Array.from({ length: Math.floor(len / 1.8) + 1 }, (_, i) => {
        const along = w.from + (i * len) / Math.floor(len / 1.8 || 1);
        const p: [number, number, number] = w.axis === "x" ? [along, (sill + head) / 2, w.at] : [w.at, (sill + head) / 2, along];
        return (
          <mesh key={i} position={p} castShadow>
            <boxGeometry args={w.axis === "x" ? [0.07, head - sill, t * 0.7] : [t * 0.7, head - sill, 0.07]} />
            <meshStandardMaterial color="#c9ced6" roughness={0.5} metalness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Balustrade({ rect }: { rect: [number, number, number, number] }) {
  const [x0, z0, x1, z1] = rect;
  const h = 1.05;
  const segs: [number, number, number, number][] = [
    [x0, z0, x1, z0],
    [x0, z1, x1, z1],
    [x1, z0, x1, z1],
  ];
  return (
    <group>
      {segs.map(([a, b, c, d], i) => {
        const horiz = Math.abs(b - d) < 1e-6;
        const len = horiz ? Math.abs(c - a) : Math.abs(d - b);
        return (
          <mesh key={i} position={[(a + c) / 2, h / 2, (b + d) / 2]}>
            <boxGeometry args={horiz ? [len, h, 0.04] : [0.04, h, len]} />
            <meshPhysicalMaterial color="#cfe0ee" transparent opacity={0.45} roughness={0.1} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function ExitDoor({ o, height }: { o: Opening; height: number }) {
  const mid = (o.from + o.to) / 2;
  const w = o.to - o.from;
  const pos = (along: number, y: number): [number, number, number] => (o.axis === "x" ? [along, y, o.at] : [o.at, y, along]);
  const dh = height - 0.05;
  return (
    <group>
      <mesh position={pos(o.from, dh / 2)}>
        <boxGeometry args={[0.12, dh, 0.12]} />
        <meshStandardMaterial color={COLORS.exit} roughness={0.4} />
      </mesh>
      <mesh position={pos(o.to, dh / 2)}>
        <boxGeometry args={[0.12, dh, 0.12]} />
        <meshStandardMaterial color={COLORS.exit} roughness={0.4} />
      </mesh>
      <mesh position={pos(mid, dh)}>
        <boxGeometry args={o.axis === "x" ? [w + 0.12, 0.12, 0.12] : [0.12, 0.12, w + 0.12]} />
        <meshStandardMaterial color={COLORS.exit} roughness={0.4} />
      </mesh>
      <mesh position={pos(mid, (dh + height) / 2)}>
        <boxGeometry args={o.axis === "x" ? [w + 0.3, height - dh, EXT_T] : [EXT_T, height - dh, w + 0.3]} />
        <meshStandardMaterial color={COLORS.wallExt} roughness={0.9} />
      </mesh>
    </group>
  );
}
