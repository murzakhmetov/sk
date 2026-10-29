import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CylinderCollider, type CollisionPayload } from '@react-three/rapier';
import { useRef } from 'react';
import { DoubleSide, type Mesh } from 'three';
import { useGameStore } from '../state/store';
import type { Vec3 } from './math';
import { runtime } from './runtime';
import { ZONES } from './zones';

const ZONE_HEIGHT = 2;

export function TriggerZones() {
  const recordEvent = useGameStore((state) => state.recordEvent);
  return (
    <>
      {ZONES.map((zone) => (
        <TriggerZone
          key={zone.id}
          position={zone.position}
          radius={zone.radius}
          color={zone.color}
          label={zone.label}
          onEnter={() => recordEvent(zone.event.type, zone.event.text)}
        />
      ))}
    </>
  );
}

interface TriggerZoneProps {
  position: Vec3;
  radius: number;
  color: string;
  label?: string;
  onEnter?: () => void;
  onExit?: () => void;
}

const isPlayer = ({ other }: CollisionPayload) =>
  other.rigidBody !== undefined && other.rigidBody.handle === runtime.player.body?.handle;

/** Reusable sensor volume with a pulsing GTA-style marker. Fires only for the player on foot. */
export function TriggerZone({ position, radius, color, label, onEnter, onExit }: TriggerZoneProps) {
  const markerRef = useRef<Mesh>(null);
  const [x, y, z] = position;

  useFrame(({ clock }) => {
    const marker = markerRef.current;
    if (marker) marker.scale.y = 0.85 + Math.sin(clock.elapsedTime * 3) * 0.15;
  });

  return (
    <>
      <CylinderCollider
        sensor
        args={[ZONE_HEIGHT / 2, radius]}
        position={[x, y + ZONE_HEIGHT / 2, z]}
        onIntersectionEnter={(payload) => isPlayer(payload) && onEnter?.()}
        onIntersectionExit={(payload) => isPlayer(payload) && onExit?.()}
      />
      <group position={position}>
        <mesh ref={markerRef} position-y={ZONE_HEIGHT / 2}>
          <cylinderGeometry args={[radius, radius, ZONE_HEIGHT, 32, 1, true]} />
          <meshBasicMaterial color={color} transparent opacity={0.22} side={DoubleSide} depthWrite={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
          <ringGeometry args={[radius * 0.82, radius, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.8} />
        </mesh>
        {label && (
          <Html position={[0, ZONE_HEIGHT + 0.5, 0]} center distanceFactor={12} zIndexRange={[10, 0]}>
            <div className="nametag nametag-zone">{label}</div>
          </Html>
        )}
      </group>
    </>
  );
}
