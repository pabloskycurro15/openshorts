import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server/http';
import { loadOrCreateToken } from '../src/security/auth';
import { makeJarvis, tmpDir } from './helpers';

const TOKEN = 'a'.repeat(43);
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function setup() {
  const j = await makeJarvis();
  app = await buildServer(j, TOKEN);
  const auth = { authorization: `Bearer ${TOKEN}` };
  return { j, app, auth };
}

describe('API HTTP', () => {
  it('/api/ping es público; el resto exige token', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/ping')).statusCode).toBe(200);
    expect((await app.inject('/api/health')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/health', headers: { authorization: 'Bearer malo' } })).statusCode).toBe(401);
  });

  it('/api/health informa del estado y los módulos', async () => {
    const { app, auth } = await setup();
    const res = await app.inject({ url: '/api/health', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.lockdown).toBe(false);
    expect(body.modules.find((m: { id: string }) => m.id === 'system').status).toBe('running');
  });

  it('lista herramientas con su JSON Schema y las invoca', async () => {
    const { app, auth } = await setup();
    const tools = (await app.inject({ url: '/api/tools', headers: auth })).json();
    expect(tools[0]).toMatchObject({ name: 'system.info', risk: 'low', sideEffects: false });
    expect(tools[0].parameters.type).toBe('object');
    const r = await app.inject({ method: 'POST', url: '/api/tools/invoke', headers: auth, payload: { tool: 'system.info' } });
    expect(r.json().status).toBe('ok');
  });

  it('cuerpo no válido → 400', async () => {
    const { app, auth } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/tools/invoke', headers: auth, payload: { nope: 1 } });
    expect(r.statusCode).toBe(400);
  });

  it('emergencia: activa el bloqueo y queda auditado con cadena válida', async () => {
    const { app, auth, j } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/emergency', headers: auth, payload: { lockdown: true } });
    expect(r.json()).toEqual({ lockdown: true, cancelledApprovals: 0 });
    expect(j.permissions.isLockdown()).toBe(true);
    const audit = (await app.inject({ url: '/api/audit?limit=5', headers: auth })).json();
    expect(audit[0].action).toBe('security.lockdown');
    expect((await app.inject({ url: '/api/audit/verify', headers: auth })).json().ok).toBe(true);
  });

  it('WebSocket de eventos: rechaza sin token y retransmite eventos con token', async () => {
    const { app, j } = await setup();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;

    const bad = new WebSocket(`ws://127.0.0.1:${port}/api/events`);
    const badResult = await new Promise((resolve) => { bad.on('unexpected-response', (_r, res) => resolve(res.statusCode)); bad.on('error', () => {}); });
    expect(badResult).toBe(401);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${TOKEN}`);
    const msgs: { type: string; payload: unknown }[] = [];
    await new Promise<void>((resolve) => ws.on('message', (d) => { msgs.push(JSON.parse(String(d))); if (msgs.length === 1) resolve(); }));
    expect(msgs[0]!.type).toBe('hello');
    const next = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(String(d)))));
    j.bus.emit('assistant.state', { state: 'thinking' });
    expect(await next).toMatchObject({ type: 'assistant.state', payload: { state: 'thinking' } });
    ws.close();
  });
});

describe('token local', () => {
  it('se genera una vez, se reutiliza y el archivo es privado', async () => {
    const dir = tmpDir();
    const t1 = loadOrCreateToken(dir);
    expect(t1.length).toBeGreaterThanOrEqual(43);
    expect(loadOrCreateToken(dir)).toBe(t1);
    const { statSync } = await import('node:fs');
    if (process.platform !== 'win32') expect(statSync(`${dir}/auth-token`).mode & 0o777).toBe(0o600);
  });
});
