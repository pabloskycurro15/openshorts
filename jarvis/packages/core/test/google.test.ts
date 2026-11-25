import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { buildEmail, googleConnector, messageText } from '../src/connectors/google';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'jarvis' };
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** Google simulado: OAuth, Gmail, Calendar y Drive. */
function fakeGoogle() {
  const calls: Call[] = [];
  let tokenN = 0;
  let challenge = '';
  const state = { expiresIn: 3600, refreshValid: true };
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? init.body : init.body ? Buffer.from(init.body as Uint8Array).toString('utf8') : '';
    calls.push({ url, method: init.method ?? 'GET', headers, body });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        if (createHash('sha256').update(p.get('code_verifier')!).digest('base64url') !== challenge) return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: `at${++tokenN}`, expires_in: state.expiresIn, refresh_token: 'rt-secreto', scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file' });
      }
      if (!state.refreshValid) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      return json({ access_token: `at${++tokenN}`, expires_in: 3600 });
    }
    if (!headers.authorization?.startsWith('Bearer at')) return json({ error: { message: 'unauthenticated' } }, 401);
    if (url.endsWith('/v1/userinfo')) return json({ email: 'yo@gmail.com' });
    if (url.includes('/gmail/v1/users/me/messages?')) return json({ messages: [{ id: 'msg000001' }] });
    if (url.includes('/messages/msg000001?format=metadata')) return json({ id: 'msg000001', threadId: 't1', snippet: 'Hola…', labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: 'Ana <ana@x.com>' }, { name: 'Subject', value: 'Cena' }, { name: 'Date', value: 'hoy' }] } });
    if (url.includes('/messages/msg000001?format=full')) return json({ id: 'msg000001', threadId: 't1', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Ana <ana@x.com>' }, { name: 'Subject', value: 'Cena' }], parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64url('<p>No</p>') } }, { mimeType: 'text/plain', body: { data: b64url('¿Cenamos el viernes?') } }] },
      { mimeType: 'application/pdf', filename: 'menu.pdf', body: { size: 10 } }] } });
    if (url.endsWith('/drafts')) return json({ id: 'd1' });
    if (url.endsWith('/messages/send')) return json({ id: 's1' });
    if (url.includes('/calendar/v3/calendars/primary/events?')) return json({ items: [{ id: 'e1', summary: 'Dentista', htmlLink: 'https://cal/e1', start: { dateTime: '2026-11-26T10:00:00+01:00' }, end: { dateTime: '2026-11-26T11:00:00+01:00' } }] });
    if (url.endsWith('/calendar/v3/calendars/primary/events')) return json({ id: 'e2', htmlLink: 'https://cal/e2' });
    if (url.includes('/upload/drive/v3/files')) return json({ id: 'up1', name: 'carta.txt', webViewLink: 'https://drive/up1' });
    if (url.includes('/drive/v3/files?')) return json({ files: [{ id: 'doc0000000001', name: 'Plan', mimeType: 'application/vnd.google-apps.document', modifiedTime: 'x' }] });
    if (url.includes('/drive/v3/files/doc0000000001?fields')) return json({ id: 'doc0000000001', name: 'Plan', mimeType: 'application/vnd.google-apps.document' });
    if (url.includes('/drive/v3/files/doc0000000001/export')) return new Response('Texto del plan', { status: 200 });
    return json({ error: { message: 'no encontrado' } }, 404);
  }) as typeof fetch;
  return { f, calls, state, setChallenge: (c: string) => { challenge = c; } };
}

const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

async function setup() {
  const fg = fakeGoogle();
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent', port: 7777 }), { dbFile: ':memory:', embedder: null, connectors: [googleConnector()], fetch: fg.f });
  await j.start();
  running.push(j);
  return { j, ...fg };
}

async function authorize(j: Jarvis, fg: ReturnType<typeof fakeGoogle>) {
  j.connectors.configure(USER, 'google', { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-secreto' });
  const { url } = (await j.connectors.action(USER, 'google', 'authorize', {})) as { url: string };
  const u = new URL(url);
  fg.setChallenge(u.searchParams.get('code_challenge')!);
  return u;
}

describe('Google: utilidades', () => {
  it('correo RFC 2822 con asunto UTF-8 y texto del mensaje', () => {
    const raw = decode(buildEmail({ to: ['a@b.com'], subject: 'Reunión ✓', body: 'Hola, ¿qué tal?' }));
    expect(raw).toContain('To: a@b.com\r\n');
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Reunión ✓').toString('base64')}?=`);
    expect(Buffer.from(raw.split('\r\n\r\n')[1]!, 'base64').toString('utf8')).toBe('Hola, ¿qué tal?');
    expect(messageText({ mimeType: 'text/html', body: { data: b64url('<style>x</style><p>Hola&nbsp;<b>Ana</b></p>') } })).toBe('Hola Ana');
  });
});

describe('Google: OAuth', () => {
  it('URL con PKCE y redirección local; «state» de un solo uso; token de actualización cifrado', async () => {
    const { j, calls, ...fg } = await setup();
    expect(await j.connectors.enable(USER, 'google')).toMatchObject({ ok: false, detail: expect.stringContaining('Faltan datos') });
    const u = await authorize(j, { calls, ...fg } as ReturnType<typeof fakeGoogle>);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: 'cid.apps.googleusercontent.com', redirect_uri: 'http://127.0.0.1:7777/oauth/google/callback', code_challenge_method: 'S256', access_type: 'offline' });
    expect(u.searchParams.get('scope')).toContain('gmail.compose');
    expect(await j.connectors.enable(USER, 'google')).toMatchObject({ ok: false, detail: expect.stringContaining('Conectar con Google') });

    await expect(j.connectors.oauthCallback('google', { code: 'c', state: 'inventado' })).rejects.toThrow(/desconocida/);
    await expect(j.connectors.oauthCallback('google', { error: 'access_denied' })).rejects.toThrow(/cancelado/);
    const msg = await j.connectors.oauthCallback('google', { code: 'c1', state: u.searchParams.get('state')! });
    expect(msg).toContain('Google autorizado');
    const ex = calls.find((c) => c.body.includes('authorization_code'))!;
    expect(new URLSearchParams(ex.body).get('redirect_uri')).toBe('http://127.0.0.1:7777/oauth/google/callback');
    await expect(j.connectors.oauthCallback('google', { code: 'c1', state: u.searchParams.get('state')! })).rejects.toThrow(/desconocida/);
    expect(j.vault.get('connector.google.refreshToken')).toBe('rt-secreto');
    expect(JSON.stringify(j.connectors.list())).not.toContain('rt-secreto');
    expect(JSON.stringify(j.connectors.list())).not.toContain('GOCSPX-secreto');

    expect(await j.connectors.enable(USER, 'google')).toEqual({ ok: true, detail: 'Conectado como yo@gmail.com' });
    expect(j.connectors.list()[0]!.status).toMatchObject({ account: 'yo@gmail.com', authorized: true });

    await j.connectors.action(USER, 'google', 'disconnect', {});
    expect(calls.at(-1)!.url).toContain('oauth2.googleapis.com/revoke');
    expect(j.vault.get('connector.google.refreshToken')).toBeNull();
  });

  it('renueva el token de acceso al caducar; si Google lo revoca, pide reconectar', async () => {
    const fg = await setup();
    fg.state.expiresIn = 0;
    const u = await authorize(fg.j, fg);
    await fg.j.connectors.oauthCallback('google', { code: 'c', state: u.searchParams.get('state')! });
    await fg.j.connectors.enable(USER, 'google');
    const refreshes = () => fg.calls.filter((c) => c.body.includes('grant_type=refresh_token')).length;
    expect(refreshes()).toBe(1);
    await fg.j.tools.invoke(USER, 'calendar.events', {});
    expect(refreshes()).toBe(1); // el nuevo dura 1 h
    // Google revoca el acceso: el siguiente refresco falla y se borra el token guardado.
    const j2 = await setup();
    j2.state.expiresIn = 0;
    const u2 = await authorize(j2.j, j2);
    await j2.j.connectors.oauthCallback('google', { code: 'c', state: u2.searchParams.get('state')! });
    j2.state.refreshValid = false;
    expect(await j2.j.connectors.enable(USER, 'google')).toMatchObject({ ok: false, detail: expect.stringContaining('retiró la autorización') });
    expect(j2.j.vault.get('connector.google.refreshToken')).toBeNull();
  });
});

describe('Google: herramientas', () => {
  async function ready() {
    const fg = await setup();
    const u = await authorize(fg.j, fg);
    await fg.j.connectors.oauthCallback('google', { code: 'c', state: u.searchParams.get('state')! });
    await fg.j.connectors.enable(USER, 'google');
    return fg;
  }

  it('Gmail: buscar y leer piden permiso; borrador; enviar siempre confirma', async () => {
    const { j, calls } = await ready();
    expect(await j.tools.invoke(AGENT, 'gmail.search', { query: 'is:unread' }, { interactive: true })).toMatchObject({ status: 'pending_approval' });
    expect(await j.tools.invoke(USER, 'gmail.search', { query: 'is:unread' })).toMatchObject({ status: 'ok', output: [{ id: 'msg000001', from: 'Ana <ana@x.com>', subject: 'Cena', unread: true }] });
    expect(calls.find((c) => c.url.includes('messages?'))!.url).toContain('q=is%3Aunread');
    expect(await j.tools.invoke(USER, 'gmail.read', { id: 'msg000001' })).toMatchObject({ status: 'ok', output: { text: '¿Cenamos el viernes?', attachments: ['menu.pdf'] } });

    expect(await j.tools.invoke(USER, 'gmail.draft', { to: 'no-es-correo', subject: 'x', body: 'y' })).toMatchObject({ status: 'error' });
    expect(await j.tools.invoke(USER, 'gmail.draft', { to: 'ana@x.com', subject: 'Re: Cena', body: 'Sí, el viernes.', threadId: 't1' })).toMatchObject({ status: 'ok', output: { draftId: 'd1' } });
    const draft = JSON.parse(calls.find((c) => c.url.endsWith('/drafts'))!.body);
    expect(draft.message.threadId).toBe('t1');
    expect(decode(draft.message.raw)).toContain('To: ana@x.com');

    const r = await j.tools.invoke(AGENT, 'gmail.send', { to: 'ana@x.com', subject: 'Hola', body: 'Prueba' }, { interactive: true });
    expect(r.status).toBe('pending_approval');
    expect(calls.some((c) => c.url.endsWith('/messages/send'))).toBe(false);
    await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved_always');
    expect(calls.some((c) => c.url.endsWith('/messages/send'))).toBe(true);
    expect((await j.tools.invoke(AGENT, 'gmail.send', { to: 'ana@x.com', subject: 'Otra', body: 'x' }, { interactive: true })).status).toBe('pending_approval');
  });

  it('Calendar: eventos y crear con zona horaria local', async () => {
    const { j, calls } = await ready();
    expect(await j.tools.invoke(USER, 'calendar.events', { from: '2026-11-26', to: '2026-11-27' })).toMatchObject({ status: 'ok', output: [{ title: 'Dentista', allDay: false }] });
    const r = await j.tools.invoke(USER, 'calendar.create_event', { title: 'Llamar al bar', start: '2026-11-27T17:30' });
    expect(r.status).toBe('pending_approval');
    await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved');
    const body = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'))!.body);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(body).toMatchObject({ summary: 'Llamar al bar', start: { dateTime: '2026-11-27T17:30:00', timeZone: tz }, end: { dateTime: '2026-11-27T18:30:00', timeZone: tz } });
    const allDay = await j.tools.invoke(USER, 'calendar.create_event', { title: 'Vacaciones', start: '2026-12-24' });
    await j.tools.resolveApproval(USER, (allDay as { approvalId: string }).approvalId, 'approved');
    expect(JSON.parse(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/events')).at(-1)!.body)).toMatchObject({ start: { date: '2026-12-24' }, end: { date: '2026-12-25' } });
  });

  it('Drive: buscar, leer un Documento y subir solo desde carpetas autorizadas', async () => {
    const { j, calls } = await ready();
    expect(await j.tools.invoke(USER, 'drive.search', { query: "plan d'empresa" })).toMatchObject({ status: 'ok', output: [{ id: 'doc0000000001', name: 'Plan' }] });
    expect(new URL(calls.at(-1)!.url).searchParams.get('q')).toContain("name contains 'plan d\\'empresa'");
    expect(await j.tools.invoke(USER, 'drive.read', { id: 'doc0000000001' })).toMatchObject({ status: 'ok', output: { text: 'Texto del plan' } });

    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'carta.txt'), 'Querido bar…');
    j.control.set(USER, { folders: [{ id: 'docs', label: 'Docs', path: dir, access: 'read' }], apps: [], commands: [] });
    expect(await j.tools.invoke(USER, 'drive.upload', { path: '/etc/passwd' })).toMatchObject({ status: 'error' });
    const r = await j.tools.invoke(USER, 'drive.upload', { path: 'carta.txt' });
    expect(r.status).toBe('pending_approval');
    expect(await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'ok', output: { id: 'up1' } });
    const up = calls.find((c) => c.url.includes('/upload/'))!;
    expect(up.headers['content-type']).toMatch(/^multipart\/related; boundary=/);
    expect(up.body).toContain('"name":"carta.txt"');
    expect(up.body).toContain('Querido bar…');
  });

  it('la vuelta OAuth por HTTP no necesita el token de JARVIS y muestra una página', async () => {
    const fg = await setup();
    const u = await authorize(fg.j, fg);
    const app = await buildServer(fg.j, 'z'.repeat(43));
    const bad = await app.inject({ url: '/oauth/google/callback?code=x&state=nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['content-security-policy']).toContain("default-src 'none'");
    const ok = await app.inject({ url: `/oauth/google/callback?code=c&state=${u.searchParams.get('state')}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('Conexión completada');
    await app.close();
  });
});
