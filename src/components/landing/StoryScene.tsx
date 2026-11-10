import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Float,
  Lightformer,
  RoundedBox,
  Sparkles,
  useVideoTexture,
} from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

const SEGMENTS = 5;
const PANEL_W = 6.4;
const PANEL_H = 3.6;
const REEL_H = 2.76;
const REEL_W = (REEL_H * 9) / 16;
const U_WIDTH = 9 / 16 / (16 / 9); // fraction of the 16:9 frame a centred 9:16 crop covers

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = THREE.MathUtils.lerp;

function Reels({ progress, high }: { progress: MutableRefObject<number>; high: boolean }) {
  const texture = useVideoTexture("/media/ridge-loop.mp4", {
    muted: true,
    loop: true,
    start: true,
    playsInline: true,
  });
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const bezels = useRef<(THREE.Mesh | null)[]>([]);
  const geos = useMemo(
    () => Array.from({ length: SEGMENTS }, () => new THREE.PlaneGeometry(1, 1)),
    [],
  );
  const damped = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    damped.current = THREE.MathUtils.damp(damped.current, progress.current, 6, dt);
    const p = damped.current;
    const a = ease(range(p, 0.0, 0.32)); // emerge
    const b = ease(range(p, 0.3, 0.55)); // split by duration
    const c = ease(range(p, 0.52, 0.86)); // reframe to 9:16 fan
    const t = state.clock.elapsedTime;
    const g = group.current;
    if (g) {
      g.position.z = lerp(-9, 0, a);
      g.position.y = lerp(-0.6, 0.15, a);
      g.rotation.y = lerp(-0.75, 0, a) + state.pointer.x * 0.18;
      g.rotation.x = lerp(0.4, 0.04, a) - state.pointer.y * 0.08;
      g.rotation.z = lerp(0.12, 0, a);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const m = meshes.current[i];
      const bz = bezels.current[i];
      if (!m || !bz) continue;
      const k = i - (SEGMENTS - 1) / 2;
      const w0 = PANEL_W / SEGMENTS;
      // split pose
      const sx = k * w0 + k * 0.42 * b;
      const sz = -Math.abs(k) * 0.25 * b;
      // fan pose
      const ang = k * 0.38;
      const R = 5.2;
      const fx = Math.sin(ang) * R;
      const fz = -(1 - Math.cos(ang)) * R + 0.4;
      const fy = Math.sin(t * 0.8 + i * 1.3) * 0.08;
      // staggered reframe so the cuts turn one after another
      const ci = ease(clamp01(c * 1.6 - Math.abs(k) * 0.18));
      const x = lerp(sx, fx, ci);
      const z = lerp(sz, fz, ci);
      const y = lerp(0, fy, ci);
      const w = lerp(w0, REEL_W, ci);
      const h = lerp(PANEL_H, REEL_H, ci);
      const rotY = lerp(-k * 0.05 * b, -ang, ci);
      m.position.set(x, y, z);
      m.rotation.set(0, rotY, 0);
      m.scale.set(w, h, 1);
      bz.position.set(x, y, z);
      bz.rotation.set(0, rotY, 0);
      bz.translateZ(-0.04);
      bz.scale.set(w + 0.09, h + 0.09, 1);
      // UVs: contiguous slices of the 16:9 frame -> centred 9:16 crops
      const u0s = i / SEGMENTS;
      const u1s = (i + 1) / SEGMENTS;
      const cx = U_WIDTH / 2 + (i / (SEGMENTS - 1)) * (1 - U_WIDTH);
      const u0 = lerp(u0s, cx - U_WIDTH / 2, ci);
      const u1 = lerp(u1s, cx + U_WIDTH / 2, ci);
      const uv = geos[i]?.getAttribute("uv") as THREE.BufferAttribute | undefined;
      if (!uv) continue;
      uv.setXY(0, u0, 1);
      uv.setXY(1, u1, 1);
      uv.setXY(2, u0, 0);
      uv.setXY(3, u1, 0);
      uv.needsUpdate = true;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = a;
    }
  });

  return (
    <group ref={group}>
      {geos.map((geo, i) => (
        <group key={i}>
          <mesh
            ref={(el) => {
              meshes.current[i] = el;
            }}
            geometry={geo}
          >
            <meshBasicMaterial map={texture} toneMapped={false} transparent />
          </mesh>
          <RoundedBox
            ref={(el: THREE.Mesh | null) => {
              bezels.current[i] = el;
            }}
            args={[1, 1, 0.05]}
            radius={0.02}
            smoothness={3}
          >
            <meshStandardMaterial
              color="#14161b"
              metalness={1}
              roughness={0.28}
              envMapIntensity={high ? 1.4 : 1}
            />
          </RoundedBox>
        </group>
      ))}
    </group>
  );
}

function Props({ progress, high }: { progress: MutableRefObject<number>; high: boolean }) {
  const root = useRef<THREE.Group>(null);
  const damped = useRef(0);
  useFrame((state, delta) => {
    damped.current = THREE.MathUtils.damp(
      damped.current,
      progress.current,
      5,
      Math.min(delta, 0.05),
    );
    const g = root.current;
    if (!g) return;
    const e = ease(range(damped.current, 0.08, 0.4));
    g.children.forEach((child) => {
      const s = e * ((child.userData["s"] as number | undefined) ?? 1);
      child.scale.setScalar(Math.max(0.0001, s));
    });
    // deeper parallax than the reels for spatial layering
    g.position.x = state.pointer.x * 0.45;
    g.position.y = state.pointer.y * 0.3 + (damped.current - 0.5) * 1.2;
  });
  const glass = high ? (
    <meshPhysicalMaterial
      transmission={1}
      thickness={1.2}
      roughness={0.06}
      ior={1.45}
      clearcoat={1}
      attenuationColor="#bfe9ff"
      attenuationDistance={2.5}
      color="#ffffff"
    />
  ) : (
    <meshPhysicalMaterial
      color="#cfd8e6"
      transparent
      opacity={0.35}
      roughness={0.1}
      metalness={0.2}
      clearcoat={1}
    />
  );
  return (
    <group ref={root}>
      <Float
        speed={1.3}
        rotationIntensity={0.8}
        floatIntensity={0.9}
        position={[-3.9, 1.7, 1.1]}
        userData={{ s: 1 }}
      >
        <mesh>
          <icosahedronGeometry args={[0.62, 0]} />
          {glass}
        </mesh>
      </Float>
      <Float
        speed={1.1}
        rotationIntensity={1.2}
        floatIntensity={0.7}
        position={[3.8, -1.55, 1.2]}
        userData={{ s: 1 }}
      >
        <mesh rotation={[1.1, 0.3, 0]}>
          <torusGeometry args={[0.55, 0.16, 48, 96]} />
          <meshStandardMaterial color="#e6e9ef" metalness={1} roughness={0.08} />
        </mesh>
      </Float>
      <Float
        speed={1.6}
        rotationIntensity={0.6}
        floatIntensity={1.1}
        position={[3.1, 2.1, -1.8]}
        userData={{ s: 0.9 }}
      >
        <RoundedBox args={[0.5, 0.9, 0.5]} radius={0.22} smoothness={5}>
          {glass}
        </RoundedBox>
      </Float>
      <Float
        speed={2}
        rotationIntensity={0.3}
        floatIntensity={1.4}
        position={[-2.7, -1.9, 2]}
        userData={{ s: 0.8 }}
      >
        <mesh>
          <sphereGeometry args={[0.13, 32, 32]} />
          <meshStandardMaterial
            color="#d4ff4a"
            emissive="#c8ff3d"
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      </Float>
    </group>
  );
}

function Rig() {
  const { camera, size } = useThree();
  useFrame((state, delta) => {
    const aspect = size.width / size.height;
    const vFov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);
    const fitZ = 7.8 / (2 * Math.tan(vFov / 2) * aspect);
    const z = Math.max(8, fitZ);
    const dt = Math.min(delta, 0.05);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, state.pointer.x * 0.35, 3, dt);
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      0.25 + state.pointer.y * 0.2,
      3,
      dt,
    );
    camera.position.z = z;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function StoryScene({
  progress,
  active,
  high,
}: {
  progress: MutableRefObject<number>;
  active: boolean;
  high: boolean;
}) {
  return (
    <Canvas
      dpr={high ? [1, 1.75] : [1, 1.25]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0.25, 8], fov: 35, near: 0.1, far: 60 }}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false }}
    >
      <color attach="background" args={["#040406"]} />
      <fog attach="fog" args={["#040406", 9, 22]} />
      <ambientLight intensity={0.2} />
      <spotLight position={[4, 6, 6]} angle={0.4} penumbra={1} intensity={60} color="#dfe9ff" />
      <pointLight position={[-5, -2, 3]} intensity={12} color="#6fe3ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={3}
          position={[0, 4, 3]}
          scale={[8, 1.4, 1]}
          rotation-x={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={2}
          color="#bfe9ff"
          position={[-6, 1, 0]}
          scale={[1, 6, 1]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={1.5}
          color="#d4ff4a"
          position={[6, -1, -2]}
          scale={[1, 5, 1]}
          rotation-y={-Math.PI / 2}
        />
        <Lightformer form="ring" intensity={2.5} position={[0, 0, -8]} scale={4} />
      </Environment>
      <Rig />
      <Suspense fallback={null}>
        <Reels progress={progress} high={high} />
      </Suspense>
      <Props progress={progress} high={high} />
      <Sparkles
        count={high ? 140 : 60}
        scale={[14, 7, 8]}
        size={1.6}
        speed={0.25}
        opacity={0.5}
        color="#cfe0ff"
      />
      <ContactShadows
        position={[0, -2.25, 0]}
        opacity={0.55}
        scale={16}
        blur={2.6}
        far={5}
        resolution={high ? 512 : 256}
        color="#000000"
      />
      {high ? (
        <EffectComposer multisampling={4}>
          <DepthOfField worldFocusDistance={8} worldFocusRange={4} bokehScale={3.5} />
          <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.2} intensity={0.85} />
          <Noise opacity={0.035} />
          <Vignette eskil={false} offset={0.25} darkness={0.85} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.2} intensity={0.85} />
          <Vignette eskil={false} offset={0.25} darkness={0.85} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
