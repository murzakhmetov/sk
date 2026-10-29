import type { GameEventType } from '../state/store';
import type { Vec3 } from './math';

/** A trigger zone: walking into it records an event (see TriggerZone.tsx). */
export interface ZoneDefinition {
  id: string;
  label: string;
  /** Center of the zone on the ground. */
  position: Vec3;
  radius: number;
  color: string;
  event: { type: GameEventType; text: string };
}

export const ZONES: readonly ZoneDefinition[] = [
  {
    id: 'job-center',
    label: 'Биржа труда',
    position: [0, 0, -11],
    radius: 1.6,
    color: '#38d6a0',
    event: { type: 'zone', text: 'Зашёл на биржу труда: бригадир Михалыч ищет работников' },
  },
];
