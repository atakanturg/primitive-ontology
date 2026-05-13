import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';

export function PlanetScene() {
  const groupRef = useRef<THREE.Group>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const timer = useMemo(() => new THREE.Timer(), []);
  
  useFrame((state) => {
    timer.update();
    const t = timer.getElapsed();

    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.03;
      groupRef.current.rotation.z = Math.sin(t * 0.1) * 0.05;
      groupRef.current.position.y = Math.sin(t * 0.5) * 0.2;
    }
    if (ring1.current) {
      ring1.current.rotation.x = t * 0.1;
      ring1.current.rotation.y = t * 0.15;
    }
    if (ring2.current) {
      ring2.current.rotation.x = t * 0.08;
      ring2.current.rotation.z = t * 0.12;
    }
  });

  return (
    <group ref={groupRef} scale={[0.75, 0.75, 0.75]}>
      <Float speed={1.2} rotationIntensity={0.5} floatIntensity={0.2}>
        <mesh ref={ring1}>
          <torusGeometry args={[4.5, 0.01, 16, 100]} />
          <meshBasicMaterial color="#606060" transparent opacity={0.4} />
        </mesh>
        <mesh ref={ring2}>
          <torusGeometry args={[5, 0.015, 16, 100]} />
          <meshBasicMaterial color="#a0a0a0" transparent opacity={0.3} />
        </mesh>
      </Float>
    </group>
  );
}

export function PlanetCanvas() {
  return (
    <div className="w-full h-full">
      <Canvas camera={{ position: [0, 0, 10], fov: 45 }} className="outline-none">
        <ambientLight intensity={1.2} />
        <directionalLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#e0e0e0" />
        <spotLight position={[0, 10, 0]} intensity={0.8} penumbra={1} color="#ffffff" />
        <PlanetScene />
      </Canvas>
    </div>
  );
}
