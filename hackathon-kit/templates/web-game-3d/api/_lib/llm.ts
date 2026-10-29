/**
 * Endpoint-agnostic helper around the Anthropic Messages API that returns
 * schema-validated JSON (structured outputs). A new AI endpoint only needs a
 * system prompt, messages and a zod schema:
 *
 *   const { data } = await callStructured({ system, messages, schema: QuestSchema });
 *
 * Errors are normalized into `LlmError` with a `kind`, so callers can degrade
 * gracefully (in-character fallback) instead of failing the request.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/** Fast, inexpensive model: NPC dialog is latency-sensitive. Override with LLM_MODEL. */
export const DEFAULT_MODEL: Anthropic.Model = 'claude-haiku-5-5';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Headroom for adaptive thinking plus a short JSON answer. */
const DEFAULT_MAX_TOKENS = 2_048;

export type Effort = NonNullable<Anthropic.OutputConfig['effort']>;

export interface StructuredRequest<Schema extends z.ZodType> {
  system: string;
  messages: Anthropic.MessageParam[];
  schema: Schema;
  /** Defaults to LLM_MODEL, then DEFAULT_MODEL. */
  model?: string;
  /** `low` (default) keeps realtime dialog snappy; raise it for heavier generation. */
  effort?: Effort;
  maxTokens?: number;
  /** Overall deadline for the call, retries included. */
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
}

export type LlmErrorKind =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'server'
  | 'refusal'
  | 'truncated'
  | 'invalid_output'
  | 'unknown';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

/** Mock mode: no API key configured, or explicitly forced with LLM_MOCK=1. */
export function isMockMode(): boolean {
  return process.env.LLM_MOCK === '1' || !process.env.ANTHROPIC_API_KEY?.trim();
}

export function resolveModel(): string {
  return process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  // Created lazily so mock mode never needs a key; reads ANTHROPIC_API_KEY from the env.
  client ??= new Anthropic();
  return client;
}

export async function callStructured<Schema extends z.ZodType>(
  request: StructuredRequest<Schema>,
): Promise<StructuredResult<z.infer<Schema>>> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // JSON schema for the API plus a zod-backed parser for the reply text.
  const format = zodOutputFormat(request.schema);
  const startedAt = performance.now();

  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create(
      {
        model: request.model ?? resolveModel(),
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: request.messages,
        output_config: { effort: request.effort ?? 'low', format },
      },
      // One quick retry for transient 429/5xx; the abort signal caps the total wait.
      { maxRetries: 1, timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (error) {
    throw toLlmError(error);
  }

  // `messages.parse()` would parse before we could look at stop_reason, so a refusal
  // or a truncated reply would surface as a confusing JSON error. Check it first.
  if (message.stop_reason === 'refusal') {
    throw new LlmError('refusal', 'The model declined to answer');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new LlmError('truncated', 'The reply hit max_tokens before the JSON was complete');
  }

  const text = message.content.find((block) => block.type === 'text')?.text ?? '';
  let data: z.infer<Schema>;
  try {
    data = format.parse(text);
  } catch (error) {
    throw new LlmError('invalid_output', 'The reply did not match the schema', { cause: error });
  }

  return {
    data,
    model: message.model,
    latencyMs: Math.round(performance.now() - startedAt),
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  };
}

/** Maps SDK errors (most specific first) to a small set of actionable kinds. */
function toLlmError(error: unknown): LlmError {
  const options = { cause: error };
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError('timeout', 'The LLM request timed out', options);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError('network', 'Could not reach the Anthropic API', options);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('auth', 'The API key is invalid or lacks access', options);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError('rate_limit', 'Rate limited by the Anthropic API', options);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    // Usually a wrong LLM_MODEL or an invalid request shape; the message says which.
    return new LlmError('bad_request', error.message, options);
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmError('server', `Anthropic API error ${error.status ?? ''}`.trim(), options);
  }
  return new LlmError('unknown', error instanceof Error ? error.message : String(error), options);
}
