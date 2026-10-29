import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CapsuleCollider, RigidBody } from '@react-three/rapier';
import { useRef } from 'react';
import type { Group } from 'three';
import { useGameStore } from '../state/store';
import { EMOTION_EMOJI } from '../ui/emotion';
import { Humanoid } from './Humanoid';
import { dampAngle } from './math';
import { NPCS, type NpcDefinition } from './npcs';
import { runtime } from './runtime';

export function Npcs() {
  return (
    <>
      {NPCS.map((npc) => (
        <Npc key={npc.id} npc={npc} />
      ))}
    </>
  );
}

/** A static NPC: turns to face the player when nearby and shows a name tag with its current emotion. */
function Npc({ npc }: { npc: NpcDefinition }) {
  const modelRef = useRef<Group>(null);
  const isNearby = useGameStore((state) => state.nearbyNpcId === npc.id);
  const inDialog = useGameStore((state) => state.dialog?.npcId === npc.id);
  const emotion = useGameStore((state) => state.conversations[npc.id]?.at(-1)?.emotion);
  const [x, , z] = npc.position;

  useFrame((_, delta) => {
    const model = modelRef.current;
    if (!model) return;
    const player = runtime.player.position;
    const target = isNearby || inDialog ? Math.atan2(player.x - x, player.z - z) : npc.facing;
    model.rotation.y = dampAngle(model.rotation.y, target, 6, Math.min(delta, 0.05));
  });

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={npc.position}>
        <CapsuleCollider args={[0.55, 0.35]} position={[0, 0.9, 0]} />
      </RigidBody>
      <group position={npc.position}>
        <group ref={modelRef} rotation-y={npc.facing}>
          <Humanoid color={npc.color} />
        </group>
        <Html position={[0, 2.3, 0]} center distanceFactor={12} zIndexRange={[10, 0]}>
          <div className={`nametag${isNearby || inDialog ? ' nametag-active' : ''}`}>
            <strong>
              {inDialog && emotion ? `${EMOTION_EMOJI[emotion]} ` : ''}
              {npc.name}
            </strong>
            <span>{npc.role}</span>
          </div>
        </Html>
      </group>
    </>
  );
}
