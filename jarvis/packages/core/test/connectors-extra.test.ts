import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { vintedConnector } from '../src/connectors/vinted';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'jarvis' };
const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

describe('Vinted (experimental, web simulada)', () => {
  it('bandeja y conversación con la cookie; responder exige CSRF y confirmación; sesión caducada se explica', async () => {
    let expired = false;
    const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ url, method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : '' });
      if (expired || headers.cookie !== 'access_token_web=abc; _vinted_es_session=xyz') return new Response('{"code":100}', { status: 401 });
      if (url.startsWith('https://www.vinted.es/api/v2/inbox')) return Response.json({ conversations: [{ id: 11, description: '¿Lo dejas en 15 €?', unread: true, updated_at: '2026-11-25T10:00:00Z', opposite_user: { login: 'maria88' }, item_count: 1 }, { id: 12, description: 'Gracias', unread: false, opposite_user: { login: 'juan' } }], pagination: { total_entries: 2 } });
      if (url === 'https://www.vinted.es/api/v2/conversations/11') return Response.json({ conversation: { opposite_user: { login: 'maria88', id: 5 }, subtitle: 'Chaqueta vaquera', messages: [{ entity_type: 'message', entity: { body: 'Hola, ¿sigue disponible?', user_id: 5 } }, { entity_type: 'message', entity: { body: 'Sí', user_id: 9 } }, { entity_type: 'offer_request_message', entity: { title: 'Oferta', subtitle: '15,00 €', user_id: 5 } }] } });
      if (url === 'https://www.vinted.es/inbox/11') return new Response('<html><meta name="csrf-token" content="tok123"></html>', { status: 200 });
      if (url === 'https://www.vinted.es/api/v2/conversations/11/replies') return headers['x-csrf-token'] === 'tok123' ? Response.json({ reply: { id: 1 } }) : new Response('{}', { status: 422 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: [vintedConnector()], fetch: f });
    await j.start();
    running.push(j);
    expect(j.connectors.list()[0]).toMatchObject({ official: false, warning: expect.stringContaining('EXPERIMENTAL') });
    j.connectors.configure(USER, 'vinted', { cookie: 'access_token_web=abc; _vinted_es_session=xyz' });
    expect(await j.connectors.enable(USER, 'vinted')).toEqual({ ok: true, detail: 'Sesión válida · 2 conversación(es)' });
    expect(await j.tools.invoke(AGENT, 'vinted.inbox', {}, { interactive: true })).toMatchObject({ status: 'pending_approval' });
    expect(await j.tools.invoke(USER, 'vinted.inbox', { unreadOnly: true })).toMatchObject({ status: 'ok', output: [{ id: 11, with: 'maria88', unread: true }] });
    expect(await j.tools.invoke(USER, 'vinted.read', { conversationId: 11 })).toMatchObject({ status: 'ok', output: { with: 'maria88', subject: 'Chaqueta vaquera', messages: [{ from: 'maria88', text: 'Hola, ¿sigue disponible?' }, { from: 'yo', text: 'Sí' }, { from: 'maria88', text: 'Oferta · 15,00 €' }] } });
    const r = await j.tools.invoke(USER, 'vinted.reply', { conversationId: 11, text: 'Vale, 15 € y te lo envío mañana' });
    expect(r.status).toBe('pending_approval');
    expect(await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'ok', output: { sent: true } });
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/replies'))!.body)).toMatchObject({ reply: { body: 'Vale, 15 € y te lo envío mañana' } });
    expect(calls.every((c) => c.headers['user-agent']?.includes('Mozilla'))).toBe(true);
    expired = true;
    expect(await j.tools.invoke(USER, 'vinted.inbox', {})).toMatchObject({ status: 'error', error: expect.stringContaining('sesión de Vinted ha caducado') });
  });
});

describe('Adobe Express (puente con ticket)', () => {
  it('abre el editor en localhost con ticket; guarda exportaciones solo en la carpeta elegida; página con CSP y nonce', async () => {
    const dir = tmpDir();
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent', port: 7777 }), { dbFile: ':memory:', embedder: null });
    await j.start();
    running.push(j);
    j.control.set(USER, { folders: [{ id: 'disenos', label: 'Diseños', path: dir, access: 'readwrite' }], apps: [], commands: [] });
    j.connectors.configure(USER, 'adobe', { clientId: 'a'.repeat(32), folder: dir });
    expect(await j.connectors.enable(USER, 'adobe')).toMatchObject({ ok: true });
    const { url } = (await j.connectors.action(USER, 'adobe', 'open', { preset: 'thumbnail' })) as { url: string };
    expect(url).toMatch(/^http:\/\/localhost:7777\/adobe-express#t=[\w-]{32}&c=a{32}&w=1280&h=720/);
    const ticket = /t=([\w-]+)/.exec(url)![1]!;

    const app = await buildServer(j, 'z'.repeat(43));
    const page = await app.inject({ url: '/adobe-express' });
    const csp = String(page.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(page.body).toContain(`<script type="module" nonce="${nonce}">`);
    expect(csp).not.toContain("'unsafe-inline' https://cc-embed");
    expect(csp).toContain('https://cc-embed.adobe.com');

    const png = `data:image/png;base64,${Buffer.from('\x89PNG\r\n\x1a\nfalso').toString('base64')}`;
    const ok = await app.inject({ method: 'POST', url: '/adobe-express/upload', payload: { ticket, data: png, name: 'Miniatura de YouTube' } });
    expect(ok.statusCode).toBe(200);
    const saved = ok.json().file as string;
    expect(saved).toMatch(/^adobe-Miniatura-de-YouTube-\d{14}\.png$/);
    expect(fs.existsSync(path.join(dir, saved))).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/adobe-express/upload', payload: { ticket: 'x'.repeat(32), data: png } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/adobe-express/upload', payload: { ticket, data: 'data:text/html;base64,PHNjcmlwdD4=' } })).json().error).toMatch(/no admitido/);
    await app.close();
  });
});
