/**
 * POST /api/npc: one dialog turn with an NPC.
 *
 * Runs as a Vercel Node.js function (Web-standard Request/Response handler);
 * `npm run dev` serves the same module through dev/apiDevPlugin.ts.
 *
 * Request and response shapes live in src/ai/protocol.ts.
 */
import { NpcReplySchema, NpcRequestSchema, type NpcResponse } from '../src/ai/protocol.js';
import { findNpc } from '../src/game/npcs.js';
import { json, readJsonBody } from './_lib/http.js';
import { callStructured, isMockMode, LlmError, resolveModel } from './_lib/llm.js';
import { mockNpcReply } from './_lib/npcMock.js';
import { buildNpcMessages, buildNpcSystemPrompt, fallbackNpcReply } from './_lib/npcPrompt.js';

export async function POST(request: Request): Promise<Response> {
  const parsed = NpcRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return json({ error: 'Invalid request body', issues }, 400);
  }

  const input = parsed.data;
  // Personas are looked up on the server, so a client cannot supply its own system prompt.
  const npc = findNpc(input.npcId);
  if (!npc) return json({ error: `Unknown NPC "${input.npcId}"` }, 404);

  if (isMockMode()) {
    return json({ ...mockNpcReply(npc, input), source: 'mock' } satisfies NpcResponse);
  }

  try {
    const result = await callStructured({
      system: buildNpcSystemPrompt(npc),
      messages: buildNpcMessages(input),
      schema: NpcReplySchema,
    });
    console.info(`[api/npc] ${npc.id}: ${result.model}, ${result.latencyMs} ms`);
    return json({ ...result.data, source: 'llm' } satisfies NpcResponse);
  } catch (error) {
    // Keep the game going: answer in character and log the real cause.
    const kind = error instanceof LlmError ? error.kind : 'unknown';
    console.error(`[api/npc] ${resolveModel()} failed (${kind}):`, error instanceof Error ? error.message : error);
    return json({ ...fallbackNpcReply(kind), source: 'fallback' } satisfies NpcResponse);
  }
}
