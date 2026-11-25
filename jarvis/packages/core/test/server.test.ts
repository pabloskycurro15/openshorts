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
    const info = tools.find((t: { name: string }) => t.name === 'system.info');
    expect(info).toMatchObject({ name: 'system.info', risk: 'low', sideEffects: false });
    expect(info.parameters.type).toBe('object');
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

  it('revoca concesiones individuales y todas', async () => {
    const { app, auth, j } = await setup();
    const agent = { kind: 'agent' as const, id: 'research' };
    j.permissions.grant({ kind: 'user', id: 'owner' }, agent, 'web.*');
    j.permissions.grant({ kind: 'user', id: 'owner' }, agent, 'fs.read:/tmp/*');
    expect((await app.inject({ url: '/api/permissions', headers: auth })).json()).toHaveLength(2);
    const r1 = await app.inject({ method: 'POST', url: '/api/permissions/revoke', headers: auth, payload: { principal: agent, scope: 'web.*' } });
    expect(r1.json()).toEqual({ removed: 1 });
    const r2 = await app.inject({ method: 'POST', url: '/api/permissions/revoke-all', headers: auth });
    expect(r2.json()).toEqual({ removed: 1 });
    expect(j.permissions.listGrants()).toHaveLength(0);
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

describe('API de control y servido de la interfaz', () => {
  it('configuración del control: lectura, validación y guardado', async () => {
    const { app, auth } = await setup();
    expect((await app.inject({ url: '/api/control/config', headers: auth })).json()).toEqual({ folders: [], apps: [], commands: [] });
    const bad = await app.inject({ method: 'PUT', url: '/api/control/config', headers: auth, payload: { folders: [{ id: 'x', label: 'X', path: '/no/existe/nunca', access: 'read' }] } });
    expect(bad.statusCode).toBe(400);
    const dir = tmpDir();
    const ok = await app.inject({ method: 'PUT', url: '/api/control/config', headers: auth, payload: { folders: [{ id: 'docs', label: 'Docs', path: dir, access: 'read' }] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().folders[0].id).toBe('docs');
  });

  it('sirve la interfaz sin token y con cabeceras de seguridad; la API sigue protegida', async () => {
    const webDir = tmpDir();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${webDir}/index.html`, '<!doctype html><title>JARVIS</title>');
    const { createJarvis } = await import('../src/app');
    const { loadConfig } = await import('../src/kernel/config');
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent', webDir }), { dbFile: ':memory:' });
    await j.start();
    app = await buildServer(j, TOKEN);
    const page = await app.inject('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('JARVIS');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect((await app.inject('/api/health')).statusCode).toBe(401);
  });
});
