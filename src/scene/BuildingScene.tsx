"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Building, Connection, Scenario, TestResult } from "@/contracts/types";
import type { BuildingPlan, FloorPlan } from "@/data/demoPlan";
import { ConnectionVisual, ProposalVisual } from "./ConnectionVisual";
import { FlowVisual, type FlowStream } from "./FlowVisual";
import { PlanGeometry } from "./PlanGeometry";
import {
  COLORS,
  buildingCentre,
  connectionPolyline,
  connectionState,
  levelY,
  nodeMap,
  nodePos,
  routeConnectionIds,
  routePolyline,
  type Activity,
} from "./sceneUtils";

export type BuildingSceneProps = {
  building: Building;
  scenario: Scenario;
  result?: TestResult;
  onConnectionClick?: (id: string) => void;
  /** Optional extras, all safe to omit. */
  plan?: BuildingPlan;
  addedConnectionIds?: string[];
  selectedConnectionId?: string;
  proposal?: { connection: Connection; status: "pending" | "rejected" | "accepted" } | null;
  activity?: Activity;
  heat?: Record<string, number>;
  exploded?: boolean;
  showLabels?: boolean;
  cameraResetKey?: number;
};

export function BuildingScene(props: BuildingSceneProps): React.ReactElement {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [60, 52, 70], fov: 32, near: 0.5, far: 500 }}
        onPointerMissed={() => (document.body.style.cursor = "")}
      >
        <color attach="background" args={[COLORS.background]} />
        <fog attach="fog" args={[COLORS.background, 90, 200]} />
        <Suspense fallback={null}>
          <SceneContents {...props} />
        </Suspense>
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO aoRadius={1.6} intensity={2.2} distanceFalloff={0.6} quality="performance" halfRes />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

function SceneContents({
  building,
  scenario,
  result,
  onConnectionClick,
  plan: planProp,
  addedConnectionIds,
  selectedConnectionId,
  proposal,
  activity = "idle",
  heat,
  exploded = true,
  showLabels = true,
  cameraResetKey = 0,
}: BuildingSceneProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const plan = useMemo(() => planProp ?? autoPlan(building), [planProp, building]);
  const nodes = useMemo(() => nodeMap(building), [building]);
  const blocked = useMemo(() => new Set(scenario.blockedConnectionIds), [scenario]);
  const routed = useMemo(() => routeConnectionIds(building, result, scenario), [building, result, scenario]);
  const added = useMemo(() => new Set(addedConnectionIds ?? []), [addedConnectionIds]);
  const stranded = useMemo(() => new Set(result?.unreachableOccupantIds ?? []), [result]);
  const strandedNodes = useMemo(
    () => new Set(building.occupants.filter((o) => stranded.has(o.id)).map((o) => o.startNodeId)),
    [building, stranded],
  );
  const centre = useMemo(() => buildingCentre(building, plan), [building, plan]);
  const polylines = useMemo(() => new Map(building.connections.map((c) => [c.id, connectionPolyline(c, nodes, exploded)])), [building, nodes, exploded]);

  const streams: FlowStream[] = useMemo(() => {
    return building.occupants.map((o) => {
      const n = nodes.get(o.startNodeId);
      const start = n ? nodePos(n, exploded) : new THREE.Vector3();
      const path = result?.paths[o.id];
      const room = plan.floors.flatMap((f) => f.spaces).find((s) => s.nodeId === o.startNodeId)?.rect;
      return {
        occupantId: o.id,
        label: o.label,
        stepFree: o.requiresStepFree,
        points: path ? routePolyline(building, path, blocked, exploded, plan) : null,
        start,
        room,
      };
    });
  }, [building, nodes, result, blocked, exploded, plan]);

  const proposalPoints = useMemo(() => (proposal ? connectionPolyline(proposal.connection, nodes, exploded) : []), [proposal, nodes, exploded]);

  return (
    <>
      <CameraRig centre={centre} resetKey={cameraResetKey} exploded={exploded} />
      <hemisphereLight args={["#ffffff", "#c9d2de", 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[centre.x + 22, 38, centre.z + 18]}
        intensity={2.1}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={120}
      >
        <object3D attach="target" position={[centre.x, 0, centre.z]} />
      </directionalLight>

      <Site centre={centre} plan={plan} />
      <PlanGeometry plan={plan} building={building} exploded={exploded} strandedNodeIds={strandedNodes} showLabels={showLabels} />

      {building.connections.map((c) => (
        <ConnectionVisual
          key={c.id}
          connection={c}
          points={polylines.get(c.id) ?? []}
          state={connectionState(c, blocked, routed, added, selectedConnectionId, hovered)}
          isNew={added.has(c.id)}
          showLabel={showLabels}
          heat={heat?.[c.id]}
          onClick={onConnectionClick}
          onHover={setHovered}
        />
      ))}

      {proposal && !building.connections.some((c) => c.id === proposal.connection.id) && (
        <ProposalVisual connection={proposal.connection} points={proposalPoints} status={proposal.status} />
      )}

      <FlowVisual streams={streams} showLabels={showLabels} />
      <ScanSweep activity={activity} centre={centre} exploded={exploded} />
    </>
  );
}

/** Ground plane, site grid, paths to assembly points. */
function Site({ centre, plan }: { centre: THREE.Vector3; plan: BuildingPlan }) {
  const doors = Object.values(plan.exitDoors);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[centre.x, -0.34, centre.z]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={COLORS.ground} roughness={1} />
      </mesh>
      <Grid
        position={[centre.x, -0.33, centre.z]}
        args={[300, 300]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#dfe4ea"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#ccd3dc"
        fadeDistance={110}
        fadeStrength={1.4}
        infiniteGrid
      />
      {doors.map(([x, z], i) => {
        const dir = Math.sign(x - centre.x) || 1;
        return (
          <group key={i} position={[x + dir * 4, -0.32, z]}>
            <mesh rotation-x={-Math.PI / 2} receiveShadow>
              <circleGeometry args={[2.2, 48]} />
              <meshStandardMaterial color="#dcfce7" roughness={0.9} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
              <ringGeometry args={[2.05, 2.2, 48]} />
              <meshBasicMaterial color={COLORS.exit} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Fly-in on load and smooth return to the default axonometric view when resetKey changes. */
function CameraRig({ centre, resetKey, exploded }: { centre: THREE.Vector3; resetKey: number; exploded: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const flying = useRef(true);
  const narrow = size.width < 900;
  const dist = narrow ? 1.5 : 1;
  const goalPos = useMemo(
    () => new THREE.Vector3(centre.x + 40 * dist, (exploded ? 44 : 35) * dist, centre.z + 49 * dist),
    [centre, dist, exploded],
  );
  const goalTarget = useMemo(() => new THREE.Vector3(centre.x + 2.5, exploded ? 0.5 : -1, centre.z + 3.5), [centre, exploded]);

  useEffect(() => {
    flying.current = true;
  }, [resetKey, exploded, narrow]);

  useFrame((_, dt) => {
    if (!flying.current || !controls.current) return;
    const k = 1 - Math.exp(-dt * 2.2);
    camera.position.lerp(goalPos, k);
    controls.current.target.lerp(goalTarget, k);
    controls.current.update();
    if (camera.position.distanceTo(goalPos) < 0.05) flying.current = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={12}
      maxDistance={140}
      maxPolarAngle={Math.PI * 0.46}
      onStart={() => (flying.current = false)}
    />
  );
}

/** A translucent plane sweeping across the building while an agent is working. */
function ScanSweep({ activity, centre, exploded }: { activity: Activity; centre: THREE.Vector3; exploded: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const color = activity === "attacking" ? COLORS.blocked : activity === "defending" ? COLORS.added : COLORS.route;
  const h = levelY(1, exploded) + 4;

  useFrame(({ clock }, dt) => {
    if (!mesh.current || !mat.current) return;
    const target = activity !== "idle" ? 0.12 : 0;
    mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, target, 1 - Math.exp(-dt * 6));
    mesh.current.position.x = centre.x + Math.sin(clock.elapsedTime * 1.2) * 19;
    mesh.current.visible = mat.current.opacity > 0.005;
  });

  return (
    <mesh ref={mesh} position={[centre.x, h / 2 - 0.3, centre.z]} rotation-y={Math.PI / 2}>
      <planeGeometry args={[16, h]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** Minimal plan for buildings that ship without one: a slab per floor and a pad per node. */
function autoPlan(b: Building): BuildingPlan {
  const floors = [...new Set(b.nodes.map((n) => n.floor))].sort((x, y) => x - y);
  const plans: FloorPlan[] = floors.map((f) => {
    const ns = b.nodes.filter((n) => n.floor === f);
    const xs = ns.map((n) => n.position[0]);
    const zs = ns.map((n) => n.position[2]);
    return {
      floor: f,
      name: f === 0 ? "Ground floor" : `Level ${f}`,
      footprint: [Math.min(...xs) - 3, Math.min(...zs) - 3, Math.max(...xs) + 3, Math.max(...zs) + 3],
      voids: [],
      openings: [],
      spaces: ns.map((n) => ({
        id: `auto-${n.id}`,
        name: n.label,
        nodeId: n.id,
        kind: n.kind === "room" ? ("room" as const) : n.kind === "exit" ? ("lobby" as const) : ("circulation" as const),
        rect: [n.position[0] - 1.6, n.position[2] - 1.6, n.position[0] + 1.6, n.position[2] + 1.6] as [number, number, number, number],
      })),
    };
  });
  return { floors: plans, exitDoors: {}, wallHeight: 0.4 };
}

export default BuildingScene;
