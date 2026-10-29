/**
 * Game state and game rules (zustand). React components subscribe with selectors;
 * per-frame systems read it with `useGameStore.getState()` to avoid re-renders.
 */
import { create } from 'zustand';
import { requestNpcReply } from '../ai/npcClient';
import {
  LIMITS,
  type Emotion,
  type GameAction,
  type NpcReply,
  type NpcRequest,
  type NpcSocialState,
  type ReplySource,
} from '../ai/protocol';
import { clamp } from '../game/math';
import { findNpc } from '../game/npcs';
import { loadNpcStates, saveNpcStates } from './persistence';

export type GameEventType = 'system' | 'dialog' | 'quest' | 'money' | 'vehicle' | 'zone';

export interface GameEvent {
  id: number;
  type: GameEventType;
  text: string;
  /** Unix time in ms. */
  time: number;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  reward: number;
  giverNpcId: string;
}

export interface DialogMessage {
  role: 'player' | 'npc';
  text: string;
  emotion?: Emotion;
  source?: ReplySource;
}

export type PlayerMode = 'onFoot' | 'driving';

const START_MONEY = 500;
const MAX_EVENTS = 20;
/** Upper bound for one money action or quest reward, whatever the model says. */
const MAX_TRANSFER = 1000;

export const NEUTRAL_SOCIAL_STATE: NpcSocialState = { relationship: 0, memories: [] };

interface GameStore {
  money: number;
  quests: Quest[];
  /** Game event log: shown in the HUD and sent to NPCs as recent world events. */
  events: GameEvent[];
  /** Adaptive NPC layer: relationship and long-term memories per NPC id (persisted). */
  npcStates: Record<string, NpcSocialState>;
  /** Short-term dialog history per NPC id (current session only). */
  conversations: Record<string, DialogMessage[]>;
  dialog: { npcId: string; pending: boolean; playerTurns: number } | null;
  mode: PlayerMode;
  nearbyNpcId: string | null;
  nearCar: boolean;

  recordEvent: (type: GameEventType, text: string) => void;
  applyAction: (action: GameAction, npcId: string) => void;
  openDialog: (npcId: string) => void;
  closeDialog: () => void;
  sendPlayerMessage: (text: string) => Promise<void>;
  receiveNpcReply: (npcId: string, reply: NpcReply & { source: ReplySource }) => void;
  enterCar: () => void;
  exitCar: () => void;
  setProximity: (nearbyNpcId: string | null, nearCar: boolean) => void;
}

let nextEventId = 1;

export const useGameStore = create<GameStore>()((set, get) => ({
  money: START_MONEY,
  quests: [],
  events: [{ id: 0, type: 'system', text: 'Добро пожаловать в Open City! Подойди к жителю и нажми E.', time: Date.now() }],
  npcStates: loadNpcStates(),
  conversations: {},
  dialog: null,
  mode: 'onFoot',
  nearbyNpcId: null,
  nearCar: false,

  recordEvent: (type, text) =>
    set((state) => ({
      events: [...state.events, { id: nextEventId++, type, text: text.slice(0, LIMITS.eventChars), time: Date.now() }].slice(
        -MAX_EVENTS,
      ),
    })),

  applyAction: (action, npcId) => {
    const npcName = findNpc(npcId)?.name ?? npcId;
    switch (action.type) {
      case 'none':
        return;
      case 'give_quest': {
        const title = action.payload.title.slice(0, 80);
        if (get().quests.some((quest) => quest.giverNpcId === npcId && quest.title === title)) return;
        const quest: Quest = {
          id: `${npcId}-${Date.now()}`,
          title,
          description: action.payload.description.slice(0, 240),
          reward: clamp(Math.round(action.payload.reward), 0, MAX_TRANSFER),
          giverNpcId: npcId,
        };
        set((state) => ({ quests: [...state.quests, quest].slice(-LIMITS.activeQuests) }));
        get().recordEvent('quest', `Принял задание «${title}» от ${npcName}`);
        return;
      }
      case 'give_money': {
        const amount = clamp(Math.round(action.payload.amount), 0, MAX_TRANSFER);
        if (amount === 0) return;
        set((state) => ({ money: state.money + amount }));
        get().recordEvent('money', `Получил $${amount} от ${npcName}: ${action.payload.reason}`);
        return;
      }
      case 'take_money': {
        // Never more than the player has.
        const amount = clamp(Math.round(action.payload.amount), 0, Math.min(MAX_TRANSFER, get().money));
        if (amount === 0) return;
        set((state) => ({ money: state.money - amount }));
        get().recordEvent('money', `Заплатил $${amount} (${npcName}): ${action.payload.reason}`);
        return;
      }
      default:
        assertNever(action);
    }
  },

  openDialog: (npcId) => {
    const npc = findNpc(npcId);
    if (!npc) return;
    set((state) => ({
      dialog: { npcId, pending: false, playerTurns: 0 },
      conversations: state.conversations[npcId]
        ? state.conversations
        : { ...state.conversations, [npcId]: [{ role: 'npc', text: npc.greeting, emotion: 'neutral' }] },
    }));
  },

  closeDialog: () => {
    const { dialog } = get();
    if (!dialog) return;
    set({ dialog: null });
    const npc = findNpc(dialog.npcId);
    if (npc && dialog.playerTurns > 0) get().recordEvent('dialog', `Поговорил с ${npc.name} (${npc.role})`);
  },

  sendPlayerMessage: async (rawText) => {
    const text = rawText.trim().slice(0, LIMITS.messageChars);
    const { dialog } = get();
    if (!dialog || dialog.pending || !text) return;

    const { npcId } = dialog;
    const history = get().conversations[npcId] ?? [];
    set((state) => ({
      dialog: { ...dialog, pending: true, playerTurns: dialog.playerTurns + 1 },
      conversations: { ...state.conversations, [npcId]: [...history, { role: 'player', text }] },
    }));

    const reply = await requestNpcReply(buildNpcRequest(get(), npcId, history, text));
    get().receiveNpcReply(npcId, reply);
  },

  receiveNpcReply: (npcId, reply) => {
    set((state) => ({
      conversations: {
        ...state.conversations,
        [npcId]: [
          ...(state.conversations[npcId] ?? []),
          { role: 'npc', text: reply.reply, emotion: reply.emotion, source: reply.source },
        ],
      },
      npcStates: { ...state.npcStates, [npcId]: evolveSocialState(state.npcStates[npcId] ?? NEUTRAL_SOCIAL_STATE, reply) },
      // The dialog may have been closed (or switched) while the reply was on its way.
      dialog: state.dialog?.npcId === npcId ? { ...state.dialog, pending: false } : state.dialog,
    }));
    get().applyAction(reply.action, npcId);
  },

  enterCar: () => {
    if (get().mode === 'driving') return;
    set({ mode: 'driving', nearbyNpcId: null });
    get().recordEvent('vehicle', 'Сел в машину');
  },

  exitCar: () => {
    if (get().mode !== 'driving') return;
    set({ mode: 'onFoot' });
    get().recordEvent('vehicle', 'Вышел из машины');
  },

  setProximity: (nearbyNpcId, nearCar) => set({ nearbyNpcId, nearCar }),
}));

// Persist the adaptive NPC layer whenever it changes.
useGameStore.subscribe((state, previous) => {
  if (state.npcStates !== previous.npcStates) saveNpcStates(state.npcStates);
});

/**
 * Game rules for the adaptive layer: the model only proposes a relationship change
 * and new memories; they are clamped, trimmed and de-duplicated here before use.
 */
export function evolveSocialState(
  current: NpcSocialState,
  reply: Pick<NpcReply, 'relationshipDelta' | 'remember'>,
): NpcSocialState {
  const delta = clamp(Math.round(reply.relationshipDelta), -LIMITS.relationshipDelta, LIMITS.relationshipDelta);
  const facts = reply.remember
    .map((fact) => fact.trim().slice(0, LIMITS.memoryChars))
    .filter((fact, index, all) => fact.length > 0 && !current.memories.includes(fact) && all.indexOf(fact) === index)
    .slice(0, LIMITS.rememberPerReply);
  return {
    relationship: clamp(current.relationship + delta, -LIMITS.relationship, LIMITS.relationship),
    memories: [...current.memories, ...facts].slice(-LIMITS.memories),
  };
}

/** Everything the NPC needs to answer: dialog history, game state, its memory and recent world events. */
function buildNpcRequest(state: GameStore, npcId: string, history: DialogMessage[], playerMessage: string): NpcRequest {
  const now = Date.now();
  return {
    npcId,
    history: history
      .slice(-LIMITS.historyTurns)
      .map(({ role, text }) => ({ role, text: text.slice(0, LIMITS.messageChars) })),
    playerMessage,
    gameState: {
      money: state.money,
      activeQuests: state.quests.map(({ title, giverNpcId }) => ({ title, giverNpcId })),
      recentEvents: state.events
        .filter((event) => event.type !== 'system')
        .slice(-LIMITS.recentEvents)
        .map((event) => ({
          type: event.type,
          text: event.text,
          secondsAgo: Math.max(0, Math.round((now - event.time) / 1000)),
        })),
    },
    npcState: state.npcStates[npcId] ?? NEUTRAL_SOCIAL_STATE,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled game action: ${JSON.stringify(value)}`);
}
