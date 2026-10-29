import { z } from 'zod';
import { NpcSocialStateSchema, type NpcSocialState } from '../ai/protocol';

/** Bump the version suffix when the stored shape changes; old data is then ignored. */
const STORAGE_KEY = 'web-game-3d/npc-state/v1';
const StoredSchema = z.record(z.string(), NpcSocialStateSchema);

/** Loads per-NPC relationship and memories. Missing, corrupted or blocked storage yields a fresh start. */
export function loadNpcStates(): Record<string, NpcSocialState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function saveNpcStates(states: Record<string, NpcSocialState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Storage full or disabled (private mode): the game still works, it just won't remember.
  }
}
