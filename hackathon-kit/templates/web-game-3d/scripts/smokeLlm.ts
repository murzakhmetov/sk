/**
 * One real LLM round-trip through api/_lib/llm.ts, using the production NPC
 * prompt and schema. Prints model, latency, token usage and the parsed JSON.
 *
 *   1. put ANTHROPIC_API_KEY into .env.local
 *   2. npm run smoke:llm
 */
import { loadEnv } from 'vite';
import { NpcReplySchema, type NpcRequest } from '../src/ai/protocol.js';
import { findNpc } from '../src/game/npcs.js';
import { callStructured, LlmError, resolveModel } from '../api/_lib/llm.js';
import { buildNpcMessages, buildNpcSystemPrompt } from '../api/_lib/npcPrompt.js';

for (const [key, value] of Object.entries(loadEnv('development', process.cwd(), ''))) {
  process.env[key] ??= value;
}

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).');
  process.exit(1);
}

const npc = findNpc('foreman');
if (!npc) throw new Error('NPC "foreman" is missing from src/game/npcs.ts');

const request: NpcRequest = {
  npcId: npc.id,
  history: [{ role: 'npc', text: npc.greeting }],
  playerMessage: 'Привет! Есть для меня работа?',
  gameState: {
    money: 500,
    activeQuests: [],
    recentEvents: [{ type: 'vehicle', text: 'Сел в машину', secondsAgo: 40 }],
  },
  npcState: { relationship: 0, memories: [] },
};

console.log(`Calling ${resolveModel()} as "${npc.name}"...`);
try {
  const result = await callStructured({
    system: buildNpcSystemPrompt(npc),
    messages: buildNpcMessages(request),
    schema: NpcReplySchema,
  });
  console.log(`model:   ${result.model}`);
  console.log(`latency: ${result.latencyMs} ms`);
  console.log(`tokens:  ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  console.log(JSON.stringify(result.data, null, 2));
} catch (error) {
  console.error(error instanceof LlmError ? `LLM call failed [${error.kind}]: ${error.message}` : error);
  process.exitCode = 1;
}
