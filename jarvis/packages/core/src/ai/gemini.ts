import type { ToolDescriptor } from '@jarvis/shared';
import { ProviderError, type AIProvider, type ChatMessage, type ContentBlock, type StopReason, type TurnRequest, type TurnResult } from './provider';
import { GOOGLE_MODELS } from './pricing';
import { fromApiToolName, toApiToolName } from './anthropic';

/**
 * Adaptador de Google Gemini (API REST generateContent). Pensado para el nivel gratuito
 * de AI Studio. Las partes originales del modelo (incluidas las firmas de razonamiento de
 * Gemini 3) se reenvían intactas en los turnos siguientes.
 */
type Part = Record<string, unknown>;

const ALLOWED = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'format', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'anyOf']);

/** Reduce un JSON Schema al subconjunto OpenAPI que acepta Gemini. */
export function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === 'items' || k === 'anyOf') out[k] = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

export function toGeminiTools(tools: ToolDescriptor[]) {
  if (!tools.length) return undefined;
  return [{ functionDeclarations: tools.map((t) => {
    const params = toGeminiSchema(t.parameters) as { properties?: Record<string, unknown> };
    const hasProps = params.properties && Object.keys(params.properties).length > 0;
    return { name: toApiToolName(t.name), description: `${t.description} Devuelve: ${t.returns}`, ...(hasProps ? { parameters: { ...params, type: 'object' } } : {}) };
  }) }];
}

export function toGeminiContents(messages: ChatMessage[]): { role: string; parts: Part[] }[] {
  const names = new Map<string, string>(); // id de llamada → nombre (Gemini responde por nombre)
  const out: { role: string; parts: Part[] }[] = [];
  for (const m of messages) {
    for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name);
    if (m.role === 'assistant' && m.raw?.provider === 'google' && m.raw.blocks.length) {
      out.push({ role: 'model', parts: m.raw.blocks as Part[] });
      continue;
    }
    const parts: Part[] = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: toApiToolName(b.name), args: b.input ?? {} } });
      else if (b.type === 'tool_result') parts.push({ functionResponse: { name: toApiToolName(names.get(b.toolUseId) ?? 'herramienta'), response: b.isError ? { error: b.content } : { result: b.content } } });
    }
    if (parts.length) out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return out;
}

export function fromGeminiParts(parts: Part[], idBase: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let n = 0;
  for (const p of parts) {
    if (typeof p.text === 'string' && !p.thought && p.text) blocks.push({ type: 'text', text: p.text });
    const fc = p.functionCall as { name?: string; args?: unknown; id?: string } | undefined;
    if (fc?.name) blocks.push({ type: 'tool_use', id: fc.id ?? `${idBase}_${n++}`, name: fromApiToolName(fc.name), input: fc.args ?? {} });
  }
  return blocks;
}

function mapError(status: number, body: string): ProviderError {
  if (status === 400 && /api key|API_KEY/i.test(body)) return new ProviderError('La clave de Gemini no es válida.', 'auth');
  if (status === 401 || status === 403) return new ProviderError('La clave de Gemini no es válida o no tiene acceso a este modelo.', 'auth');
  if (status === 429) return new ProviderError('Gemini: cupo gratuito agotado por ahora (se renueva cada día).', 'rate_limit');
  if (status >= 500) return new ProviderError('Gemini está saturado o con errores.', 'overloaded');
  return new ProviderError(`Gemini rechazó la petición (${status}): ${body.slice(0, 300)}`, 'bad_request');
}

export class GeminiProvider implements AIProvider {
  readonly id = 'google';
  readonly displayName = 'Google (Gemini)';
  readonly models = GOOGLE_MODELS;
  constructor(private apiKey: string, private baseUrl = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com', private fetchImpl: typeof fetch = fetch) {}

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toGeminiContents(req.messages),
      tools: toGeminiTools(req.tools),
      generationConfig: { maxOutputTokens: 8192 },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError('Cancelado por el usuario', 'other', { cause: err });
      throw new ProviderError('No hay conexión con Google Gemini.', 'network', { cause: err });
    }
    const text = await res.text();
    if (!res.ok) throw mapError(res.status, text);
    const data = JSON.parse(text) as {
      candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
      modelVersion?: string;
    };
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    const content = fromGeminiParts(parts, `gem_${Date.now().toString(36)}`);
    for (const b of content) if (b.type === 'text') req.onText?.(b.text);
    const fr = cand?.finishReason ?? '';
    const stopReason: StopReason = data.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(fr) ? 'refusal'
      : content.some((b) => b.type === 'tool_use') ? 'tool_use'
      : fr === 'MAX_TOKENS' ? 'max_tokens'
      : 'end_turn';
    const u = data.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    return {
      message: { role: 'assistant', content, raw: { provider: 'google', blocks: parts } },
      stopReason,
      refusalDetail: stopReason === 'refusal' ? (data.promptFeedback?.blockReason ?? fr) : undefined,
      usage: { inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached), outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheReadTokens: cached, cacheWriteTokens: 0 },
      servedModel: req.model,
    };
  }

  async healthCheck(model: string) {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': this.apiKey } });
      if (!res.ok) return { ok: false, detail: mapError(res.status, await res.text()).message };
      return { ok: true, detail: `Conectado. Modelo disponible: ${model}` };
    } catch {
      return { ok: false, detail: 'No hay conexión con Google Gemini.' };
    }
  }
}
