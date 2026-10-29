/**
 * Mock mode: a deterministic stand-in for the LLM. The same request always gets
 * the same reply, so demos work without an API key and are repeatable. It fills
 * every response field, including actions, relationship changes and memories,
 * and reacts to memories and recent world events like the real model would.
 */
import { NO_ACTION, type Emotion, type GameAction, type NpcReply, type NpcRequest } from '../../src/ai/protocol.js';
import type { NpcDefinition } from '../../src/game/npcs.js';

interface MockContext {
  npc: NpcDefinition;
  input: NpcRequest;
  /** Deterministic choice based on the request. */
  pick: <T>(options: readonly [T, ...T[]]) => T;
}

interface MockRule {
  pattern: RegExp;
  respond: (context: MockContext) => NpcReply;
}

// Checked in order; the first matching pattern wins.
const RULES: readonly MockRule[] = [
  {
    pattern: /дура|идиот|тупой|отвали|заткнись|stupid|idiot|shut up/i,
    respond: ({ pick }) =>
      reply(pick(['Следи за языком.', 'Ещё одно слово в таком тоне — и разговор окончен.']), 'angry', {
        delta: -6,
        remember: ['Грубил мне'],
      }),
  },
  {
    pattern: /взятк|договоримся|на лапу|bribe/i,
    respond: () =>
      reply('Я сделаю вид, что этого не слышал.', 'suspicious', { delta: -4, remember: ['Предлагал взятку'] }),
  },
  {
    pattern: /работ|задани|квест|подзаработ|помочь|помощь|job|work|quest|help/i,
    respond: ({ npc, input }) => {
      const current = input.gameState.activeQuests.find((quest) => quest.giverNpcId === npc.id);
      if (current) {
        return reply(`Сначала закончи «${current.title}», потом поговорим.`, 'suspicious', { delta: -1 });
      }
      return reply(`Есть дело. ${npc.sampleQuest.description} Плачу $${npc.sampleQuest.reward}.`, 'happy', {
        action: { type: 'give_quest', payload: npc.sampleQuest },
        delta: 2,
        remember: ['Искал у меня работу'],
      });
    },
  },
  {
    pattern: /денег|деньги|займ|одолжи|в долг|money|loan/i,
    respond: ({ input }) =>
      input.npcState.relationship >= 20
        ? reply('Ладно, держи немного. Для своих не жалко.', 'happy', {
            action: { type: 'give_money', payload: { amount: 50, reason: 'Помощь другу' } },
            remember: ['Занимал у меня деньги'],
          })
        : reply('Деньги надо заработать. Спроси про работу.', 'suspicious', {
            delta: -1,
            remember: ['Просил у меня денег'],
          }),
  },
  {
    pattern: /купить|куплю|возьму|продай|заплачу|buy|pay/i,
    respond: () =>
      reply('Договорились, с тебя сорок баксов.', 'happy', {
        action: { type: 'take_money', payload: { amount: 40, reason: 'Покупка' } },
        delta: 1,
      }),
  },
  {
    pattern: /спасибо|благодар|рахмет|thanks|thank you/i,
    respond: ({ pick }) => reply(pick(['Всегда пожалуйста!', 'Обращайся, если что.']), 'happy', { delta: 3 }),
  },
  {
    pattern: /привет|здравств|салам|сәлем|hello|\bhi\b/i,
    respond: ({ npc, input }) => {
      const lastMemory = input.npcState.memories.at(-1);
      if (input.npcState.relationship <= -20) return reply('Опять ты? Чего надо?', 'suspicious');
      if (lastMemory) return reply(`О, снова ты! Помню-помню: ${lowerFirst(lastMemory)}.`, 'happy', { delta: 1 });
      return reply(`Привет! Я ${npc.name}, ${npc.role}. Чем могу помочь?`, 'happy', { delta: 1 });
    },
  },
];

/** Events old enough to be gossip rather than noise. */
const RECENT_EVENT_SECONDS = 180;

export function mockNpcReply(npc: NpcDefinition, input: NpcRequest): NpcReply {
  const seed = hashString(`${npc.id}|${input.history.length}|${input.playerMessage}`);
  const context: MockContext = { npc, input, pick: (options) => options[seed % options.length] ?? options[0] };

  const rule = RULES.find(({ pattern }) => pattern.test(input.playerMessage));
  if (rule) return rule.respond(context);

  const latestEvent = input.gameState.recentEvents.at(-1);
  if (latestEvent && latestEvent.secondsAgo <= RECENT_EVENT_SECONDS) {
    return reply(`Видел-видел: «${latestEvent.text}». В нашем районе ничего не скроешь.`, 'neutral');
  }
  return reply(
    context.pick(['Хм, интересно. Расскажи подробнее.', 'Понимаю. Что-нибудь ещё?', 'Ну, в Open City и не такое бывает.']),
    'neutral',
  );
}

function reply(
  text: string,
  emotion: Emotion,
  extra: { action?: GameAction; delta?: number; remember?: string[] } = {},
): NpcReply {
  return {
    reply: text,
    emotion,
    action: extra.action ?? NO_ACTION,
    relationshipDelta: extra.delta ?? 0,
    remember: extra.remember ?? [],
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** FNV-1a: tiny, stable string hash. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
