import { Sky } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3, type DirectionalLight } from 'three';
import { runtime } from './runtime';

const SUN_OFFSET = new Vector3(40, 70, 25);
const HAZE_COLOR = '#c7d6e2';
/** Half-size of the shadow camera: shadows are sharp near the player and absent far away. */
const SHADOW_EXTENT = 45;

/**
 * Sky, fog and lights. The sun follows the camera focus so a small shadow map
 * covers what the player actually sees, instead of the whole city.
 */
export function Lighting() {
  const sunRef = useRef<DirectionalLight>(null);

  useFrame(() => {
    const sun = sunRef.current;
    if (!sun) return;
    sun.position.copy(runtime.focus).add(SUN_OFFSET);
    sun.target.position.copy(runtime.focus);
    sun.target.updateMatrixWorld();
  });

  return (
    <>
      <color attach="background" args={[HAZE_COLOR]} />
      <fog attach="fog" args={[HAZE_COLOR, 70, 300]} />
      <Sky sunPosition={SUN_OFFSET.toArray()} turbidity={7} rayleigh={1.4} mieCoefficient={0.006} mieDirectionalG={0.8} />
      <hemisphereLight args={['#dcebff', '#5b5348', 1.3]} />
      <directionalLight
        ref={sunRef}
        castShadow
        intensity={2.4}
        color="#fff1dc"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
    </>
  );
}
