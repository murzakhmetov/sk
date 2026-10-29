import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS, type NpcSocialState } from '../ai/protocol';
import { findNpc, type NpcDefinition } from '../game/npcs';
import { NEUTRAL_SOCIAL_STATE, useGameStore, type DialogMessage } from '../state/store';
import { EMOTION_EMOJI, EMOTION_LABEL, relationshipLabel } from './emotion';

const NO_MESSAGES: DialogMessage[] = [];

/** Chat with the NPC the player is talking to. Esc or × closes it. */
export function DialogPanel() {
  const dialog = useGameStore((state) => state.dialog);
  const npc = dialog ? findNpc(dialog.npcId) : undefined;
  if (!dialog || !npc) return null;
  // Keyed by NPC so the draft and scroll position reset when the partner changes.
  return <DialogWindow key={npc.id} npc={npc} pending={dialog.pending} />;
}

function DialogWindow({ npc, pending }: { npc: NpcDefinition; pending: boolean }) {
  const messages = useGameStore((state) => state.conversations[npc.id]) ?? NO_MESSAGES;
  const social = useGameStore((state) => state.npcStates[npc.id]) ?? NEUTRAL_SOCIAL_STATE;
  const sendPlayerMessage = useGameStore((state) => state.sendPlayerMessage);
  const closeDialog = useGameStore((state) => state.closeDialog);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emotion = messages.findLast((message) => message.role === 'npc')?.emotion ?? 'neutral';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending]);

  useEffect(() => {
    // On touch devices focusing would pop the keyboard over the scene; let the player tap instead.
    if (!pending && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || !draft.trim()) return;
    void sendPlayerMessage(draft);
    setDraft('');
  };

  return (
    <aside className="panel dialog" aria-label={`Разговор: ${npc.name}`}>
      <header className="dialog-header">
        <span className="dialog-emotion" title={EMOTION_LABEL[emotion]} aria-label={EMOTION_LABEL[emotion]}>
          {EMOTION_EMOJI[emotion]}
        </span>
        <div className="dialog-title">
          <strong>{npc.name}</strong>
          <small>{npc.role}</small>
        </div>
        <RelationshipMeter {...social} />
        <button type="button" className="icon-button" onClick={closeDialog} aria-label="Закрыть (Esc)">
          ×
        </button>
      </header>

      <div className="dialog-messages" ref={listRef}>
        {messages.map((message, index) => (
          <p key={index} className={`message message-${message.role}`}>
            {message.text}
            {message.source && message.source !== 'llm' && <span className="message-source">{message.source}</span>}
          </p>
        ))}
        {pending && <p className="message message-npc message-typing">печатает…</p>}
      </div>

      <form className="dialog-input" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={LIMITS.messageChars}
          placeholder="Напиши реплику…"
          aria-label="Твоя реплика"
          disabled={pending}
        />
        <button type="submit" disabled={pending || !draft.trim()}>
          Отправить
        </button>
      </form>
    </aside>
  );
}

/** Attitude bar from -100 to 100; hover shows what the NPC remembers about the player. */
function RelationshipMeter({ relationship, memories }: NpcSocialState) {
  const width = `${Math.abs(relationship) / 2}%`;
  const tooltip = memories.length > 0 ? `Помнит:\n• ${memories.join('\n• ')}` : 'Пока ничего о тебе не помнит';
  return (
    <div className="relationship" title={tooltip}>
      <div className="relationship-label">
        {relationshipLabel(relationship)}{' '}
        <strong>{relationship > 0 ? `+${relationship}` : relationship}</strong>
        {memories.length > 0 && <span className="relationship-memories"> · 🧠 {memories.length}</span>}
      </div>
      <div className="relationship-bar" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={relationship}>
        <span
          className={relationship >= 0 ? 'positive' : 'negative'}
          style={relationship >= 0 ? { left: '50%', width } : { right: '50%', width }}
        />
      </div>
    </div>
  );
}
