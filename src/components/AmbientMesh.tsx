import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function Icosahedron({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock, mouse }) => {
    if (!ref.current) return;
    ref.current.rotation.x = clock.elapsedTime * 0.12 + mouse.y * 0.18;
    ref.current.rotation.y = clock.elapsedTime * 0.18 + mouse.x * 0.18;
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.6, 1]} />
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  );
}

export function AmbientMesh({ color = '#526d8e' }: { color?: string }) {
  return (
    <Canvas
      style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', zIndex: 0, pointerEvents: 'none', opacity: 0.18 }}
      camera={{ position: [0, 0, 5], fov: 40 }}
      dpr={[1, 1.5]}
    >
      <Icosahedron color={color} />
    </Canvas>
  );
}
