// Gameplay tunables in one place. Units: meters, seconds, radians.
import type { Vec3 } from './math';

export const WORLD = {
  gravity: -18,
  /** Anything that falls below this height is respawned. */
  fallResetY: -25,
} as const;

export const PLAYER = {
  spawn: [0, 1.2, 9] as Vec3,
  /** Capsule: total height = 2 * (halfHeight + radius). */
  halfHeight: 0.55,
  radius: 0.35,
  walkSpeed: 4.5,
  runSpeed: 8.5,
  acceleration: 12,
  jumpVelocity: 7.5,
} as const;

export const CAR = {
  spawn: [20, 0.6, 3] as Vec3,
  spawnYaw: Math.PI,
  maxSpeed: 24,
  maxReverseSpeed: 7,
  acceleration: 12,
  brakeDeceleration: 28,
  /** Rolling resistance when no pedal is pressed. */
  drag: 0.6,
  turnRate: 2.1,
  /** How fast sideways slip is removed; lower = more drift. */
  grip: 8,
  handbrakeGrip: 1.5,
} as const;

export const INTERACTION = {
  npcRadius: 3,
  carRadius: 3.5,
} as const;

export const CAMERA = {
  distance: 6.5,
  drivingDistance: 9,
  minDistance: 3,
  maxDistance: 16,
  pitch: 0.32,
  minPitch: 0.05,
  maxPitch: 1.2,
  /** Height of the look-at point above the followed body. */
  targetHeight: 1.4,
  orbitSensitivity: 0.005,
} as const;

/** `?debug` in the URL shows physics colliders and an FPS meter. */
export const DEBUG = new URLSearchParams(window.location.search).has('debug');
