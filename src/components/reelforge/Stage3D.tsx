import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function frameTexture(i: number) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 420;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d1016";
  g.fillRect(0, 0, 256, 420);
  const grad = g.createLinearGradient(0, 40, 256, 380);
  const hue = i % 3 === 0 ? ["#c8ff3d", "#0e2a10"] : i % 3 === 1 ? ["#4fd6ff", "#0a1a2a"] : ["#7a8396", "#111520"];
  grad.addColorStop(0, hue[0]);
  grad.addColorStop(1, hue[1]);
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  g.fillRect(28, 40, 200, 340);
  g.globalAlpha = 1;
  g.fillStyle = "#05060a";
  for (let y = 12; y < 420; y += 34) {
    g.fillRect(6, y, 12, 18);
    g.fillRect(238, y, 12, 18);
  }
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "600 18px monospace";
  g.fillText(`${String(i + 1).padStart(2, "0")}`, 40, 370);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Strip({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const N = 16;
  const tex = useMemo(() => Array.from({ length: N }, (_, i) => frameTexture(i)), []);
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    if (!reduced) g.rotation.y += dt * 0.12;
    const tx = state.pointer.y * 0.18 + 0.28;
    const tz = -state.pointer.x * 0.12;
    g.rotation.x += (tx - g.rotation.x) * (1 - Math.exp(-3 * dt));
    g.rotation.z += (tz - g.rotation.z) * (1 - Math.exp(-3 * dt));
  });
  return (
    <group ref={group} rotation={[0.28, 0, 0]}>
      {tex.map((t, i) => {
        const a = (i / N) * Math.PI * 2;
        const r = 3.3;
        return (
          <mesh key={i} position={[Math.sin(a) * r, Math.sin(a * 2) * 0.25, Math.cos(a) * r]} rotation={[0, a, 0]}>
            <planeGeometry args={[1.05, 1.72]} />
            <meshStandardMaterial map={t} side={THREE.DoubleSide} roughness={0.35} metalness={0.2} />
          </mesh>
        );
      })}
      {[0, 1, 2].map((i) => (
        <mesh key={`g${i}`} position={[(i - 1) * 0.55, 0.1 - i * 0.05, -0.3 + i * 0.35]} rotation={[0.08, -0.35 + i * 0.25, 0.05]}>
          <boxGeometry args={[1.2, 2.1, 0.03]} />
          <meshPhysicalMaterial color={i === 1 ? "#c8ff3d" : "#7fdcff"} transparent opacity={0.13} roughness={0.15} metalness={0.1} clearcoat={1} />
        </mesh>
      ))}
    </group>
  );
}

export default function Stage3D({ reduced }: { reduced: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.6, 7.2], fov: 42 }}
      frameloop={reduced ? "demand" : "always"}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => gl.domElement.parentElement?.setAttribute("data-scene-ready", "true")}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <pointLight position={[-4, -1, 2]} intensity={6} color="#4fd6ff" />
      <Environment resolution={64}>
        <Lightformer intensity={2} position={[0, 5, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={1} color="#bfff5a" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
      </Environment>
      <Strip reduced={reduced} />
    </Canvas>
  );
}
