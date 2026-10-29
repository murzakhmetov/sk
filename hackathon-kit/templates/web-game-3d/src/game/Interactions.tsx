import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { useGameStore } from '../state/store';
import { INTERACTION } from './config';
import { onInputAction } from './controls';
import { NPCS } from './npcs';
import { runtime } from './runtime';

/**
 * Renderless system: tracks what the player can interact with (nearest NPC, car)
 * and maps input actions to game commands (talk, enter/exit car, close dialog).
 */
export function InteractionSystem() {
  useFrame(() => {
    const { mode, nearbyNpcId, nearCar, setProximity } = useGameStore.getState();
    const player = runtime.player.position;
    const npcId = mode === 'onFoot' ? findNearestNpcId(player.x, player.z) : null;
    const carInReach =
      mode === 'onFoot' && horizontalDistance(player, runtime.car.position) < INTERACTION.carRadius;
    // Store updates only on change, so the UI re-renders only when the prompt changes.
    if (npcId !== nearbyNpcId || carInReach !== nearCar) setProximity(npcId, carInReach);
  });

  useEffect(() => {
    const unsubscribers = [
      onInputAction('interact', () => {
        const { dialog, mode, nearbyNpcId, openDialog } = useGameStore.getState();
        if (!dialog && mode === 'onFoot' && nearbyNpcId) openDialog(nearbyNpcId);
      }),
      onInputAction('toggleVehicle', () => {
        const { dialog, mode, nearCar, enterCar, exitCar } = useGameStore.getState();
        if (dialog) return;
        if (mode === 'driving') exitCar();
        else if (nearCar) enterCar();
      }),
      onInputAction('cancel', () => useGameStore.getState().closeDialog()),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  return null;
}

function findNearestNpcId(x: number, z: number): string | null {
  let nearest: string | null = null;
  let best: number = INTERACTION.npcRadius;
  for (const npc of NPCS) {
    const distance = Math.hypot(npc.position[0] - x, npc.position[2] - z);
    if (distance < best) {
      best = distance;
      nearest = npc.id;
    }
  }
  return nearest;
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
