import { NO_ACTION, NpcResponseSchema, type NpcRequest, type NpcResponse } from './protocol';

const ENDPOINT = '/api/npc';
/** A bit above the server-side LLM deadline (15 s), so the server can answer with its own fallback first. */
const CLIENT_TIMEOUT_MS = 20_000;

/**
 * Asks the server for the NPC's next line. Never throws: network errors, bad
 * status codes and malformed bodies all become an in-character fallback reply,
 * so the dialog UI always gets something to show.
 */
export async function requestNpcReply(request: NpcRequest): Promise<NpcResponse> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[npc] ${ENDPOINT} responded with ${response.status}`);
      return connectionLostReply();
    }

    const parsed = NpcResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn('[npc] Unexpected response shape', parsed.error.issues);
      return connectionLostReply();
    }
    return parsed.data;
  } catch (error) {
    console.warn('[npc] Request failed', error);
    return connectionLostReply();
  }
}

function connectionLostReply(): NpcResponse {
  return {
    reply: '...Кажется, связь пропала. Повтори, пожалуйста.',
    emotion: 'neutral',
    action: NO_ACTION,
    relationshipDelta: 0,
    remember: [],
    source: 'fallback',
  };
}
