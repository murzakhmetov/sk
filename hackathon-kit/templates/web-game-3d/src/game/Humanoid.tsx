import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

/** Mutable motion input for the walk cycle; the owner updates `speed` every frame. */
export interface HumanoidMotion {
  /** Horizontal speed in m/s. */
  speed: number;
}

interface HumanoidProps {
  color: string;
  pantsColor?: string;
  skinColor?: string;
  motion?: HumanoidMotion;
}

const HIP_HEIGHT = 0.86;
const SHOULDER_HEIGHT = 1.42;

/** Blocky low-poly character (about 1.85 m tall, feet at y = 0, facing +z) with a procedural walk cycle. */
export function Humanoid({ color, pantsColor = '#2c3440', skinColor = '#e2b48a', motion }: HumanoidProps) {
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const speed = motion?.speed ?? 0;
    phase.current += delta * speed * 2.4;
    const swing = Math.sin(phase.current) * Math.min(speed / 5, 1) * 0.75;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftArm.current) leftArm.current.rotation.x = -swing * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = swing * 0.8;
  });

  return (
    <group>
      {[
        { ref: leftLeg, x: -0.13 },
        { ref: rightLeg, x: 0.13 },
      ].map(({ ref, x }) => (
        <group key={x} ref={ref} position={[x, HIP_HEIGHT, 0]}>
          <mesh position={[0, -HIP_HEIGHT / 2, 0]} castShadow>
            <boxGeometry args={[0.2, HIP_HEIGHT, 0.24]} />
            <meshStandardMaterial color={pantsColor} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.56, 0.62, 0.32]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[
        { ref: leftArm, x: -0.36 },
        { ref: rightArm, x: 0.36 },
      ].map(({ ref, x }) => (
        <group key={x} ref={ref} position={[x, SHOULDER_HEIGHT, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <boxGeometry args={[0.15, 0.6, 0.18]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.65, 0]} castShadow>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>
      {/* Eye band shows which way the character faces. */}
      <mesh position={[0, 1.68, 0.17]}>
        <boxGeometry args={[0.26, 0.05, 0.06]} />
        <meshStandardMaterial color="#1e1e1e" />
      </mesh>
    </group>
  );
}
