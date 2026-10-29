/**
 * Contract between the game client and the NPC dialog endpoint (`POST /api/npc`).
 *
 * Shared with the serverless API: keep this module free of browser and three.js
 * imports, and use `.js` extensions in relative imports (native ESM on Vercel).
 *
 * The zod schemas are the single source of truth for:
 * - request validation on the server (`NpcRequestSchema`);
 * - the structured output the LLM must produce (`NpcReplySchema`);
 * - response validation on the client (`NpcResponseSchema`).
 */
import { z } from 'zod';

export const LIMITS = {
  messageChars: 500,
  eventChars: 200,
  historyTurns: 20,
  recentEvents: 10,
  activeQuests: 20,
  memories: 8,
  memoryChars: 120,
  rememberPerReply: 2,
  relationshipDelta: 10,
  relationship: 100,
} as const;

export const EMOTIONS = ['neutral', 'happy', 'angry', 'suspicious', 'sad'] as const;
export const EmotionSchema = z.enum(EMOTIONS);
export type Emotion = z.infer<typeof EmotionSchema>;

// ---------------------------------------------------------------------------
// Game actions an NPC can trigger. To add one: add a variant below, handle it
// in `applyAction` (src/state/store.ts) and describe it in the NPC prompt
// (api/_lib/npcPrompt.ts). TypeScript flags any unhandled variant.
// ---------------------------------------------------------------------------

export const QuestOfferSchema = z.object({
  title: z.string().min(1).describe('Short quest title, 2-5 words'),
  description: z.string().min(1).describe('What the player has to do, 1-2 sentences'),
  reward: z.number().int().describe('Reward in $, 50-1000'),
});
export type QuestOffer = z.infer<typeof QuestOfferSchema>;

const MoneyTransferSchema = z.object({
  amount: z.number().int().describe('Amount in $, greater than 0'),
  reason: z.string().describe('What the money is for, 2-5 words'),
});

export const GameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none'), payload: z.null() }),
  z.object({ type: z.literal('give_quest'), payload: QuestOfferSchema }),
  z.object({ type: z.literal('give_money'), payload: MoneyTransferSchema }),
  z.object({ type: z.literal('take_money'), payload: MoneyTransferSchema }),
]);
export type GameAction = z.infer<typeof GameActionSchema>;

export const NO_ACTION = { type: 'none', payload: null } as const satisfies GameAction;

/**
 * One NPC turn, as produced by the LLM (or by mock mode).
 *
 * Structured outputs guarantee the JSON shape, but enum values and numeric ranges
 * reach the model only as hints. `.catch()` therefore downgrades a single bad
 * field to a safe default instead of discarding the whole reply, and the game
 * rules clamp numbers before applying them (see `evolveSocialState` in the store).
 */
export const NpcReplySchema = z.object({
  reply: z.string().min(1).describe("The NPC's spoken line, 1-3 short sentences"),
  emotion: EmotionSchema.describe('How the NPC feels saying this line').catch('neutral'),
  action: GameActionSchema.describe('Game effect of this turn; usually none').catch(NO_ACTION),
  relationshipDelta: z
    .number()
    .int()
    .describe("Change of the NPC's attitude to the player, from -10 to 10 (usually -3..3)")
    .catch(0),
  remember: z
    .array(z.string())
    .describe('0-2 short new facts about the player worth remembering; empty if nothing new')
    .catch([]),
});
export type NpcReply = z.infer<typeof NpcReplySchema>;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const ChatTurnSchema = z.object({
  role: z.enum(['player', 'npc']),
  text: z.string().min(1).max(LIMITS.messageChars),
});

/** Something the player did in the world, so NPCs can react to it. */
export const WorldEventSchema = z.object({
  type: z.string().max(32),
  text: z.string().max(LIMITS.eventChars),
  secondsAgo: z.number().int().min(0),
});

/** Long-term, per-NPC state of the adaptive layer (persisted on the client). */
export const NpcSocialStateSchema = z.object({
  relationship: z.number().int().min(-LIMITS.relationship).max(LIMITS.relationship),
  memories: z.array(z.string().max(LIMITS.memoryChars)).max(LIMITS.memories),
});
export type NpcSocialState = z.infer<typeof NpcSocialStateSchema>;

export const NpcRequestSchema = z.object({
  npcId: z.string().min(1).max(64),
  history: z.array(ChatTurnSchema).max(LIMITS.historyTurns),
  playerMessage: z.string().trim().min(1).max(LIMITS.messageChars),
  gameState: z.object({
    money: z.number().int().min(0),
    activeQuests: z
      .array(z.object({ title: z.string().max(120), giverNpcId: z.string().max(64) }))
      .max(LIMITS.activeQuests),
    recentEvents: z.array(WorldEventSchema).max(LIMITS.recentEvents),
  }),
  npcState: NpcSocialStateSchema,
});
export type NpcRequest = z.infer<typeof NpcRequestSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** `llm` = real model, `mock` = canned reply (no key), `fallback` = graceful error reply. */
export const REPLY_SOURCES = ['llm', 'mock', 'fallback'] as const;
export type ReplySource = (typeof REPLY_SOURCES)[number];

export const NpcResponseSchema = NpcReplySchema.extend({ source: z.enum(REPLY_SOURCES) });
export type NpcResponse = z.infer<typeof NpcResponseSchema>;
