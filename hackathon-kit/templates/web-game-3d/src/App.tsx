import { useEffect } from 'react';
import { attachKeyboard } from './game/controls';
import { GameScene } from './game/GameScene';
import { DialogPanel } from './ui/DialogPanel';
import { Hud } from './ui/Hud';
import { InteractionPrompt } from './ui/InteractionPrompt';
import { TouchControls } from './ui/TouchControls';

export function App() {
  useEffect(() => attachKeyboard(window), []);

  return (
    <div className="app">
      {/* Sits behind the canvas and is covered as soon as the world renders. */}
      <div className="loading">Загружаем город…</div>
      <GameScene />
      <Hud />
      <InteractionPrompt />
      <DialogPanel />
      <TouchControls />
    </div>
  );
}
