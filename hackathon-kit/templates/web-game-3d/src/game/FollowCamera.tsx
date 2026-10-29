import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useGameStore } from '../state/store';
import { CAMERA } from './config';
import { clamp, dampAngle, dampFactor } from './math';
import { runtime } from './runtime';

/** After the player orbits manually, wait this long before re-centering behind the car. */
const AUTO_CENTER_DELAY_MS = 1500;
/** Keep the camera this far in front of walls it would otherwise clip into. */
const WALL_PADDING = 0.3;

/**
 * Third-person orbit camera. Drag (mouse or touch) to orbit, wheel to zoom.
 * Follows the player on foot and the car while driving, and pulls in when a
 * building is between the camera and the target.
 */
export function FollowCamera() {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const { world, rapier } = useRapier();
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const smoothedFocus = useMemo(() => runtime.player.position.clone(), []);
  const lookAt = useMemo(() => new Vector3(), []);
  const offset = useMemo(() => new Vector3(), []);
  const lastOrbitAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    let activePointer: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (activePointer !== null) return;
      activePointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      const cam = runtime.camera;
      cam.yaw -= (event.clientX - lastX) * CAMERA.orbitSensitivity;
      cam.pitch = clamp(cam.pitch + (event.clientY - lastY) * CAMERA.orbitSensitivity, CAMERA.minPitch, CAMERA.maxPitch);
      lastX = event.clientX;
      lastY = event.clientY;
      lastOrbitAt.current = performance.now();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId === activePointer) activePointer = null;
    };
    const onWheel = (event: WheelEvent) => {
      const cam = runtime.camera;
      cam.distance = clamp(cam.distance + Math.sign(event.deltaY) * 0.8, CAMERA.minDistance, CAMERA.maxDistance);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [canvas]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const cam = runtime.camera;
    const driving = useGameStore.getState().mode === 'driving';
    const target = driving ? runtime.car.position : runtime.player.position;

    smoothedFocus.lerp(target, dampFactor(driving ? 10 : 14, dt));
    runtime.focus.copy(smoothedFocus);
    lookAt.copy(smoothedFocus).y += CAMERA.targetHeight;

    // While driving, swing back behind the car unless the player is looking around.
    if (driving && performance.now() - lastOrbitAt.current > AUTO_CENTER_DELAY_MS) {
      cam.yaw = dampAngle(cam.yaw, runtime.car.yaw + Math.PI, 2.5, dt);
    }

    const distance = driving ? Math.max(cam.distance, CAMERA.drivingDistance) : cam.distance;
    offset.set(
      Math.sin(cam.yaw) * Math.cos(cam.pitch),
      Math.sin(cam.pitch),
      Math.cos(cam.yaw) * Math.cos(cam.pitch),
    );

    // Only static geometry blocks the view; the player, the car and crates do not.
    ray.origin = lookAt;
    ray.dir = offset;
    const hit = world.castRay(
      ray,
      distance,
      true,
      rapier.QueryFilterFlags.EXCLUDE_DYNAMIC | rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const clearDistance = hit ? Math.max(hit.timeOfImpact - WALL_PADDING, 0.8) : distance;

    camera.position.copy(lookAt).addScaledVector(offset, clearDistance);
    camera.lookAt(lookAt);
  });

  return null;
}
