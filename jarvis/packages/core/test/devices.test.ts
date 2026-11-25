import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import WebSocket from 'ws';
import type { Principal } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { startJarvis, type RunningJarvis } from '../src/server/start';
import type { PushSender } from '../src/notify/push';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const TOKEN = 'z'.repeat(43);
const auth = { authorization: `Bearer ${TOKEN}` };

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0)) await c().catch(() => undefined); });

async function setup(pushSender?: PushSender) {
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: [], pushSender, pushAnyHost: !!pushSender });
  await j.start();
  const app = await buildServer(j, TOKEN);
  cleanup.push(() => app.close(), () => j.stop());
  return { j, app };
}

describe('Dispositivos: vinculación', () => {
  it('código de un solo uso → token propio; el token sirve para la API y se puede revocar', async () => {
    const { j, app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/pair/start' })).statusCode).toBe(401);
    const start = (await app.inject({ method: 'POST', url: '/api/pair/start', headers: auth })).json();
    expect(start.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(start.qr).toBeNull(); // sin acceso remoto configurado no hay enlace

    const pair = await app.inject({ method: 'POST', url: '/api/pair/complete', payload: { code: start.code.toLowerCase().replace(/(.{4})/, '$1-'), name: 'iPhone de Pablo', platform: 'ios' } });
    expect(pair.statusCode).toBe(200);
    const { token, deviceId } = pair.json();
    expect(token).toHaveLength(43);
    // Un solo uso
    expect((await app.inject({ method: 'POST', url: '/api/pair/complete', payload: { code: start.code } })).statusCode).toBe(403);
    // Solo se guarda la huella del token
    expect(JSON.stringify(j.db.prepare('SELECT * FROM devices').all())).not.toContain(token);

    const dev = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url: '/api/me', headers: dev })).json()).toMatchObject({ kind: 'device', device: { id: deviceId, name: 'iPhone de Pablo', platform: 'ios' } });
    expect((await app.inject({ url: '/api/me', headers: auth })).json()).toEqual({ kind: 'local', device: null });
    expect((await app.inject({ url: '/api/devices', headers: dev })).json()).toMatchObject([{ id: deviceId, lastIp: '127.0.0.1' }]);

    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${deviceId}`, headers: auth })).json()).toEqual({ revoked: true });
    expect((await app.inject({ url: '/api/me', headers: dev })).statusCode).toBe(401);
    expect(j.audit.verify().ok).toBe(true);
  });

  it('5 códigos erróneos invalidan el código; los fallos repetidos bloquean la IP (429)', async () => {
    const { app } = await setup();
    const start = (await app.inject({ method: 'POST', url: '/api/pair/start', headers: auth })).json();
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'POST', url: '/api/pair/complete', payload: { code: 'AAAAAAAA' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/pair/complete', payload: { code: start.code } });
    expect(r.json().error).toMatch(/No hay ningún código/);
    for (let i = 0; i < 4; i++) await app.inject({ url: '/api/health', headers: { authorization: 'Bearer malo' } });
    expect((await app.inject({ url: '/api/health', headers: auth })).statusCode).toBe(429);
  });

  it('CORS solo para la app nativa (capacitor://localhost), con preflight', async () => {
    const { app } = await setup();
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/health', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'GET' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    const evil = await app.inject({ url: '/api/health', headers: { ...auth, origin: 'https://malo.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Notificaciones push', () => {
  it('claves VAPID persistentes; suscribirse; los avisos y confirmaciones llegan; las caducadas se borran', async () => {
    const sent: { endpoint: string; payload: string; subject: string }[] = [];
    const sender: PushSender = async (sub, payload, o) => {
      if (sub.endpoint.includes('caducada')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload, subject: o.vapidDetails.subject });
    };
    const { j, app } = await setup(sender);
    const key = (await app.inject({ url: '/api/push/key', headers: auth })).json();
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{80,90}$/);
    expect((await app.inject({ url: '/api/push/key', headers: auth })).json().publicKey).toBe(key.publicKey);
    expect(j.vault.get('push.vapid.private')).toBeTruthy();

    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth, payload: { endpoint: 'https://push.test/ok', keys } })).json()).toEqual({ subscribed: true });
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth, payload: { endpoint: 'https://push.test/caducada', keys } });
    j.bus.emit('notification', { title: 'Resumen listo', body: 'Tienes 3 correos', source: 'automation' });
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: 'Resumen listo', body: 'Tienes 3 correos', url: '/#/notificaciones' });
    expect(sent[0]!.subject).toMatch(/^mailto:/);
    expect(j.push.count()).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/push/test', headers: auth })).json()).toEqual({ sent: 1, removed: 0, failed: 0 });
  });

  it('solo admite servicios push reales', async () => {
    const { app } = await setup();
    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth, payload: { endpoint: 'https://intranet.local/x', keys } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth, payload: { endpoint: 'https://web.push.apple.com/abc', keys } })).statusCode).toBe(200);
  });

  it('cifrado real de Web Push (web-push) contra un servicio push local HTTPS', async () => {
    const { execFileSync } = await import('node:child_process');
    const https = await import('node:https');
    const fs = await import('node:fs');
    const dir = tmpDir();
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
    const got: { headers: http.IncomingHttpHeaders; bytes: number }[] = [];
    const srv = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
      let n = 0;
      req.on('data', (c: Buffer) => { n += c.length; });
      req.on('end', () => { got.push({ headers: req.headers, bytes: n }); res.writeHead(201).end(); });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    cleanup.push(() => new Promise((r) => srv.close(r)));
    const port = (srv.address() as { port: number }).port;
    const agent = new https.Agent({ ca: fs.readFileSync(`${dir}/c.pem`), checkServerIdentity: () => undefined });
    const { j } = await setup((s, p, o) => webpush.sendNotification(s, p, { ...o, agent }));
    // Claves de un «navegador» reales (P-256) para que el cifrado aes128gcm funcione de verdad.
    const ecdh = (await import('node:crypto')).createECDH('prime256v1');
    ecdh.generateKeys();
    j.push.subscribe(null, { endpoint: `https://127.0.0.1:${port}/push/abc`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') } });
    expect(await j.push.sendAll({ title: 'Hola', body: 'Cifrado' })).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(got[0]!.headers['content-encoding']).toBe('aes128gcm');
    expect(String(got[0]!.headers.authorization)).toMatch(/^vapid t=.+, k=/);
    expect(got[0]!.bytes).toBeGreaterThan(80);
  });
});

describe('Acceso en red local', () => {
  it('apagado por defecto; al activarlo abre un segundo puerto con la misma autenticación (HTTP y WebSocket)', async () => {
    const dataDir = tmpDir();
    const run: RunningJarvis = await startJarvis(loadConfig({}, { dataDir, logLevel: 'silent', port: 0 }), { ephemeralToken: true });
    cleanup.push(() => run.close());
    expect(run.jarvis.remote!.status()).toMatchObject({ mode: 'off', listening: false, urls: [] });
    const lanPort = 20000 + Math.floor(Math.random() * 20000);
    const st = await run.jarvis.remote!.configure(USER, { mode: 'lan', port: lanPort, publicUrl: 'https://mi-pc.tail1234.ts.net' });
    expect(st).toMatchObject({ mode: 'lan', listening: true, port: lanPort, publicUrl: 'https://mi-pc.tail1234.ts.net' });
    expect(run.jarvis.remote!.pairingBase()).toBe('https://mi-pc.tail1234.ts.net');
    await expect(run.jarvis.remote!.configure(USER, { publicUrl: 'http://inseguro' })).rejects.toThrow(/https/);

    const base = `http://127.0.0.1:${lanPort}`;
    expect((await fetch(`${base}/api/health`)).status).toBe(401);
    expect((await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${run.token}` } })).status).toBe(200);
    const pair = await (await fetch(`${base}/api/pair/start`, { method: 'POST', headers: { authorization: `Bearer ${run.token}`, 'content-type': 'application/json' }, body: '{}' })).json() as { code: string; qr: string; link: string };
    expect(pair.link).toBe(`https://mi-pc.tail1234.ts.net/#/pair?code=${pair.code}`);
    expect(pair.qr).toMatch(/^data:image\/png;base64,/);

    const ws = new WebSocket(`ws://127.0.0.1:${lanPort}/api/events?token=${run.token}`);
    const hello = await new Promise<string>((resolve, reject) => { ws.once('message', (m) => resolve(String(m))); ws.once('error', reject); });
    expect(JSON.parse(hello).type).toBe('hello');
    ws.close();

    await run.jarvis.remote!.configure(USER, { mode: 'off' });
    await expect(fetch(`${base}/api/ping`)).rejects.toThrow();
    await expect(run.jarvis.remote!.configure({ kind: 'agent', id: 'x' }, { mode: 'lan' })).rejects.toThrow(/usuario/);
  });
});
