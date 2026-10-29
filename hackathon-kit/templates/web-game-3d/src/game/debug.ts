import { useGameStore } from '../state/store';
import { runtime } from './runtime';

/** Dev-only hooks for the browser console and automated checks, e.g. `__game.teleport(-6, -3)`. */
export interface DebugApi {
  store: typeof useGameStore;
  teleport: (x: number, z: number) => void;
}

declare global {
  interface Window {
    __game?: DebugApi;
  }
}

export function installDebugHooks(): void {
  window.__game = {
    store: useGameStore,
    teleport: (x, z) => {
      const body = runtime.player.body;
      body?.setTranslation({ x, y: 1.2, z }, true);
      body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    },
  };
}
