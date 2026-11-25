import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent, Principal } from '@jarvis/shared';
import { classify, route } from '../src/ai/router';
import { DEFAULT_AI_SETTINGS } from '../src/ai/budget';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { ProviderError } from '../src/ai/provider';
import { OpenAIProvider, toOpenAiInput } from '../src/ai/openai';
import { GeminiProvider, toGeminiContents, toGeminiSchema } from '../src/ai/gemini';
import { GOOGLE_MODELS, OPENAI_MODELS } from '../src/ai/pricing';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const all = new Set(['anthropic', 'openai', 'google']);
const free = GOOGLE_MODELS.map((m) => m.id);
const r = (msg: string, configured = all, settings = DEFAULT_AI_SETTINGS) => route(msg, { settings, configured, freeModels: free, coolingDown: () => false });
const ids = (msg: string, configured = all, settings = DEFAULT_AI_SETTINGS) => r(msg, configured, settings).chain.map((c) => c.model);

describe('Repartidor: clasificación', () => {
  it.each([
    ['Hola, ¿qué tal?', 'simple'],
    ['¿Qué hora es?', 'simple'],
    ['Traduce «good morning» al francés', 'simple'],
    ['Explícame en un par de párrafos la diferencia entre el IVA general y el reducido y cuándo se aplica cada uno', 'medium'],
    ['Planifica una estrategia de marketing para un bar en Nerja', 'complex'],
    ['Crea una web para mi negocio con reservas', 'complex'],
    ['Abre el bloc de notas', 'medium'],
  ])('«%s» → %s', (msg, tier) => {
    expect(classify(msg).tier).toBe(tier);
  });

  it('detecta acciones y datos sensibles', () => {
    expect(classify('borra el archivo viejo').action).toBe(true);
    expect(classify('mi contraseña del banco es…').sensitive).toBe(true);
  });
});

describe('Repartidor: cadenas', () => {
  it('sencillo → Gemini gratis primero, luego Haiku', () => {
    expect(ids('¿Qué hora es?')).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'claude-haiku-5-5', 'gpt-6.1-terra', 'claude-sonnet-5-5']);
  });
  it('medio → GPT Terra, luego Sonnet', () => {
    expect(ids('Explícame en un par de párrafos la diferencia entre el IVA general y el reducido y cuándo se aplica')[0]).toBe('gpt-6.1-terra');
  });
  it('complejo → Opus', () => {
    expect(ids('Planifica una estrategia para mi negocio')[0]).toBe('claude-opus-5-5');
  });
  it('acciones sobre el equipo → Claude (usa mejor las herramientas)', () => {
    expect(ids('Abre el bloc de notas')[0]).toBe('claude-sonnet-5-5');
  });
  it('lo sensible nunca va al nivel gratuito de Google', () => {
    expect(ids('¿Qué es un PIN?')).not.toContain('gemini-3.5-flash-lite');
  });
  it('si el usuario desactiva Gemini gratis, no se usa', () => {
    expect(ids('Hola', all, { ...DEFAULT_AI_SETTINGS, allowFreeGoogle: false })[0]).toBe('claude-haiku-5-5');
  });
  it('solo usa proveedores con clave', () => {
    expect(ids('Hola', new Set(['anthropic']))).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(ids('Hola', new Set(['google']))).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  });
  it('aparta los modelos en pausa', () => {
    const d = route('Hola', { settings: DEFAULT_AI_SETTINGS, configured: all, freeModels: free, coolingDown: (c) => c.model === 'gemini-3.5-flash-lite' });
    expect(d.chain[0]!.model).toBe('gemini-3.8-flash');
  });
});

describe('Repartidor en el motor', () => {
  it('cupo agotado en los dos Gemini gratis → pasa a Haiku, avisa y los aparta un rato', async () => {
    const quota = () => { throw new ProviderError('Gemini: cupo gratuito agotado', 'rate_limit'); };
    const gemini = new ScriptedProvider([quota, quota]);
    (gemini as unknown as { id: string }).id = 'google';
    (gemini as unknown as { models: unknown }).models = GOOGLE_MODELS;
    const claude = new ScriptedProvider([text('Son las doce.'), text('Otra vez.')]);
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactories: { anthropic: () => claude, google: () => gemini } });
    await j.start();
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    j.ai.setApiKey(USER, 'AIzaSyPRUEBA_0123456789abcdefghijklmn', 'google');
    const events: ChatEvent[] = [];
    await j.ai.engine.run({ message: '¿Qué hora es?' }, (e) => events.push(e));
    const routes = events.filter((e) => e.type === 'route') as Extract<ChatEvent, { type: 'route' }>[];
    expect(routes.map((x) => x.model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'claude-haiku-5-5']);
    expect(events.some((e) => e.type === 'warning' && /no está disponible/.test(e.message))).toBe(true);
    expect(claude.calls[0]!.model).toBe('claude-haiku-5-5');
    // Siguiente mensaje sencillo: los Gemini siguen en pausa → directamente Haiku.
    expect(j.ai.plan('Hola').candidates[0]!.model.id).toBe('claude-haiku-5-5');
    // El historial muestra qué modelo respondió.
    const conv = (events[0] as { conversationId: string }).conversationId;
    expect(j.ai.store.view(conv).find((m) => m.role === 'assistant')!.model).toBe('claude-haiku-5-5');
  });

  it('modelo fijado por el usuario: se usa ese y no se cambia', async () => {
    const claude = new ScriptedProvider([text('ok')]);
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactory: () => claude });
    await j.start();
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    j.ai.budget.updateSettings({ model: 'claude-sonnet-5-5' });
    expect(j.ai.plan('Planifica algo complejo').candidates.map((c) => c.model.id)).toEqual(['claude-sonnet-5-5']);
  });

  it('claves por proveedor con validación de formato', async () => {
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:' });
    await j.start();
    expect(() => j.ai.setApiKey(USER, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxx', 'openai')).not.toThrow(); // formato sk- válido
    expect(() => j.ai.setApiKey(USER, 'no-vale', 'google')).toThrow(/Gemini/);
    expect(j.ai.status().providers.find((p) => p.id === 'openai')!.configured).toBe(true);
  });
});

// ── Adaptadores contra APIs simuladas ──
let server: http.Server | undefined;
afterEach(() => server?.close());
async function fake(handler: (url: string, body: Record<string, unknown>, headers: http.IncomingHttpHeaders) => { status?: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
  server = http.createServer((req, res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      const body = d ? JSON.parse(d) : {};
      calls.push({ url: req.url ?? '', body, headers: req.headers });
      const out = handler(req.url ?? '', body, req.headers);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server!.address() as { port: number }).port}`, calls };
}
const tools = [{ name: 'system.datetime', description: 'Hora', parameters: { $schema: 'x', type: 'object', properties: {}, additionalProperties: false }, permissions: [], risk: 'low' as const, sideEffects: false, risks: [], returns: 'hora' }];

describe('Adaptador OpenAI (Responses)', () => {
  it('envía la petición sin estado y procesa texto, llamada a función y uso', async () => {
    const api = await fake(() => ({ json: {
      model: 'gpt-6.1-terra', status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' },
        { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Miro la hora.', annotations: [] }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'system__datetime', arguments: '{}' },
      ],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 50 },
    } }));
    const p = new OpenAIProvider('sk-test', api.url);
    const deltas: string[] = [];
    const out = await p.runTurn({ model: 'gpt-6.1-terra', effort: 'low', system: 'SYS', tools, messages: [{ role: 'user', content: [{ type: 'text', text: '¿Hora?' }] }], onText: (d) => deltas.push(d) });
    const req = api.calls[0]!;
    expect(req.url).toBe('/v1/responses');
    expect(req.headers.authorization).toBe('Bearer sk-test');
    expect(req.body).toMatchObject({ model: 'gpt-6.1-terra', instructions: 'SYS', store: false, include: ['reasoning.encrypted_content'], reasoning: { effort: 'low' }, input: [{ role: 'user', content: '¿Hora?' }] });
    expect((req.body.tools as { name: string; type: string }[])[0]).toMatchObject({ type: 'function', name: 'system__datetime' });
    expect(out.stopReason).toBe('tool_use');
    expect(deltas.join('')).toBe('Miro la hora.');
    expect(out.message.content).toEqual([{ type: 'text', text: 'Miro la hora.' }, { type: 'tool_use', id: 'call_1', name: 'system.datetime', input: {} }]);
    expect(out.usage).toEqual({ inputTokens: 800, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 0 });
    // Siguiente turno: reenvía los elementos originales (razonamiento cifrado incluido) y el resultado.
    const input = toOpenAiInput([
      { role: 'user', content: [{ type: 'text', text: '¿Hora?' }] }, out.message,
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: '12:00' }] },
    ]);
    expect(input[1]).toMatchObject({ type: 'reasoning', encrypted_content: 'ENC' });
    expect(input.at(-1)).toEqual({ type: 'function_call_output', call_id: 'call_1', output: '12:00' });
  });

  it('errores: sin saldo, límite y clave', async () => {
    let status = 429; let body: unknown = { error: { code: 'insufficient_quota' } };
    const api = await fake(() => ({ status, json: body }));
    const p = new OpenAIProvider('sk-test', api.url);
    const run = () => p.runTurn({ model: 'gpt-6.1-terra', effort: 'low', system: '', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'h' }] }] }).catch((e: ProviderError) => e.kind);
    expect(await run()).toBe('credit');
    body = { error: { code: 'rate_limit_exceeded' } };
    expect(await run()).toBe('rate_limit');
    status = 401;
    expect(await run()).toBe('auth');
  });
});

describe('Adaptador Gemini (generateContent)', () => {
  it('esquemas reducidos al subconjunto admitido', () => {
    expect(toGeminiSchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { a: { type: 'string', default: 'x', pattern: '^a' } }, required: ['a'] }))
      .toEqual({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
  });

  it('envía la petición y procesa texto, llamada a función (con firma) y uso; reenvía las partes intactas', async () => {
    const api = await fake(() => ({ json: {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Consulto.' }, { functionCall: { name: 'system__datetime', args: {} }, thoughtSignature: 'SIG' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20, thoughtsTokenCount: 10 },
    } }));
    const p = new GeminiProvider('AIza-test', api.url);
    const out = await p.runTurn({ model: 'gemini-3.5-flash-lite', effort: 'low', system: 'SYS', tools, messages: [{ role: 'user', content: [{ type: 'text', text: '¿Hora?' }] }] });
    const req = api.calls[0]!;
    expect(req.url).toBe('/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('AIza-test');
    expect(req.body).toMatchObject({ systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: '¿Hora?' }] }] });
    expect((req.body.tools as { functionDeclarations: { name: string; parameters?: unknown }[] }[])[0]!.functionDeclarations[0]).toEqual({ name: 'system__datetime', description: 'Hora Devuelve: hora' });
    expect(out.stopReason).toBe('tool_use');
    const call = out.message.content.find((b) => b.type === 'tool_use') as { id: string; name: string };
    expect(call.name).toBe('system.datetime');
    expect(out.usage).toEqual({ inputTokens: 500, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const contents = toGeminiContents([
      { role: 'user', content: [{ type: 'text', text: '¿Hora?' }] }, out.message,
      { role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: '12:00' }] },
    ]);
    expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'Consulto.' }, { functionCall: { name: 'system__datetime', args: {} }, thoughtSignature: 'SIG' }] });
    expect(contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'system__datetime', response: { result: '12:00' } } }] });
  });

  it('cupo agotado (429) → rate_limit; contenido bloqueado → negativa', async () => {
    let mode = 'quota';
    const api = await fake(() => (mode === 'quota' ? { status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED' } } } : { json: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } }));
    const p = new GeminiProvider('k', api.url);
    const req = { model: 'gemini-3.5-flash-lite', effort: 'low' as const, system: '', tools: [], messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'h' }] }] };
    expect(await p.runTurn(req).catch((e: ProviderError) => e.kind)).toBe('rate_limit');
    mode = 'safety';
    expect((await p.runTurn(req)).stopReason).toBe('refusal');
  });
});

describe('Precios', () => {
  it('Gemini gratis cuesta 0; Terra 1 $/5 $', () => {
    expect(GOOGLE_MODELS.every((m) => m.price.input === 0 && m.price.output === 0)).toBe(true);
    expect(OPENAI_MODELS[0]).toMatchObject({ id: 'gpt-6.1-terra', price: { input: 1, output: 5 } });
  });
  void toolCall;
});
