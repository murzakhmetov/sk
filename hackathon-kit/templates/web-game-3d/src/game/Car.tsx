import { useFrame } from '@react-three/fiber';
import { BallCollider, CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { Quaternion, Vector3, type Group } from 'three';
import { useGameStore } from '../state/store';
import { CAR, WORLD } from './config';
import { IDLE_INPUT, readMoveInput } from './controls';
import { clamp } from './math';
import { runtime } from './runtime';

const WHEEL_RADIUS = 0.36;
const WHEELS = [
  { x: -0.85, z: 1.35, front: true },
  { x: 0.85, z: 1.35, front: true },
  { x: -0.85, z: -1.35, front: false },
  { x: 0.85, z: -1.35, front: false },
] as const;
/** How quickly a parked car rolls to a stop. */
const PARKED_DRAG = 4;

/**
 * Arcade car: no wheel simulation. Each frame the forward speed is integrated
 * from throttle and brake, sideways slip is damped (grip), and steering sets the
 * yaw rate directly. Ball colliders at the wheels let it roll over curbs.
 */
export function Car() {
  const bodyRef = useRef<RapierRigidBody>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);
  const spin = useRef(0);
  const scratch = useMemo(() => ({ rotation: new Quaternion(), forward: new Vector3() }), []);

  useEffect(() => {
    runtime.car.body = bodyRef.current;
    return () => {
      runtime.car.body = null;
    };
  }, []);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    if (!body) return;
    const dt = Math.min(delta, 0.05);
    const driving = useGameStore.getState().mode === 'driving';
    const input = driving ? readMoveInput() : IDLE_INPUT;

    const { rotation, forward } = scratch;
    const r = body.rotation();
    forward.set(0, 0, 1).applyQuaternion(rotation.set(r.x, r.y, r.z, r.w));
    forward.setY(0).normalize();

    const velocity = body.linvel();
    const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
    let speed = forwardSpeed;
    if (input.y !== 0) {
      // Pressing against the direction of travel brakes harder than accelerating.
      const braking = Math.sign(input.y) !== Math.sign(speed) && Math.abs(speed) > 0.5;
      speed += input.y * (braking ? CAR.brakeDeceleration : CAR.acceleration) * dt;
    } else {
      speed *= Math.exp(-(driving ? CAR.drag : PARKED_DRAG) * dt);
    }
    speed = clamp(speed, -CAR.maxReverseSpeed, CAR.maxSpeed);

    // Remove most of the sideways slip; the handbrake (Space) lets the rear slide.
    const grip = Math.exp(-(input.jump ? CAR.handbrakeGrip : CAR.grip) * dt);
    const slipX = (velocity.x - forward.x * forwardSpeed) * grip;
    const slipZ = (velocity.z - forward.z * forwardSpeed) * grip;
    body.setLinvel({ x: forward.x * speed + slipX, y: velocity.y, z: forward.z * speed + slipZ }, true);

    // Steering needs speed and flips in reverse, like a real car.
    const steering = -input.x * CAR.turnRate * clamp(speed / 6, -1, 1);
    body.setAngvel({ x: 0, y: steering, z: 0 }, true);

    const position = body.translation();
    runtime.car.position.set(position.x, position.y, position.z);
    runtime.car.yaw = Math.atan2(forward.x, forward.z);
    if (position.y < WORLD.fallResetY) {
      body.setTranslation({ x: CAR.spawn[0], y: CAR.spawn[1], z: CAR.spawn[2] }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    spin.current += (speed * dt) / WHEEL_RADIUS;
    wheelRefs.current.forEach((wheel, index) => {
      if (!wheel) return;
      wheel.rotation.x = spin.current;
      if (WHEELS[index]?.front) wheel.rotation.y = -input.x * 0.45;
    });
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={CAR.spawn}
      rotation={[0, CAR.spawnYaw, 0]}
      enabledRotations={[false, true, false]}
      canSleep={false}
      ccd
    >
      <CuboidCollider args={[0.95, 0.4, 2.1]} position={[0, 0.85, 0]} friction={0.2} />
      {WHEELS.map(({ x, z }) => (
        <BallCollider key={`${x}${z}`} args={[WHEEL_RADIUS]} position={[x, WHEEL_RADIUS, z]} friction={0} />
      ))}

      {/* Visual model; the front of the car is +z. */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[1.9, 0.55, 4.3]} />
        <meshStandardMaterial color="#d63a2f" metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.22, -0.25]} castShadow>
        <boxGeometry args={[1.62, 0.5, 2.1]} />
        <meshStandardMaterial color="#1f2a33" metalness={0.5} roughness={0.2} />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={`head${x}`} position={[x, 0.78, 2.16]}>
          <boxGeometry args={[0.42, 0.16, 0.04]} />
          <meshStandardMaterial color="#fffbe6" emissive="#fff3c4" emissiveIntensity={1.2} />
        </mesh>
      ))}
      {[-0.65, 0.65].map((x) => (
        <mesh key={`tail${x}`} position={[x, 0.8, -2.16]}>
          <boxGeometry args={[0.4, 0.14, 0.04]} />
          <meshStandardMaterial color="#ff3b30" emissive="#b0140c" emissiveIntensity={1} />
        </mesh>
      ))}
      {WHEELS.map(({ x, z }, index) => (
        <group
          key={`wheel${x}${z}`}
          position={[x, WHEEL_RADIUS, z]}
          ref={(wheel) => {
            wheelRefs.current[index] = wheel;
          }}
        >
          <mesh rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 16]} />
            <meshStandardMaterial color="#181a1d" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </RigidBody>
  );
}
