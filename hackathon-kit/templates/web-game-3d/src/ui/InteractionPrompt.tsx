import { findNpc } from '../game/npcs';
import { useGameStore } from '../state/store';

/** Context prompt near interactable things: «Нажми E — поговорить», «Нажми F — сесть в машину». */
export function InteractionPrompt() {
  const nearbyNpcId = useGameStore((state) => state.nearbyNpcId);
  const nearCar = useGameStore((state) => state.nearCar);
  const busy = useGameStore((state) => state.dialog !== null || state.mode === 'driving');
  if (busy) return null;

  const npc = nearbyNpcId ? findNpc(nearbyNpcId) : undefined;
  if (npc) {
    return (
      <div className="prompt" role="status">
        Нажми <kbd>E</kbd> — поговорить <span className="prompt-target">{npc.name}</span>
      </div>
    );
  }
  if (nearCar) {
    return (
      <div className="prompt" role="status">
        Нажми <kbd>F</kbd> — сесть в машину
      </div>
    );
  }
  return null;
}
