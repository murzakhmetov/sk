import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import { CITY_HALF_EXTENT, generateCity, type CityLayout } from './city';
import type { InstanceTransform, Vec3 } from './math';
import { StaticInstances } from './StaticInstances';

const LAMP_HEIGHT = 5;
const TRUNK_HEIGHT = 2.2;

/**
 * The static city: ground, roads, sidewalks, buildings, trees and street lamps.
 * Each kind of object is one instanced mesh (about ten draw calls for the whole
 * city), and all colliders live in a single fixed rigid body.
 */
export function World() {
  const city = useMemo(() => generateCity(), []);
  const lampParts = useMemo(() => lampInstances(city.lamps), [city]);
  const treeParts = useMemo(() => treeInstances(city.trees), [city]);

  return (
    <group>
      {/* Grass beyond the city, slightly lower to avoid z-fighting with the asphalt. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05} receiveShadow>
        <planeGeometry args={[1200, 1200]} />
        <meshStandardMaterial color="#7d9a5a" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[CITY_HALF_EXTENT * 2, CITY_HALF_EXTENT * 2]} />
        <meshStandardMaterial color="#3d4147" roughness={0.95} />
      </mesh>

      <StaticInstances instances={city.laneMarks}>
        <boxGeometry />
        <meshStandardMaterial color="#e6dfc4" roughness={0.8} />
      </StaticInstances>
      <StaticInstances instances={city.sidewalks} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
      </StaticInstances>
      <StaticInstances instances={city.buildings} castShadow receiveShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.85} />
      </StaticInstances>
      <StaticInstances instances={city.roofs} castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#5d6168" roughness={0.9} />
      </StaticInstances>

      <StaticInstances instances={treeParts.trunks} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1, 6]} />
        <meshStandardMaterial color="#6b4a2f" roughness={1} />
      </StaticInstances>
      <StaticInstances instances={treeParts.crowns} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </StaticInstances>

      <StaticInstances instances={lampParts.poles} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 1, 6]} />
        <meshStandardMaterial color="#2d3136" metalness={0.4} roughness={0.6} />
      </StaticInstances>
      <StaticInstances instances={lampParts.heads}>
        <boxGeometry />
        <meshStandardMaterial color="#fff4d6" emissive="#ffd27a" emissiveIntensity={0.8} />
      </StaticInstances>

      <CityColliders city={city} />
    </group>
  );
}

function CityColliders({ city }: { city: CityLayout }) {
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Ground: a thick slab whose top face is y = 0. */}
      <CuboidCollider args={[600, 1, 600]} position={[0, -1, 0]} />
      {city.buildings.map(({ position, scale = [1, 1, 1] }, index) => (
        <CuboidCollider key={`b${index}`} args={[scale[0] / 2, scale[1] / 2, scale[2] / 2]} position={position} />
      ))}
      {city.trees.map(({ position }, index) => (
        <CylinderCollider
          key={`t${index}`}
          args={[TRUNK_HEIGHT / 2, 0.3]}
          position={[position[0], TRUNK_HEIGHT / 2, position[2]]}
        />
      ))}
      {city.lamps.map(([x, , z], index) => (
        <CylinderCollider key={`l${index}`} args={[LAMP_HEIGHT / 2, 0.12]} position={[x, LAMP_HEIGHT / 2, z]} />
      ))}
    </RigidBody>
  );
}

function treeInstances(trees: readonly InstanceTransform[]) {
  const crownColors = ['#4f8a3c', '#5e9b45', '#467a35', '#6aa64f'] as const;
  return {
    trunks: trees.map(({ position, scale = [1, 1, 1] }) => ({
      position: [position[0], (TRUNK_HEIGHT * scale[0]) / 2, position[2]] as const,
      scale: [scale[0], TRUNK_HEIGHT * scale[0], scale[0]] as const,
    })),
    crowns: trees.map(({ position, scale = [1, 1, 1] }, index) => ({
      position: [position[0], TRUNK_HEIGHT * scale[0] + 1.1 * scale[0], position[2]] as const,
      scale: [1.7 * scale[0], 1.9 * scale[0], 1.7 * scale[0]] as const,
      rotationY: index * 1.3,
      color: crownColors[index % crownColors.length],
    })),
  };
}

function lampInstances(lamps: readonly Vec3[]) {
  return {
    poles: lamps.map(([x, , z]) => ({
      position: [x, LAMP_HEIGHT / 2, z] as const,
      scale: [1, LAMP_HEIGHT, 1] as const,
    })),
    heads: lamps.map(([x, , z]) => ({
      position: [x, LAMP_HEIGHT + 0.1, z] as const,
      scale: [0.5, 0.2, 0.5] as const,
    })),
  };
}
