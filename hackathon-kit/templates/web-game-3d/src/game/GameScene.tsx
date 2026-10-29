import { Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense } from 'react';
import { Car } from './Car';
import { DEBUG, WORLD } from './config';
import { FollowCamera } from './FollowCamera';
import { InteractionSystem } from './Interactions';
import { Lighting } from './Lighting';
import { Npcs } from './Npc';
import { Player } from './Player';
import { Props } from './Props';
import { TriggerZones } from './TriggerZone';
import { World } from './World';

/** The 3D scene. Physics (Rapier WASM) loads asynchronously, hence the Suspense boundary. */
export function GameScene() {
  return (
    <Canvas
      className="game-canvas"
      shadows="percentage"
      dpr={[1, 1.75]}
      camera={{ fov: 60, near: 0.3, far: 450, position: [0, 4, 16] }}
      gl={{ powerPreference: 'high-performance' }}
    >
      <Suspense fallback={null}>
        <Lighting />
        <Physics gravity={[0, WORLD.gravity, 0]} debug={DEBUG}>
          <World />
          <Props />
          <TriggerZones />
          <Npcs />
          <Car />
          <Player />
          <FollowCamera />
          <InteractionSystem />
        </Physics>
      </Suspense>
      {DEBUG && <Stats />}
    </Canvas>
  );
}
