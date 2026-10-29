import { useFrame } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, type Group } from 'three';
import { useGameStore } from '../state/store';
import { PLAYER, WORLD } from './config';
import { IDLE_INPUT, readMoveInput } from './controls';
import { Humanoid, type HumanoidMotion } from './Humanoid';
import { dampAngle, dampFactor } from './math';
import { runtime } from './runtime';

const FOOT_OFFSET = PLAYER.halfHeight + PLAYER.radius;
/** How far below the capsule bottom still counts as standing on the ground. */
const GROUND_TOLERANCE = 0.12;
const EXIT_SIDE_OFFSET = 2.2;

/**
 * Physics character: a dynamic capsule whose horizontal velocity is steered toward
 * the input direction (relative to the camera), with gravity left to Rapier.
 */
export function Player() {
  const bodyRef = useRef<RapierRigidBody>(null);
  const modelRef = useRef<Group>(null);
  const { world, rapier } = useRapier();
  const groundRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier]);
  const motion = useRef<HumanoidMotion>({ speed: 0 }).current;
  const facing = useRef(Math.PI);
  const wasDriving = useRef(false);

  useEffect(() => {
    runtime.player.body = bodyRef.current;
    return () => {
      runtime.player.body = null;
    };
  }, []);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const model = modelRef.current;
    if (!body || !model) return;
    const dt = Math.min(delta, 0.05);
    const { mode, dialog } = useGameStore.getState();

    // Enter / exit the car: park the body while driving, drop it next to the car afterwards.
    const driving = mode === 'driving';
    if (driving !== wasDriving.current) {
      wasDriving.current = driving;
      model.visible = !driving;
      if (driving) {
        body.setEnabled(false);
      } else {
        const { position: car, yaw } = runtime.car;
        const left = { x: Math.cos(yaw), z: -Math.sin(yaw) };
        body.setTranslation(
          { x: car.x + left.x * EXIT_SIDE_OFFSET, y: car.y + 1.2, z: car.z + left.z * EXIT_SIDE_OFFSET },
          true,
        );
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setEnabled(true);
      }
    }
    if (driving) return;

    const position = body.translation();
    runtime.player.position.set(position.x, position.y, position.z);
    if (position.y < WORLD.fallResetY) {
      body.setTranslation({ x: PLAYER.spawn[0], y: PLAYER.spawn[1], z: PLAYER.spawn[2] }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    // Camera-relative direction: "forward" is where the camera looks.
    const input = dialog ? IDLE_INPUT : readMoveInput();
    const { yaw } = runtime.camera;
    const dirX = -Math.sin(yaw) * input.y + Math.cos(yaw) * input.x;
    const dirZ = -Math.cos(yaw) * input.y - Math.sin(yaw) * input.x;
    const speed = input.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;

    const velocity = body.linvel();
    const blend = dampFactor(PLAYER.acceleration, dt);
    const vx = MathUtils.lerp(velocity.x, dirX * speed, blend);
    const vz = MathUtils.lerp(velocity.z, dirZ * speed, blend);
    let vy = velocity.y;
    if (input.jump && vy <= 0.5) {
      groundRay.origin = position;
      const hit = world.castRay(
        groundRay,
        FOOT_OFFSET + GROUND_TOLERANCE,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body,
      );
      if (hit) vy = PLAYER.jumpVelocity;
    }
    body.setLinvel({ x: vx, y: vy, z: vz }, true);

    // Turn the model toward the movement direction and drive the walk cycle.
    if (dirX * dirX + dirZ * dirZ > 0.01) facing.current = dampAngle(facing.current, Math.atan2(dirX, dirZ), 12, dt);
    model.rotation.y = facing.current;
    motion.speed = Math.hypot(vx, vz);
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={PLAYER.spawn}
      enabledRotations={[false, false, false]}
      canSleep={false}
    >
      <CapsuleCollider args={[PLAYER.halfHeight, PLAYER.radius]} friction={0} />
      <group ref={modelRef} position-y={-FOOT_OFFSET}>
        <Humanoid color="#f3efe6" pantsColor="#1f3b5c" motion={motion} />
      </group>
    </RigidBody>
  );
}
