import Anthropic from '@anthropic-ai/sdk';
import type { ToolDescriptor } from '@jarvis/shared';
import {
  ProviderError,
  type AIProvider,
  type ChatMessage,
  type ContentBlock,
  type StopReason,
  type TurnRequest,
  type TurnResult,
} from './provider';
import { ANTHROPIC_MODELS } from './pricing';

/**
 * Los nombres de herramienta de la API solo admiten [a-zA-Z0-9_-]; los de JARVIS
 * usan puntos ("system.info"). Se traducen en ambos sentidos.
 */
export const toApiToolName = (n: string) => n.replace(/\./g, '__');
export const fromApiToolName = (n: string) => n.replace(/__/g, '.');

export function toApiTools(tools: ToolDescriptor[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, ...schema } = t.parameters as { $schema?: string } & Record<string, unknown>;
    return {
      name: toApiToolName(t.name),
      description: `${t.description} Devuelve: ${t.returns}${t.sideEffects ? ' (Modifica cosas; puede requerir confirmación del usuario.)' : ''}`,
      input_schema: { type: 'object', ...schema } as Anthropic.Beta.BetaTool.InputSchema,
      // Entrada en streaming; JARVIS valida siempre los argumentos con zod antes de ejecutar.
      eager_input_streaming: true,
    };
  });
}

/** Convierte el historial neutro al formato de la API, reenviando intacto el contenido original de Claude. */
export function toApiMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.raw?.provider === 'anthropic' && m.raw.blocks.length) {
      return { role: 'assistant', content: m.raw.blocks as Anthropic.Beta.BetaContentBlockParam[] };
    }
    const content: Anthropic.Beta.BetaContentBlockParam[] = m.content.map((b) => {
      switch (b.type) {
        case 'text':
          return { type: 'text', text: b.text };
        case 'tool_use':
          return { type: 'tool_use', id: b.id, name: toApiToolName(b.name), input: b.input as Record<string, unknown> };
        case 'tool_result':
          return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
      }
    });
    return { role: m.role, content };
  });
}

export function fromApiContent(blocks: Anthropic.Beta.BetaContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text') out.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') out.push({ type: 'tool_use', id: b.id, name: fromApiToolName(b.name), input: b.input });
    // thinking, fallback y demás bloques solo viven en `raw`.
  }
  return out;
}

function mapStop(s: string | null): StopReason {
  return s === 'end_turn' || s === 'tool_use' || s === 'max_tokens' || s === 'refusal' || s === 'pause_turn' ? s : s === 'stop_sequence' ? 'end_turn' : 'other';
}

function mapError(err: unknown): ProviderError {
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError('La clave API no es válida o fue revocada.', 'auth', { cause: err });
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError('La clave API no tiene permiso para este modelo.', 'auth', { cause: err });
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('Límite de peticiones alcanzado. Espera un momento.', 'rate_limit', { cause: err });
  if (err instanceof Anthropic.BadRequestError) {
    const credit = /credit|balance/i.test(err.message);
    return new ProviderError(credit ? 'No queda saldo en la cuenta de Anthropic. Recárgala en platform.claude.com.' : `Petición rechazada: ${err.message}`, credit ? 'credit' : 'bad_request', { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError) return new ProviderError('El servicio de Anthropic está saturado o con errores. Inténtalo de nuevo.', 'overloaded', { cause: err });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('No hay conexión con Anthropic. Revisa Internet.', 'network', { cause: err });
  if (err instanceof Anthropic.APIError) return new ProviderError(`Error de la API (${err.status}): ${err.message}`, 'other', { cause: err });
  return new ProviderError(err instanceof Error ? err.message : String(err), 'other', { cause: err });
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic (Claude)';
  readonly models = ANTHROPIC_MODELS;
  private client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2 });
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    // Haiku no admite respaldo en servidor; Opus y Sonnet usan el modo recomendado "default".
    const withFallback = !req.model.startsWith('claude-haiku');
    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: 64000,
      system: req.system,
      messages: toApiMessages(req.messages),
      tools: req.tools.length ? toApiTools(req.tools) : undefined,
      output_config: { effort: req.effort },
      // Caché automática del prefijo (instrucciones + herramientas + historial): abarata cada turno.
      cache_control: { type: 'ephemeral' },
      stream: true,
      ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(params, { signal: req.signal });
      if (req.onText) stream.on('text', (delta) => req.onText!(delta));
      message = await stream.finalMessage();
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError('Cancelado por el usuario', 'other', { cause: err });
      throw mapError(err);
    }

    const stopReason = mapStop(message.stop_reason);
    const u = message.usage;
    return {
      message: { role: 'assistant', content: fromApiContent(message.content), raw: { provider: 'anthropic', blocks: message.content } },
      stopReason,
      refusalDetail: stopReason === 'refusal' ? (message.stop_details?.explanation ?? undefined) : undefined,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
      servedModel: message.model,
    };
  }

  async healthCheck(model: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const m = await this.client.models.retrieve(model);
      return { ok: true, detail: `Conectado. Modelo disponible: ${m.display_name}` };
    } catch (err) {
      return { ok: false, detail: mapError(err).message };
    }
  }
}
