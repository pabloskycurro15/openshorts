import type { ToolDescriptor } from '@jarvis/shared';
import { ProviderError, type AIProvider, type ChatMessage, type ContentBlock, type StopReason, type TurnRequest, type TurnResult } from './provider';
import { OPENAI_MODELS } from './pricing';
import { fromApiToolName, toApiToolName } from './anthropic';

/**
 * Adaptador de OpenAI con la API Responses (la que admite herramientas en GPT-6.1 Terra).
 * Modo sin estado: `store: false` + `include: ["reasoning.encrypted_content"]`, y en cada
 * turno se reenvían tal cual los elementos de salida anteriores (razonamiento incluido).
 * Respuesta completa (sin streaming) por ahora.
 */
type Item = Record<string, unknown> & { type?: string };

export function toOpenAiTools(tools: ToolDescriptor[]) {
  return tools.map((t) => {
    const { $schema, ...schema } = t.parameters as { $schema?: string } & Record<string, unknown>;
    void $schema;
    return { type: 'function', name: toApiToolName(t.name), description: `${t.description} Devuelve: ${t.returns}`, parameters: { type: 'object', ...schema }, strict: false };
  });
}

export function toOpenAiInput(messages: ChatMessage[]): Item[] {
  const out: Item[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.raw?.provider === 'openai' && m.raw.blocks.length) {
      out.push(...(m.raw.blocks as Item[]));
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      if (text) out.push({ role: 'assistant', content: text });
      for (const b of m.content) if (b.type === 'tool_use') out.push({ type: 'function_call', call_id: b.id, name: toApiToolName(b.name), arguments: JSON.stringify(b.input ?? {}) });
      continue;
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    if (text) out.push({ role: 'user', content: text });
    for (const b of m.content) if (b.type === 'tool_result') out.push({ type: 'function_call_output', call_id: b.toolUseId, output: b.isError ? `ERROR: ${b.content}` : b.content });
  }
  return out;
}

export function fromOpenAiOutput(output: Item[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const it of output) {
    if (it.type === 'message') {
      for (const c of (it.content as { type: string; text?: string; refusal?: string }[]) ?? []) {
        if (c.type === 'output_text' && c.text) blocks.push({ type: 'text', text: c.text });
      }
    } else if (it.type === 'function_call') {
      let input: unknown;
      try { input = JSON.parse(String(it.arguments ?? '{}')); } catch { input = { __invalid_json: String(it.arguments) }; }
      blocks.push({ type: 'tool_use', id: String(it.call_id), name: fromApiToolName(String(it.name)), input });
    }
  }
  return blocks;
}

function mapError(status: number, body: string): ProviderError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new ProviderError('La clave de OpenAI no es válida o no tiene acceso a este modelo.', 'auth');
  if (status === 429 && /insufficient_quota|quota|billing/.test(lower)) return new ProviderError('No queda saldo en la cuenta de OpenAI.', 'credit');
  if (status === 429) return new ProviderError('OpenAI: límite de peticiones alcanzado.', 'rate_limit');
  if (status >= 500) return new ProviderError('OpenAI está saturado o con errores.', 'overloaded');
  return new ProviderError(`OpenAI rechazó la petición (${status}): ${body.slice(0, 300)}`, 'bad_request');
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI (GPT)';
  readonly models = OPENAI_MODELS;
  constructor(private apiKey: string, private baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com', private fetchImpl: typeof fetch = fetch) {}

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const body = {
      model: req.model,
      instructions: req.system,
      input: toOpenAiInput(req.messages),
      tools: req.tools.length ? toOpenAiTools(req.tools) : undefined,
      reasoning: { effort: req.effort },
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 32000,
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError('Cancelado por el usuario', 'other', { cause: err });
      throw new ProviderError('No hay conexión con OpenAI.', 'network', { cause: err });
    }
    const text = await res.text();
    if (!res.ok) throw mapError(res.status, text);
    const data = JSON.parse(text) as { output?: Item[]; model?: string; status?: string; incomplete_details?: { reason?: string } | null; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
    const output = data.output ?? [];
    const content = fromOpenAiOutput(output);
    for (const b of content) if (b.type === 'text') req.onText?.(b.text);
    const refused = output.some((it) => it.type === 'message' && ((it.content as { type: string }[]) ?? []).some((c) => c.type === 'refusal'));
    const stopReason: StopReason = refused ? 'refusal'
      : content.some((b) => b.type === 'tool_use') ? 'tool_use'
      : data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens'
      : 'end_turn';
    const cached = data.usage?.input_tokens_details?.cached_tokens ?? 0;
    return {
      message: { role: 'assistant', content, raw: { provider: 'openai', blocks: output } },
      stopReason,
      usage: { inputTokens: Math.max(0, (data.usage?.input_tokens ?? 0) - cached), outputTokens: data.usage?.output_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 },
      servedModel: data.model ?? req.model,
    };
  }

  async healthCheck(model: string) {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models/${encodeURIComponent(model)}`, { headers: { authorization: `Bearer ${this.apiKey}` } });
      if (!res.ok) return { ok: false, detail: mapError(res.status, await res.text()).message };
      return { ok: true, detail: `Conectado. Modelo disponible: ${model}` };
    } catch {
      return { ok: false, detail: 'No hay conexión con OpenAI.' };
    }
  }
}
