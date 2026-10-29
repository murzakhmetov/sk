import {
  CuboidCollider,
  CylinderCollider,
  InstancedRigidBodies,
  RigidBody,
  type InstancedRigidBodyProps,
} from '@react-three/rapier';
import { useMemo } from 'react';
import { CITY } from './city';
import type { InstanceTransform } from './math';
import { StaticInstances } from './StaticInstances';

const PLAZA_SIZE = CITY.blockSize;

const BENCHES: InstanceTransform[] = [
  { position: [4.2, 0.25, 4.2], scale: [2, 0.5, 0.6], rotationY: -Math.PI / 4 },
  { position: [-4.2, 0.25, 4.2], scale: [2, 0.5, 0.6], rotationY: Math.PI / 4 },
  { position: [4.2, 0.25, -4.2], scale: [2, 0.5, 0.6], rotationY: Math.PI / 4 },
  { position: [-4.2, 0.25, -4.2], scale: [2, 0.5, 0.6], rotationY: -Math.PI / 4 },
];

/** Hand-placed landmarks on the central plaza, plus a few pushable crates. */
export function Props() {
  return (
    <group>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[PLAZA_SIZE, 0.06, PLAZA_SIZE]} />
        <meshStandardMaterial color="#b9b1a3" roughness={1} />
      </mesh>
      <Fountain />
      <Kiosk position={[10.5, 0, -10.5]} rotationY={-Math.PI / 4} />
      <StaticInstances instances={BENCHES} castShadow receiveShadow>
        <boxGeometry />
        <meshStandardMaterial color="#8a5a3c" roughness={0.9} />
      </StaticInstances>
      <RigidBody type="fixed" colliders={false}>
        {BENCHES.map(({ position, rotationY = 0 }, index) => (
          <CuboidCollider key={index} args={[1, 0.25, 0.3]} position={position} rotation={[0, rotationY, 0]} />
        ))}
      </RigidBody>
      <Crates />
    </group>
  );
}

function Fountain() {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.6, 2.8, 0.6, 24]} />
        <meshStandardMaterial color="#9d968a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[2.3, 2.3, 0.05, 24]} />
        <meshStandardMaterial color="#4aa3d8" emissive="#1d5f87" emissiveIntensity={0.4} roughness={0.2} />
      </mesh>
      <mesh position={[0, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.45, 1.6, 12]} />
        <meshStandardMaterial color="#a9a294" roughness={0.8} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.3, 2.8]} position={[0, 0.3, 0]} />
        <CylinderCollider args={[0.8, 0.45]} position={[0, 1.3, 0]} />
      </RigidBody>
    </group>
  );
}

function Kiosk({ position, rotationY }: { position: InstanceTransform['position']; rotationY: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 2.6, 2.2]} />
        <meshStandardMaterial color="#f2e6cf" roughness={0.8} />
      </mesh>
      {/* Awning over the counter (front = +z). */}
      <mesh position={[0, 2.5, 1.4]} rotation-x={0.35} castShadow>
        <boxGeometry args={[3.4, 0.08, 1.1]} />
        <meshStandardMaterial color="#e0567a" roughness={0.7} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[1.6, 1.3, 1.1]} position={[0, 1.3, 0]} />
      </RigidBody>
    </group>
  );
}

/** Dynamic physics props in a single draw call; walk or drive into them. */
function Crates() {
  const instances = useMemo<InstancedRigidBodyProps[]>(() => {
    const spots: [number, number, number][] = [
      [-11, 0.4, -11], [-10, 0.4, -11], [-11, 0.4, -10], [-10.5, 1.2, -10.5],
      [-12, 0.4, -9.5], [-9, 0.4, -12],
    ];
    return spots.map((position, index) => ({ key: `crate-${index}`, position, rotation: [0, index * 0.5, 0] }));
  }, []);

  return (
    <InstancedRigidBodies instances={instances} colliders="cuboid">
      <instancedMesh args={[undefined, undefined, instances.length]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial color="#b8864f" roughness={0.9} />
      </instancedMesh>
    </InstancedRigidBodies>
  );
}
