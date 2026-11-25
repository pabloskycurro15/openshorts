import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AnthropicProvider, fromApiToolName, toApiMessages, toApiToolName, toApiTools } from '../src/ai/anthropic';
import { ProviderError, type ChatMessage } from '../src/ai/provider';
import { costUsd, ANTHROPIC_MODELS } from '../src/ai/pricing';

/**
 * Servidor local que imita la API de mensajes en streaming (SSE) de Anthropic.
 * Permite probar el SDK real de extremo a extremo sin red ni coste.
 */
type Captured = { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
let server: http.Server | undefined;
afterEach(() => server?.close());

function sse(events: object[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

async function fakeApi(handler: (c: Captured, res: http.ServerResponse) => void): Promise<{ client: Anthropic; captured: Captured[] }> {
  const captured: Captured[] = [];
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const c = { url: req.url ?? '', headers: req.headers, body: data ? JSON.parse(data) : {} };
      captured.push(c);
      handler(c, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server!.address() as { port: number }).port;
  return { client: new Anthropic({ apiKey: 'sk-ant-test-0000000000000000000000', baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 }), captured };
}

const turnEvents = (blocks: object[], stop: string) => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 800, cache_creation_input_tokens: 300 } } },
  ...blocks,
  { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 57 } },
  { type: 'message_stop' },
];

const tools = [{ name: 'system.datetime', description: 'Hora', parameters: { ...z.toJSONSchema(z.object({}).strict()) }, permissions: ['system.time.read'], risk: 'low' as const, sideEffects: false, risks: [], returns: 'hora' }];

describe('Adaptador Anthropic — funciones puras', () => {
  it('traduce nombres de herramientas en ambos sentidos', () => {
    expect(toApiToolName('system.info')).toBe('system__info');
    expect(fromApiToolName('system__info')).toBe('system.info');
    expect(toApiToolName('a.b.c')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('herramientas: esquema sin $schema, tipo object y entrada en streaming', () => {
    const [t] = toApiTools(tools);
    expect(t!.name).toBe('system__datetime');
    expect(t!.input_schema).not.toHaveProperty('$schema');
    expect(t!.input_schema.type).toBe('object');
    expect(t!.eager_input_streaming).toBe(true);
  });

  it('reenvía intacto el contenido original de Claude y traduce el resto', () => {
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'hola' }];
    const msgs: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hola' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hola' }], raw: { provider: 'anthropic', blocks: raw } },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'x', isError: true }] },
    ];
    const api = toApiMessages(msgs);
    expect(api[1]!.content).toBe(raw);
    expect(api[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: true }]);
  });

  it('calcula el coste con el precio de cada tipo de token', () => {
    const opus = ANTHROPIC_MODELS.find((m) => m.id === 'claude-opus-5-5');
    // 1M entrada (4) + 1M salida (20) + 1M lectura caché (0,2) + 1M escritura caché (5)
    expect(costUsd(opus, { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 })).toBeCloseTo(29.2);
  });
});

describe('Adaptador Anthropic — SDK real contra API simulada', () => {
  it('envía la petición correcta y procesa texto, razonamiento y herramienta en streaming', async () => {
    const { client, captured } = await fakeApi((_c, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(turnEvents([
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'firma123' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Consulto ' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'la hora.' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'system__datetime', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 2 },
      ], 'tool_use')));
    });
    const p = new AnthropicProvider('x', client);
    const deltas: string[] = [];
    const r = await p.runTurn({ model: 'claude-opus-5-5', effort: 'medium', system: 'SYS', messages: [{ role: 'user', content: [{ type: 'text', text: '¿Hora?' }] }], tools, onText: (d) => deltas.push(d) });

    // Petición
    const req = captured[0]!;
    expect(req.url).toContain('/v1/messages');
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', system: 'SYS', stream: true, fallbacks: 'default', output_config: { effort: 'medium' }, cache_control: { type: 'ephemeral' } });
    expect(req.body).not.toHaveProperty('thinking');
    expect((req.body.tools as { name: string }[])[0]!.name).toBe('system__datetime');

    // Respuesta
    expect(deltas.join('')).toBe('Consulto la hora.');
    expect(r.stopReason).toBe('tool_use');
    expect(r.message.content).toEqual([{ type: 'text', text: 'Consulto la hora.' }, { type: 'tool_use', id: 'toolu_1', name: 'system.datetime', input: {} }]);
    expect((r.message.raw!.blocks as { type: string }[]).map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 57, cacheReadTokens: 800, cacheWriteTokens: 300, webSearches: 0 });
    expect((req.body.tools as { type?: string }[]).some((t) => t.type === 'web_search_20260209')).toBe(false); // apagada por defecto
    expect(r.servedModel).toBe('claude-opus-5-5');
  });

  it('el siguiente turno reenvía el razonamiento sin modificar', async () => {
    const { client, captured } = await fakeApi((_c, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(turnEvents([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ok' } },
        { type: 'content_block_stop', index: 0 },
      ], 'end_turn')));
    });
    const raw = [{ type: 'thinking', thinking: '', signature: 'firma123' }, { type: 'tool_use', id: 'toolu_1', name: 'system__datetime', input: {} }];
    await new AnthropicProvider('x', client).runTurn({
      model: 'claude-opus-5-5', effort: 'low', system: 'S', tools,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hora' }] },
        { role: 'assistant', content: [], raw: { provider: 'anthropic', blocks: raw } },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_1', content: '12:00' }] },
      ],
    });
    const sent = captured[0]!.body.messages as { content: unknown }[];
    expect(sent[1]!.content).toEqual(raw);
  });

  it('búsqueda web: solo se envía si se activa, con su límite', async () => {
    const { client, captured } = await fakeApi((_c, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(turnEvents([], 'end_turn')));
    });
    await new AnthropicProvider('x', client).runTurn({ model: 'claude-sonnet-5-5', effort: 'low', system: 'S', tools, webSearch: { maxUses: 3 }, messages: [{ role: 'user', content: [{ type: 'text', text: 'busca' }] }] });
    expect(captured[0]!.body.tools).toContainEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });
  });

  it('Haiku no envía respaldo (no lo admite)', async () => {
    const { client, captured } = await fakeApi((_c, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(turnEvents([], 'end_turn')));
    });
    await new AnthropicProvider('x', client).runTurn({ model: 'claude-haiku-5-5', effort: 'low', system: 'S', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }] });
    expect(captured[0]!.body).not.toHaveProperty('fallbacks');
    expect(captured[0]!.headers['anthropic-beta'] ?? '').not.toContain('server-side-fallback');
  });

  it('traduce los errores de la API a mensajes claros', async () => {
    const { client } = await fakeApi((_c, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    });
    const p = new AnthropicProvider('x', client);
    const err = await p.runTurn({ model: 'claude-opus-5-5', effort: 'low', system: 'S', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'h' }] }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('auth');
    expect(await p.healthCheck('claude-opus-5-5')).toEqual({ ok: false, detail: 'La clave API no es válida o fue revocada.' });
  });

  it('healthCheck consulta el modelo sin generar texto', async () => {
    const { client, captured } = await fakeApi((_c, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-10-01T00:00:00Z' }));
    });
    expect(await new AnthropicProvider('x', client).healthCheck('claude-opus-5-5')).toEqual({ ok: true, detail: 'Conectado. Modelo disponible: Claude Opus 5.5' });
    expect(captured[0]!.url).toContain('/v1/models/claude-opus-5-5');
  });
});
