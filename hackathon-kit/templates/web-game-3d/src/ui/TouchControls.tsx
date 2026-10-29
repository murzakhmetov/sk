import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { touchInput, triggerInputAction } from '../game/controls';
import { useGameStore } from '../state/store';
import { useIsTouchDevice } from './useIsTouchDevice';

/** Knob travel in px; pushing the stick all the way also sprints. */
const STICK_RADIUS = 56;
const SPRINT_THRESHOLD = 0.95;

/** On-screen controls for phones and tablets. Dragging elsewhere on the screen orbits the camera. */
export function TouchControls() {
  const isTouch = useIsTouchDevice();
  const dialogOpen = useGameStore((state) => state.dialog !== null);
  if (!isTouch || dialogOpen) return null;

  return (
    <div className="touch-controls">
      <TouchJoystick />
      <div className="touch-buttons">
        <button type="button" onPointerDown={() => triggerInputAction('interact')} aria-label="Говорить">
          E
        </button>
        <button type="button" onPointerDown={() => triggerInputAction('toggleVehicle')} aria-label="Машина">
          F
        </button>
        <button
          type="button"
          className="touch-jump"
          onPointerDown={() => (touchInput.jump = true)}
          onPointerUp={() => (touchInput.jump = false)}
          onPointerCancel={() => (touchInput.jump = false)}
          aria-label="Прыжок"
        >
          ⤒
        </button>
      </div>
    </div>
  );
}

function TouchJoystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  const release = () => {
    activePointer.current = null;
    Object.assign(touchInput, { x: 0, y: 0, sprint: false });
    if (knobRef.current) knobRef.current.style.transform = '';
  };

  // Never leave the player walking if the stick unmounts mid-drag (e.g. a dialog opens).
  useEffect(() => release, []);

  const move = (event: ReactPointerEvent) => {
    const base = baseRef.current;
    if (!base || event.pointerId !== activePointer.current) return;
    const rect = base.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS) {
      dx *= STICK_RADIUS / distance;
      dy *= STICK_RADIUS / distance;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    touchInput.x = dx / STICK_RADIUS;
    touchInput.y = -dy / STICK_RADIUS;
    touchInput.sprint = distance / STICK_RADIUS >= SPRINT_THRESHOLD;
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      onPointerDown={(event) => {
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div ref={knobRef} className="joystick-knob" />
    </div>
  );
}
