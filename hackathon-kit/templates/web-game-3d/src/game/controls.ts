/**
 * Unified player input: keyboard on desktop, on-screen controls on touch devices.
 *
 * - Movement is polled every frame with `readMoveInput()`.
 * - Discrete actions (talk, enter/exit car, cancel) are events: `onInputAction()`.
 *
 * Keys are matched by `KeyboardEvent.code` (physical position), so WASD also works
 * with the Russian (ЙЦУКЕН) layout. Keys typed into text fields are ignored.
 */
export type InputAction = 'interact' | 'toggleVehicle' | 'cancel';

export interface MoveInput {
  /** Strafe / steering, -1 (left) .. 1 (right). */
  x: number;
  /** Forward / throttle, -1 (back) .. 1 (forward). */
  y: number;
  sprint: boolean;
  jump: boolean;
}

export const IDLE_INPUT: Readonly<MoveInput> = { x: 0, y: 0, sprint: false, jump: false };

const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
} as const;

const ACTION_KEYS: Readonly<Record<string, InputAction>> = {
  KeyE: 'interact',
  KeyF: 'toggleVehicle',
  Escape: 'cancel',
};

/** Written by the on-screen controls (src/ui/TouchControls.tsx). */
export const touchInput: MoveInput = { x: 0, y: 0, sprint: false, jump: false };

const pressedKeys = new Set<string>();
const actionListeners = new Map<InputAction, Set<() => void>>();

const isPressed = (codes: readonly string[]) => codes.some((code) => pressedKeys.has(code));

export function readMoveInput(): MoveInput {
  let x = Number(isPressed(MOVE_KEYS.right)) - Number(isPressed(MOVE_KEYS.left)) + touchInput.x;
  let y = Number(isPressed(MOVE_KEYS.forward)) - Number(isPressed(MOVE_KEYS.backward)) + touchInput.y;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return {
    x,
    y,
    sprint: isPressed(MOVE_KEYS.sprint) || touchInput.sprint,
    jump: isPressed(MOVE_KEYS.jump) || touchInput.jump,
  };
}

/** Subscribes to a discrete action; returns the unsubscribe function. */
export function onInputAction(action: InputAction, listener: () => void): () => void {
  const listeners = actionListeners.get(action) ?? new Set();
  listeners.add(listener);
  actionListeners.set(action, listeners);
  return () => listeners.delete(listener);
}

export function triggerInputAction(action: InputAction): void {
  actionListeners.get(action)?.forEach((listener) => listener());
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

/** Installs the keyboard listeners; returns a cleanup function. */
export function attachKeyboard(target: Window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const action = ACTION_KEYS[event.code];
    if (isTextField(event.target)) {
      if (action === 'cancel') triggerInputAction('cancel');
      return;
    }
    if (action) {
      // preventDefault stops the key from also typing into a field focused by the action.
      event.preventDefault();
      if (!event.repeat) triggerInputAction(action);
      return;
    }
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    pressedKeys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.code);
  // Releasing keys while the window is unfocused would otherwise leave them "stuck".
  const releaseAll = () => pressedKeys.clear();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', releaseAll);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', releaseAll);
  };
}
