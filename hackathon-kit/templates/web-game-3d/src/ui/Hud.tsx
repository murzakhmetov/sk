import { useGameStore, type GameEventType } from '../state/store';
import { useIsTouchDevice } from './useIsTouchDevice';

const EVENT_ICON: Record<GameEventType, string> = {
  system: 'ℹ️',
  dialog: '💬',
  quest: '📜',
  money: '💵',
  vehicle: '🚗',
  zone: '📍',
};
const VISIBLE_EVENTS = 6;

/** Always-on overlay: money, active quests, event log and a controls hint. */
export function Hud() {
  const money = useGameStore((state) => state.money);
  const quests = useGameStore((state) => state.quests);
  const events = useGameStore((state) => state.events);

  return (
    <div className="hud">
      <section className="panel hud-status">
        <div className="hud-money" aria-label="Деньги">
          ${money.toLocaleString('ru-RU')}
        </div>
        <h2>Задания</h2>
        {quests.length === 0 ? (
          <p className="muted">Пока нет. Спроси жителей о работе.</p>
        ) : (
          <ul className="quest-list">
            {quests.map((quest) => (
              <li key={quest.id}>
                <div>
                  <strong>{quest.title}</strong>
                  <span className="reward">${quest.reward}</span>
                </div>
                <small>{quest.description}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel hud-log" aria-live="polite">
        <h2>События</h2>
        <ul>
          {events
            .slice(-VISIBLE_EVENTS)
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <span aria-hidden>{EVENT_ICON[event.type]}</span> {event.text}
              </li>
            ))}
        </ul>
      </section>

      <ControlsHint />
    </div>
  );
}

function ControlsHint() {
  const driving = useGameStore((state) => state.mode === 'driving');
  const isTouch = useIsTouchDevice();
  if (isTouch) return null;
  const hints = driving
    ? ['W/S — газ и тормоз', 'A/D — руль', 'Space — ручник', 'F — выйти']
    : ['WASD — ходьба', 'Shift — бег', 'Space — прыжок', 'E — говорить', 'F — машина', 'мышь — камера', 'колесо — зум'];
  return <div className="controls-hint">{hints.join('  ·  ')}</div>;
}
