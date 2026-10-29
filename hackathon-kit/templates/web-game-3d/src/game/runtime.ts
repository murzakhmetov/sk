/**
 * Mutable per-frame state shared between scene systems (positions, camera angles).
 * It lives outside React and zustand on purpose: it changes every frame and
 * nothing should re-render because of it. Game state lives in src/state/store.ts.
 */
import type { RapierRigidBody } from '@react-three/rapier';
import { Vector3 } from 'three';
import { CAMERA, CAR, PLAYER } from './config';

interface TrackedBody {
  position: Vector3;
  body: RapierRigidBody | null;
}

export const runtime: {
  player: TrackedBody;
  car: TrackedBody & { yaw: number };
  camera: { yaw: number; pitch: number; distance: number };
  /** Smoothed point the camera (and the shadow-casting sun) follows. */
  focus: Vector3;
} = {
  player: { position: new Vector3(...PLAYER.spawn), body: null },
  car: { position: new Vector3(...CAR.spawn), body: null, yaw: CAR.spawnYaw },
  camera: { yaw: 0, pitch: CAMERA.pitch, distance: CAMERA.distance },
  focus: new Vector3(...PLAYER.spawn),
};
