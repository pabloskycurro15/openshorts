import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';

export const GOOGLE_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SEND_LIMIT_PER_HOUR = 20;

const EMAIL = z.string().trim().email();
const EMAILS = z.string().min(3).max(1000).transform((s, c) => {
  const list = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!list.length || list.some((e) => !EMAIL.safeParse(e).success)) { c.addIssue({ code: 'custom', message: 'Direcciones de correo no válidas' }); return z.NEVER; }
  return list;
});
/** Fecha y hora ISO (con o sin zona) o día completo AAAA-MM-DD. */
const WHEN = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/, 'Usa AAAA-MM-DD o AAAA-MM-DDTHH:MM');

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Cabecera MIME codificada (asuntos con tildes y emojis). */
const mimeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

/** Construye un correo RFC 2822 en texto plano UTF-8 (para enviar o guardar como borrador). */
export function buildEmail(o: { to: string[]; cc?: string[]; subject: string; body: string; inReplyTo?: string }): string {
  const headers = [
    `To: ${o.to.join(', ')}`,
    ...(o.cc?.length ? [`Cc: ${o.cc.join(', ')}`] : []),
    `Subject: ${mimeHeader(o.subject.replace(/[\r\n]+/g, ' '))}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(o.body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return b64url(Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8'));
}

type GPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GPart[]; filename?: string };
/** Extrae el texto de un mensaje de Gmail (prefiere text/plain; si no, HTML sin etiquetas). */
export function messageText(p: GPart): string {
  const find = (x: GPart, mime: string): string | null => {
    if (x.mimeType === mime && x.body?.data && !x.filename) return fromB64url(x.body.data).toString('utf8');
    for (const c of x.parts ?? []) { const r = find(c, mime); if (r) return r; }
    return null;
  };
  const plain = find(p, 'text/plain');
  if (plain) return plain;
  const html = find(p, 'text/html');
  if (!html) return '';
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

const GOOGLE_DOCS_EXPORT: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

/**
 * Google (Gmail, Calendar y Drive) con OAuth 2.0 para apps de escritorio:
 * el usuario crea su propio cliente OAuth (gratis) y autoriza en el navegador.
 * PKCE + «state» de un solo uso; la vuelta llega al núcleo local (127.0.0.1).
 * El token de actualización se guarda cifrado; el de acceso solo en memoria.
 */
export function googleConnector(): ConnectorDef {
  let access: { token: string; exp: number } | null = null;
  const pendingAuth = new Map<string, { verifier: string; redirect: string; exp: number }>();
  const sends: number[] = [];
  let account: string | null = null;

  const redirectUri = (ctx: ConnectorCtx) => `${ctx.baseUrl()}/oauth/google/callback`;

  async function token(ctx: ConnectorCtx): Promise<string> {
    if (access && access.exp > Date.now() + 60_000) return access.token;
    const refresh = ctx.getSecret('refreshToken');
    if (!refresh) throw new Error('Google no está autorizado: pulsa «Conectar con Google» en Conectores');
    try {
      const r = await jsonFetch<{ access_token: string; expires_in: number }>(ctx.fetch, TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: ctx.get('clientId') ?? '', client_secret: ctx.get('clientSecret') ?? '', refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
      });
      access = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
      return access.token;
    } catch (err) {
      if (/invalid_grant/.test((err as Error).message)) {
        ctx.setSecret('refreshToken', null);
        throw new Error('Google retiró la autorización (caducada o revocada): vuelve a pulsar «Conectar con Google»', { cause: err });
      }
      throw err;
    }
  }

  const g = async <T>(ctx: ConnectorCtx, url: string, init: RequestInit & { timeoutMs?: number } = {}) =>
    jsonFetch<T>(ctx.fetch, url, { ...init, headers: { authorization: `Bearer ${await token(ctx)}`, ...(init.headers as Record<string, string> | undefined) } });

  const header = (h: { name: string; value: string }[] | undefined, n: string) => h?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';

  return {
    id: 'google',
    name: 'Google (Gmail, Calendar, Drive)',
    description: 'Lee y busca tu correo, prepara borradores y envía con confirmación; consulta y crea eventos; busca, lee y sube archivos de Drive.',
    official: true,
    warning: 'Usa tu propio cliente OAuth de Google Cloud (gratis). Mientras la app esté en modo «prueba», Google mostrará un aviso de «app no verificada» y pedirá autorizar de nuevo cada 7 días.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    fields: [
      { key: 'clientId', label: 'ID de cliente OAuth', secret: false, required: true, placeholder: '1234…apps.googleusercontent.com', help: 'Google Cloud → APIs y servicios → Credenciales → Crear ID de cliente OAuth → «App de escritorio».' },
      { key: 'clientSecret', label: 'Secreto de cliente', secret: true, required: true, placeholder: 'GOCSPX-…' },
    ],
    secretKeys: ['refreshToken'],
    async test(ctx) {
      if (!ctx.getSecret('refreshToken')) return { ok: false, detail: 'Falta autorizar: pulsa «Conectar con Google»' };
      const u = await g<{ email?: string }>(ctx, 'https://openidconnect.googleapis.com/v1/userinfo');
      account = u.email ?? null;
      return { ok: true, detail: `Conectado como ${u.email ?? 'tu cuenta de Google'}` };
    },
    status: (ctx) => ({ account, authorized: !!ctx.getSecret('refreshToken'), redirectUri: redirectUri(ctx), sendsLastHour: sends.filter((t) => t > Date.now() - 3600_000).length, sendLimit: SEND_LIMIT_PER_HOUR }),
    actions: {
      /** Devuelve la URL de autorización de Google (se abre en el navegador). */
      async authorize(ctx) {
        const clientId = ctx.get('clientId');
        if (!clientId || !ctx.get('clientSecret')) throw new Error('Guarda antes el ID y el secreto de cliente');
        const now = Date.now();
        for (const [k, v] of pendingAuth) if (v.exp < now) pendingAuth.delete(k);
        const state = b64url(randomBytes(24));
        const verifier = b64url(randomBytes(48));
        const redirect = redirectUri(ctx);
        pendingAuth.set(state, { verifier, redirect, exp: now + 10 * 60_000 });
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
          access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
          code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
        }).toString();
        return { url: url.toString(), redirectUri: redirect };
      },
      async disconnect(ctx) {
        const refresh = ctx.getSecret('refreshToken');
        if (refresh) await jsonFetch(ctx.fetch, `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => undefined);
        ctx.setSecret('refreshToken', null);
        access = null;
        account = null;
        return { ok: true };
      },
    },
    async oauthCallback(ctx, q) {
      if (q.error) throw new Error(q.error === 'access_denied' ? 'Has cancelado la autorización en Google' : `Google respondió: ${q.error}`);
      const p = q.state ? pendingAuth.get(q.state) : undefined;
      if (!p || p.exp < Date.now() || !q.code) throw new Error('Solicitud de autorización desconocida o caducada: vuelve a pulsar «Conectar con Google»');
      pendingAuth.delete(q.state!);
      const r = await jsonFetch<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(ctx.fetch, TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: ctx.get('clientId') ?? '', client_secret: ctx.get('clientSecret') ?? '', code: q.code, code_verifier: p.verifier, redirect_uri: p.redirect, grant_type: 'authorization_code' }).toString(),
      });
      if (!r.refresh_token) throw new Error('Google no devolvió un token de actualización. Quita el acceso de JARVIS en tu cuenta de Google y vuelve a conectar.');
      ctx.setSecret('refreshToken', r.refresh_token);
      access = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
      const granted = (r.scope ?? '').split(' ');
      const missing = GOOGLE_SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s));
      return missing.length
        ? `Autorizado, pero sin algunos permisos (${missing.map((s) => s.split('/').pop()).join(', ')}): esas funciones fallarán.`
        : 'Google autorizado. Vuelve a JARVIS y pulsa «Activar».';
    },
    tools: (ctx) => [
      // ── Gmail ──
      defineTool({
        name: 'gmail.search', description: 'Busca correos en Gmail con la sintaxis de Gmail (p. ej. «is:unread», «from:ana newer_than:7d»).',
        parameters: z.object({ query: z.string().max(500).default('in:inbox'), limit: z.number().int().min(1).max(25).default(10) }),
        permissions: ['connector.google.gmail.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA remitentes, asuntos y extractos de tu correo'], returns: 'Id, remitente, asunto, fecha, extracto y si está sin leer.',
        async execute({ query, limit }) {
          const list = await g<{ messages?: { id: string }[] }>(ctx, `${GMAIL}/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`);
          const out = [];
          for (const m of list.messages ?? []) {
            const d = await g<{ id: string; threadId: string; snippet: string; labelIds?: string[]; payload: { headers: { name: string; value: string }[] } }>(ctx, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
            out.push({ id: d.id, threadId: d.threadId, from: header(d.payload.headers, 'From'), subject: header(d.payload.headers, 'Subject'), date: header(d.payload.headers, 'Date'), snippet: d.snippet, unread: d.labelIds?.includes('UNREAD') ?? false });
          }
          return out;
        },
      }),
      defineTool({
        name: 'gmail.read', description: 'Lee el contenido completo de un correo de Gmail por su id.',
        parameters: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/) }),
        permissions: ['connector.google.gmail.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA el contenido de un correo'], returns: 'Remitente, destinatarios, asunto, fecha, texto (máx. 20 000 caracteres) y adjuntos.',
        async execute({ id }) {
          const d = await g<{ id: string; threadId: string; payload: GPart & { headers: { name: string; value: string }[] } }>(ctx, `${GMAIL}/messages/${id}?format=full`);
          const h = d.payload.headers;
          const attachments: string[] = [];
          const walk = (p: GPart) => { if (p.filename) attachments.push(p.filename); p.parts?.forEach(walk); };
          walk(d.payload);
          const text = messageText(d.payload);
          return { id: d.id, threadId: d.threadId, from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'), subject: header(h, 'Subject'), date: header(h, 'Date'), messageId: header(h, 'Message-ID'),
            text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n[recortado]` : text, attachments };
        },
      }),
      defineTool({
        name: 'gmail.draft', description: 'Guarda un borrador en Gmail (no se envía). Úsalo por defecto para preparar correos.',
        parameters: z.object({ to: EMAILS, cc: EMAILS.optional(), subject: z.string().min(1).max(300), body: z.string().min(1).max(50_000), threadId: z.string().max(40).optional(), inReplyTo: z.string().max(300).optional() }),
        permissions: ['connector.google.gmail.draft'], risk: 'medium', sideEffects: true,
        risks: ['Crea un borrador en tu Gmail (no se envía)'], returns: 'Id del borrador.',
        async execute({ to, cc, subject, body, threadId, inReplyTo }) {
          const raw = buildEmail({ to, cc, subject, body, inReplyTo });
          const r = await g<{ id: string }>(ctx, `${GMAIL}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
          return { draftId: r.id, note: 'Borrador guardado en Gmail; revísalo y envíalo cuando quieras.' };
        },
      }),
      defineTool({
        name: 'gmail.send', description: 'Envía un correo desde tu Gmail. Pide confirmación SIEMPRE; máximo 20 por hora.',
        parameters: z.object({ to: EMAILS, cc: EMAILS.optional(), subject: z.string().min(1).max(300), body: z.string().min(1).max(50_000), threadId: z.string().max(40).optional(), inReplyTo: z.string().max(300).optional() }),
        permissions: ['connector.google.gmail.send'], risk: 'critical', sideEffects: true,
        risks: ['Se envía en tu nombre y no se puede deshacer', 'Enviar publicidad no solicitada puede infringir la LSSI/RGPD'],
        returns: 'Id del mensaje enviado.',
        async execute({ to, cc, subject, body, threadId, inReplyTo }) {
          const now = Date.now();
          while (sends.length && sends[0]! < now - 3600_000) sends.shift();
          if (sends.length >= SEND_LIMIT_PER_HOUR) throw new Error(`Límite de ${SEND_LIMIT_PER_HOUR} correos por hora alcanzado`);
          const raw = buildEmail({ to, cc, subject, body, inReplyTo });
          const r = await g<{ id: string }>(ctx, `${GMAIL}/messages/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
          sends.push(now);
          return { sent: true, id: r.id, to };
        },
      }),
      // ── Calendar ──
      defineTool({
        name: 'calendar.events', description: 'Lista los eventos de tu calendario principal entre dos fechas (por defecto, desde ahora hasta 7 días).',
        parameters: z.object({ from: WHEN.optional(), to: WHEN.optional(), query: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(20) }),
        permissions: ['connector.google.calendar.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA tu agenda'], returns: 'Título, inicio, fin, lugar y enlace de cada evento.',
        async execute({ from, to, query, limit }) {
          const iso = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : s).toISOString();
          const timeMin = from ? iso(from) : new Date().toISOString();
          const timeMax = to ? iso(to) : new Date(Date.parse(timeMin) + 7 * 86_400_000).toISOString();
          const qs = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(limit), ...(query ? { q: query } : {}) });
          const r = await g<{ items?: { id: string; summary?: string; location?: string; htmlLink: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }[] }>(ctx, `${CAL}/events?${qs}`);
          return (r.items ?? []).map((e) => ({ id: e.id, title: e.summary ?? '(sin título)', start: e.start.dateTime ?? e.start.date, end: e.end.dateTime ?? e.end.date, allDay: !!e.start.date, location: e.location ?? null, url: e.htmlLink }));
        },
      }),
      defineTool({
        name: 'calendar.create_event', description: 'Crea un evento en tu calendario principal. Fechas «AAAA-MM-DDTHH:MM» (hora local) o «AAAA-MM-DD» para todo el día.',
        parameters: z.object({ title: z.string().min(1).max(300), start: WHEN, end: WHEN.optional(), description: z.string().max(8000).optional(), location: z.string().max(500).optional() }),
        permissions: ['connector.google.calendar.write'], risk: 'high', sideEffects: true,
        risks: ['Añade un evento a tu calendario (no invita a nadie)'], returns: 'Id y enlace del evento.',
        async execute({ title, start, end, description, location }) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const allDay = start.length === 10;
          const endV = end ?? (allDay ? new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null);
          const point = (v: string) => (v.length === 10 ? { date: v } : /(Z|[+-]\d{2}:\d{2})$/.test(v) ? { dateTime: v } : { dateTime: v.length === 16 ? `${v}:00` : v, timeZone: tz });
          let endPoint;
          if (endV) endPoint = point(endV);
          else {
            const d = new Date(Date.parse(start.length === 16 ? `${start}:00` : start) + 3600_000);
            const pad = (n: number) => String(n).padStart(2, '0');
            endPoint = { dateTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`, timeZone: tz };
          }
          const r = await g<{ id: string; htmlLink: string }>(ctx, `${CAL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ summary: title, description, location, start: point(start), end: endPoint }) });
          return { id: r.id, url: r.htmlLink };
        },
      }),
      // ── Drive ──
      defineTool({
        name: 'drive.search', description: 'Busca archivos en tu Google Drive por nombre o contenido.',
        parameters: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(15) }),
        permissions: ['connector.google.drive.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA nombres de tus archivos'], returns: 'Id, nombre, tipo, fecha y enlace.',
        async execute({ query, limit }) {
          const esc = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const qs = new URLSearchParams({ q: `(name contains '${esc}' or fullText contains '${esc}') and trashed = false`, pageSize: String(limit), fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)', orderBy: 'modifiedTime desc' });
          const r = await g<{ files: { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; webViewLink?: string }[] }>(ctx, `${DRIVE}/files?${qs}`);
          return r.files.map((f) => ({ id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime, size: f.size ? Number(f.size) : null, url: f.webViewLink ?? null }));
        },
      }),
      defineTool({
        name: 'drive.read', description: 'Lee el texto de un archivo de Drive (Documentos, Hojas como CSV, Presentaciones, o archivos de texto de hasta 1 MB).',
        parameters: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/) }),
        permissions: ['connector.google.drive.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA el contenido del archivo'], returns: 'Nombre y texto (máx. 50 000 caracteres).',
        async execute({ id }) {
          const meta = await g<{ id: string; name: string; mimeType: string; size?: string }>(ctx, `${DRIVE}/files/${id}?fields=id,name,mimeType,size`);
          let text: unknown;
          const exportAs = GOOGLE_DOCS_EXPORT[meta.mimeType];
          if (exportAs) text = await g(ctx, `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exportAs)}`);
          else if (/^text\/|json|xml|csv|markdown/.test(meta.mimeType) && Number(meta.size ?? 0) <= 1_048_576) text = await g(ctx, `${DRIVE}/files/${id}?alt=media`);
          else throw new Error(`No puedo leer este tipo de archivo como texto (${meta.mimeType})`);
          const s = typeof text === 'string' ? text : JSON.stringify(text);
          return { name: meta.name, type: meta.mimeType, text: s.length > 50_000 ? `${s.slice(0, 50_000)}\n[recortado]` : s };
        },
      }),
      defineTool({
        name: 'drive.upload', description: 'Sube a tu Google Drive un archivo de una carpeta autorizada (máx. 20 MB).',
        parameters: z.object({ path: z.string().min(1), name: z.string().min(1).max(200).optional(), folderId: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/).optional() }),
        permissions: (a) => { ctx.resolvePath(a.path); return ['connector.google.drive.upload']; },
        risk: 'high', sideEffects: true,
        risks: ['Copia el archivo a tu Drive (sale de este equipo)'], returns: 'Id y enlace del archivo subido.',
        async execute({ path: p, name, folderId }) {
          const abs = ctx.resolvePath(p);
          const st = fs.statSync(abs);
          if (!st.isFile()) throw new Error('No es un archivo');
          if (st.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB');
          const boundary = `jarvis${randomBytes(12).toString('hex')}`;
          const meta = JSON.stringify({ name: name ?? path.basename(abs), ...(folderId ? { parents: [folderId] } : {}) });
          const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
            fs.readFileSync(abs),
            Buffer.from(`\r\n--${boundary}--`),
          ]);
          const r = await g<{ id: string; name: string; webViewLink?: string }>(ctx, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
            method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body), timeoutMs: 120_000,
          });
          return { id: r.id, name: r.name, url: r.webViewLink ?? null };
        },
      }),
    ],
  };
}
