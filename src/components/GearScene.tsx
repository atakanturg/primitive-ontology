import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

function DottedGrid() {
  const pointsRef = useRef<THREE.Points>(null);
  const { viewport } = useThree();
  const mouse = useRef(new THREE.Vector2());

  const { positions, uvs } = useMemo(() => {
    const size = 30;
    const spacing = 0.6; // 50x50 = 2500 points
    const count = Math.ceil(size / spacing) * Math.ceil(size / spacing);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    
    let i = 0;
    for (let x = -size / 2; x < size / 2; x += spacing) {
      for (let y = -size / 2; y < size / 2; y += spacing) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = -5; // Z depth
        
        uvs[i * 2] = x;
        uvs[i * 2 + 1] = y;
        i++;
      }
    }
    return { positions, uvs };
  }, []);

  useFrame((state) => {
    mouse.current.lerp(state.pointer, 0.1);
    
    if (pointsRef.current) {
      const positionsAttr = pointsRef.current.geometry.attributes.position;
      const count = positionsAttr.count;
      
      const mx = (mouse.current.x * viewport.width) / 2;
      const my = (mouse.current.y * viewport.height) / 2;
      
      for (let i = 0; i < count; i++) {
        const ox = uvs[i * 2];
        const oy = uvs[i * 2 + 1];
        
        const dx = ox - mx;
        const dy = oy - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        const maxDist = 4;
        if (dist < maxDist) {
          const force = (maxDist - dist) / maxDist; // 0 to 1
          const pull = force * 1.5;
          
          positionsAttr.setXYZ(
            i, 
            ox + dx * pull, 
            oy + Math.sin(force * Math.PI) * 0.8 + dy * pull, // slight morph behavior
            -5 + force * 3 // pop out towards camera
          );
        } else {
          positionsAttr.setXYZ(i, ox, oy, -5);
        }
      }
      positionsAttr.needsUpdate = true;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute 
          attach="attributes-position" 
          count={positions.length / 3} 
          array={positions} 
          itemSize={3} 
        />
        <bufferAttribute 
          attach="attributes-uv" 
          count={uvs.length / 2} 
          array={uvs} 
          itemSize={2} 
        />
      </bufferGeometry>
      <pointsMaterial 
        color="#808080" 
        size={0.06} 
        transparent 
        opacity={0.6} 
        sizeAttenuation 
      />
    </points>
  );
}

function Particles() {
  const count = 250;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
        const t = Math.random() * 100;
        const factor = 10 + Math.random() * 100;
        const speed = 0.005 + Math.random() / 150;
        const xFactor = -20 + Math.random() * 40;
        const yFactor = -20 + Math.random() * 40;
        const zFactor = -20 + Math.random() * 40;
        temp.push({ t, factor, speed, xFactor, yFactor, zFactor, mx: 0, my: 0 });
    }
    return temp;
  }, [count]);

  const timer = useMemo(() => new THREE.Timer(), []);

  useFrame((state) => {
    timer.update();
    const t = timer.getElapsed();

    particles.forEach((particle, i) => {
        let { factor, speed, xFactor, yFactor, zFactor } = particle;
        const currentT = particle.t += speed / 2;
        const a = Math.cos(currentT) + Math.sin(currentT * 1) / 10;
        const b = Math.sin(currentT) + Math.cos(currentT * 2) / 10;
        const s = Math.max(1.5, Math.cos(currentT) * 3);
        
        dummy.position.set(
            (particle.mx / 10) * a + xFactor + Math.cos((currentT / 10) * factor) + (Math.sin(currentT * 1) * factor) / 10,
            (particle.my / 10) * b + yFactor + Math.sin((currentT / 10) * factor) + (Math.cos(currentT * 2) * factor) / 10,
            (particle.my / 10) * b + zFactor + Math.cos((currentT / 10) * factor) + (Math.sin(currentT * 3) * factor) / 10
        );
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        if (mesh.current) {
            mesh.current.setMatrixAt(i, dummy.matrix);
        }
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined as any, undefined as any, count]}>
      <sphereGeometry args={[0.03, 8, 8]} />
      <meshBasicMaterial color="#a0a0a0" transparent opacity={0.8} fog={true} />
    </instancedMesh>
  );
}

export function GearScene() {
  return (
    <div className="fixed inset-0 z-[-2] pointer-events-none">
      <Canvas camera={{ position: [0, 0, 12], fov: 45 }}>
        <color attach="background" args={["#fdfdfd"]} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#e0e0e0" />
        <spotLight position={[0, 10, 0]} intensity={0.8} penumbra={1} color="#ffffff" />
        <fog attach="fog" args={['#fdfdfd', 8, 25]} />
        
        <DottedGrid />
        <Particles />
      </Canvas>
    </div>
  );
}
