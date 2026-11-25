import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChatEvent } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { ScriptedProvider, text } from './fakes';
import { tmpDir } from './helpers';

const TOKEN = 'b'.repeat(43);
const auth = { authorization: `Bearer ${TOKEN}` };
const KEY = 'sk-ant-api03-SECRETO-abcdefghijklmnopqrstuvwxyz';
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0] = []) {
  const provider = new ScriptedProvider(script);
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactory: () => provider });
  await j.start();
  app = await buildServer(j, TOKEN);
  return { j, app, provider };
}

describe('API de IA', () => {
  it('estado inicial: sin clave, Opus 5.5 y límite de 5 $', async () => {
    const { app } = await setup();
    const s = (await app.inject({ url: '/api/ai/status', headers: auth })).json();
    expect(s).toMatchObject({ configured: false, settings: { model: 'claude-opus-5-5', effort: 'medium', monthlyLimitUsd: 5 }, spentMonthUsd: 0, blocked: false });
    expect(s.models.map((m: { id: string }) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  });

  it('la clave entra cifrada y NUNCA sale por la API', async () => {
    const { app, j } = await setup();
    expect((await app.inject({ method: 'PUT', url: '/api/ai/key', headers: auth, payload: { apiKey: 'no-es-una-clave-valida-xx' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/ai/key', headers: auth, payload: { apiKey: KEY } })).json()).toEqual({ configured: true });
    for (const url of ['/api/ai/status', '/api/audit?limit=100', '/api/health']) {
      const body = (await app.inject({ url, headers: auth })).body;
      expect(body).not.toContain('SECRETO');
    }
    expect(j.vault.get('ai.anthropic.apiKey')).toBe(KEY);
    const row = j.db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Buffer };
    expect(row.ciphertext.toString('utf8')).not.toContain('SECRETO');
    expect((await app.inject({ method: 'DELETE', url: '/api/ai/key', headers: auth })).json()).toEqual({ deleted: true });
    expect((await app.inject({ url: '/api/ai/status', headers: auth })).json().configured).toBe(false);
  });

  it('ajustes: valida modelo y límite', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'PUT', url: '/api/ai/settings', headers: auth, payload: { model: 'gpt-9' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/ai/settings', headers: auth, payload: { monthlyLimitUsd: -3 } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: '/api/ai/settings', headers: auth, payload: { model: 'claude-sonnet-5-5', monthlyLimitUsd: 10 } });
    expect(ok.json()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', monthlyLimitUsd: 10 });
  });

  it('chat en streaming por HTTP real (NDJSON), conversaciones y borrado', async () => {
    const { app, j } = await setup([text('Hola. ¿En qué puedo ayudarte?')]);
    j.ai.setApiKey({ kind: 'user', id: 'owner' }, KEY);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Hola' }) });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as ChatEvent);
    expect(events.map((e) => e.type)).toEqual(['start', 'text', 'usage', 'message_end', 'done']);
    const conv = (events[0] as { conversationId: string }).conversationId;

    const list = (await (await fetch(`http://127.0.0.1:${port}/api/conversations`, { headers: auth })).json()) as { id: string; title: string; costUsd: number }[];
    expect(list[0]).toMatchObject({ id: conv, title: 'Hola' });
    expect(list[0]!.costUsd).toBeGreaterThan(0);
    const detail = (await (await fetch(`http://127.0.0.1:${port}/api/conversations/${conv}`, { headers: auth })).json()) as { messages: { role: string }[] };
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(detail)).not.toContain('"raw"');

    const del = await fetch(`http://127.0.0.1:${port}/api/conversations/${conv}`, { method: 'DELETE', headers: auth });
    expect(await del.json()).toEqual({ deleted: true });
  });

  it('chat sin clave → evento de error claro, sin coste', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/chat', headers: auth, payload: { message: 'hola' } });
    const ev = r.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(ev[0]).toMatchObject({ type: 'error' });
    expect(ev[0].message).toMatch(/clave API/);
  });

  it('mensaje vacío → 400', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/chat', headers: auth, payload: { message: '   ' } })).statusCode).toBe(400);
  });
});
