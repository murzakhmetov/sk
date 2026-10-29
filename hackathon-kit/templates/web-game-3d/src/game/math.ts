// Small isomorphic math helpers and shared value types (no three.js, safe for the server).

export type Vec3 = readonly [x: number, y: number, z: number];

/** Transform of one instance in an instanced mesh: position is the center, scale the full size. */
export interface InstanceTransform {
  position: Vec3;
  scale?: Vec3;
  rotationY?: number;
  color?: string;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Frame-rate independent smoothing factor for `lerp(current, target, factor)`. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

/** Smoothly turns angle `from` toward `to` along the shortest arc. */
export function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * dampFactor(lambda, dt);
}
