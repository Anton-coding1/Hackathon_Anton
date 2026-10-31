"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Building, Connection, Scenario, TestResult } from "@/contracts/types";
import type { BuildingPlan } from "@/data/demoPlan";
import { autoPlan } from "@/data/autoPlan";
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
  /** "minimal": key rooms, blocked/new links and stranded people only. Overrides showLabels. */
  labelMode?: "all" | "minimal" | "none";
  cameraResetKey?: number;
  /** Share of the canvas width actually visible (e.g. 0.6 when side panels overlap it), and a target nudge. */
  framing?: { visibleFraction: number; offset: [number, number, number] };
};

export function BuildingScene(props: BuildingSceneProps): React.ReactElement {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [70, 60, 80], fov: 32, near: 0.5, far: 800 }}
        onPointerMissed={() => (document.body.style.cursor = "")}
      >
        <color attach="background" args={[COLORS.background]} />
        <fog attach="fog" args={[COLORS.background, 120, 320]} />
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
  labelMode,
  cameraResetKey = 0,
  framing,
}: BuildingSceneProps) {
  const mode = labelMode ?? (showLabels ? "all" : "none");
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
  const span = useMemo(() => {
    const xs = plan.floors.flatMap((f) => [f.footprint[0], f.footprint[2]]);
    const zs = plan.floors.flatMap((f) => [f.footprint[1], f.footprint[3]]);
    const tall = plan.floors.length * (exploded ? 9 : 4.5) * 1.15;
    return Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.6, tall, 12);
  }, [plan, exploded]);
  const topY = useMemo(() => Math.max(...plan.floors.map((f) => levelY(f.floor, exploded))), [plan, exploded]);
  const polylines = useMemo(() => {
    // Parallel links between the same two spaces are drawn side by side, not on top of each other.
    const seen = new Map<string, number>();
    return new Map(
      building.connections.map((c) => {
        const key = [c.from, c.to].sort().join("|");
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        const pts = connectionPolyline(c, nodes, exploded);
        if (k === 0 || pts.length < 2) return [c.id, pts];
        const a = pts[0];
        const b = pts[pts.length - 1];
        const n = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x);
        if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
        n.normalize().multiplyScalar(0.9 * (k % 2 ? 1 : -1) * Math.ceil(k / 2));
        return [c.id, pts.map((p) => p.clone().add(n))];
      }),
    );
  }, [building, nodes, exploded]);

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
      <CameraRig centre={centre} resetKey={cameraResetKey} exploded={exploded} span={span} framing={framing} lift={topY / 2} />
      <hemisphereLight args={["#ffffff", "#c9d2de", 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[centre.x + 26, 60, centre.z + 22]}
        intensity={2.1}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={45}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={220}
      >
        <object3D attach="target" position={[centre.x, 0, centre.z]} />
      </directionalLight>

      <Site centre={centre} plan={plan} />
      <PlanGeometry plan={plan} building={building} exploded={exploded} strandedNodeIds={strandedNodes} labelMode={mode} />

      {building.connections.map((c) => (
        <ConnectionVisual
          key={c.id}
          connection={c}
          points={polylines.get(c.id) ?? []}
          state={connectionState(c, blocked, routed, added, selectedConnectionId, hovered)}
          isNew={added.has(c.id)}
          showLabel={mode === "all" || (mode === "minimal" && (blocked.has(c.id) || added.has(c.id) || hovered === c.id))}
          heat={heat?.[c.id]}
          onClick={onConnectionClick}
          onHover={setHovered}
        />
      ))}

      {proposal && !building.connections.some((c) => c.id === proposal.connection.id) && (
        <ProposalVisual connection={proposal.connection} points={proposalPoints} status={proposal.status} />
      )}

      <FlowVisual streams={streams} labelMode={mode} />
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
function CameraRig({
  centre,
  resetKey,
  exploded,
  span,
  framing,
  lift = 0,
}: {
  lift?: number;
  centre: THREE.Vector3;
  resetKey: number;
  exploded: boolean;
  span: number;
  framing?: { visibleFraction: number; offset: [number, number, number] };
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const flying = useRef(true);
  const fraction = framing?.visibleFraction ?? 1;
  const aspect = (size.width * fraction) / Math.max(1, size.height);
  const dist = (span * 1.0 * (aspect < 1.6 ? 1.6 / aspect : 1)) / Math.max(0.4, fraction) + (exploded ? 6 : 0);
  const off = framing?.offset ?? [0, 0, 0];
  const goalPos = useMemo(() => {
    const dir = new THREE.Vector3(0.53, exploded ? 0.6 : 0.52, 0.62).normalize();
    return new THREE.Vector3(centre.x + off[0], lift * 0.85, centre.z + off[2]).addScaledVector(dir, dist);
  }, [centre, dist, exploded, lift, off[0], off[2]]);
  const goalTarget = useMemo(
    () => new THREE.Vector3(centre.x + off[0], Math.max(exploded ? 2.5 : 1, lift * 0.85) + off[1], centre.z + off[2]),
    [centre, exploded, lift, off[0], off[1], off[2]],
  );
  const narrow = size.width < 900;

  useEffect(() => {
    flying.current = true;
  }, [resetKey, exploded, narrow, fraction]);

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
      maxDistance={220}
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

export default BuildingScene;
