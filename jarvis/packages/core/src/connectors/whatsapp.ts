import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';

/** Prefijo de las respuestas de JARVIS: evita que se interpreten como órdenes (bucles). */
export const WA_PREFIX = '🤖 JARVIS:';
const SEND_LIMIT_PER_HOUR = 15;

type WaMsg = { key: { remoteJid?: string | null; fromMe?: boolean | null; id?: string | null }; pushName?: string | null; messageTimestamp?: unknown; message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null };
type ConnUpdate = { connection?: 'open' | 'connecting' | 'close'; qr?: string; lastDisconnect?: { error?: unknown } };

/** Lo mínimo que JARVIS usa de un socket de WhatsApp (permite simularlo en pruebas). */
export interface WaSocket {
  user?: { id: string; lid?: string; name?: string } | null;
  ev: { on(event: 'connection.update', cb: (u: ConnUpdate) => void): void; on(event: 'messages.upsert', cb: (u: { messages: WaMsg[]; type: string }) => void): void };
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string | null } } | undefined>;
  requestPairingCode(phone: string): Promise<string>;
  logout(): Promise<void>;
  end(err?: Error): void;
}
export interface WaRuntime {
  create(sessionDir: string, logger: ConnectorCtx['logger']): Promise<{ sock: WaSocket; registered: boolean }>;
  normalize(jid: string): string;
  isLoggedOut(err: unknown): boolean;
}

/** Implementación real con Baileys (cliente no oficial de WhatsApp Web). */
export const baileysRuntime: WaRuntime = {
  async create(dir, logger) {
    const b = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await b.useMultiFileAuthState(dir);
    const { version } = await b.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = b.default({
      ...(version ? { version } : {}),
      auth: state,
      browser: b.Browsers.windows('JARVIS'),
      logger: logger.child({ module: 'whatsapp' }, { level: 'warn' }) as never,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock.ev.on('creds.update', saveCreds);
    return { sock: sock as unknown as WaSocket, registered: !!state.creds.registered };
  },
  normalize: (jid) => jid.replace(/:\d+(?=@)/, '').replace(/@c\.us$/, '@s.whatsapp.net'),
  isLoggedOut: (err) => (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode === 401,
};

const textOf = (m: WaMsg) => m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? null;

/** Normaliza un teléfono a dígitos con prefijo internacional (9 dígitos españoles → +34). */
export function normalizePhone(input: string): string {
  let d = input.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^[6789]\d{8}$/.test(d)) d = `34${d}`;
  if (!/^\d{8,15}$/.test(d)) throw new Error('Teléfono no válido: usa el formato internacional, p. ej. 34600111222');
  return d;
}

/**
 * WhatsApp personal vinculado como «dispositivo vinculado» (no oficial).
 * - Tu chat contigo mismo («Mensaje a ti mismo») es el canal de órdenes a JARVIS.
 * - Leer chats pide permiso; enviar a otros pide confirmación SIEMPRE (riesgo crítico) y tiene límite por hora.
 * - Solo ve los mensajes recibidos desde que se conecta (no descarga el historial).
 */
export function whatsappConnector(runtime: WaRuntime = baileysRuntime): ConnectorDef {
  let sock: WaSocket | null = null;
  let stopped = true;
  let state: 'off' | 'connecting' | 'qr' | 'open' | 'logged_out' = 'off';
  let qr: string | null = null;
  let pairingCode: string | null = null;
  let lastError: string | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const sentIds = new Set<string>();
  const sends: number[] = [];
  const chats = new Map<string, { name: string; messages: { from: string; text: string; ts: string; fromMe: boolean }[] }>();

  const sessionDir = (ctx: ConnectorCtx) => path.join(ctx.dataDir, 'whatsapp-session');
  const selfJids = () => [sock?.user?.id, sock?.user?.lid].filter((x): x is string => !!x).map(runtime.normalize);

  async function say(jid: string, text: string) {
    if (!sock || state !== 'open') throw new Error('WhatsApp no está conectado');
    const r = await sock.sendMessage(jid, { text });
    if (r?.key?.id) sentIds.add(r.key.id);
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value!);
  }

  async function onMessages(ctx: ConnectorCtx, messages: WaMsg[], live: boolean) {
    for (const m of messages) {
      const jid = m.key.remoteJid;
      const text = textOf(m);
      if (!jid || !text || jid.endsWith('@broadcast') || jid === 'status@broadcast') continue;
      if (m.key.id && sentIds.has(m.key.id)) continue;
      const nj = runtime.normalize(jid);
      const isSelf = selfJids().includes(nj);
      // Búfer en memoria de lo recibido desde la conexión (no se guarda en disco).
      const chat = chats.get(nj) ?? { name: isSelf ? 'Tú (mensajes a ti mismo)' : (m.key.fromMe ? nj.split('@')[0]! : (m.pushName ?? nj.split('@')[0]!)), messages: [] };
      if (!m.key.fromMe && m.pushName && !nj.endsWith('@g.us')) chat.name = m.pushName;
      chat.messages.push({ from: m.key.fromMe ? 'yo' : (m.pushName ?? nj.split('@')[0]!), text: text.slice(0, 4000), ts: new Date().toISOString(), fromMe: !!m.key.fromMe });
      if (chat.messages.length > 50) chat.messages.shift();
      chats.delete(nj);
      chats.set(nj, chat);
      if (chats.size > 100) chats.delete(chats.keys().next().value!);

      // Mensaje de otra persona: evento para las automatizaciones («al recibir un WhatsApp…»).
      if (live && !m.key.fromMe && !isSelf) ctx.emit('message', { from: nj.split('@')[0], name: chat.name, chat: nj, text: text.slice(0, 2000), group: nj.endsWith('@g.us') });
      // Órdenes: solo tus mensajes en tu propio chat, nunca los de otras personas.
      if (isSelf && m.key.fromMe && !text.startsWith(WA_PREFIX)) {
        if (ctx.lockdown()) {
          await say(jid, `${WA_PREFIX} ⛔ Modo emergencia activo. No ejecuto órdenes remotas.`).catch(() => undefined);
          continue;
        }
        ctx.log('orden', 'info', text.slice(0, 120));
        const reply = await ctx.converse(text, 'whatsapp');
        await say(jid, `${WA_PREFIX} ${reply}`).catch((err: Error) => ctx.log('responder', 'error', err.message));
      }
    }
  }

  async function connect(ctx: ConnectorCtx) {
    if (stopped) return;
    state = 'connecting';
    fs.mkdirSync(sessionDir(ctx), { recursive: true, mode: 0o700 });
    const { sock: s } = await runtime.create(sessionDir(ctx), ctx.logger);
    sock = s;
    s.ev.on('connection.update', (u) => {
      if (sock !== s) return;
      if (u.qr) {
        state = 'qr';
        void QRCode.toDataURL(u.qr, { margin: 1, width: 280, color: { dark: '#0a1020', light: '#ffffff' } }).then((d) => { qr = d; });
      }
      if (u.connection === 'open') {
        state = 'open';
        qr = null;
        pairingCode = null;
        lastError = null;
        ctx.log('conexión', 'info', 'WhatsApp vinculado y conectado');
      }
      if (u.connection === 'close') {
        sock = null;
        if (runtime.isLoggedOut(u.lastDisconnect?.error)) {
          state = 'logged_out';
          fs.rmSync(sessionDir(ctx), { recursive: true, force: true });
          ctx.log('conexión', 'info', 'Sesión cerrada desde el teléfono: hay que volver a vincular');
          return;
        }
        if (stopped) { state = 'off'; return; }
        state = 'connecting';
        lastError = (u.lastDisconnect?.error as Error | undefined)?.message ?? 'Conexión cerrada';
        reconnectTimer = setTimeout(() => { void connect(ctx).catch((err: Error) => { lastError = err.message; }); }, 3000);
        reconnectTimer.unref();
      }
    });
    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      void onMessages(ctx, messages, type === 'notify').catch((err: Error) => ctx.log('mensaje', 'error', err.message));
    });
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const s = sock;
    sock = null;
    state = 'off';
    qr = null;
    s?.end();
  }

  const resolveJid = (to: string) => {
    if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(to)) return to;
    const known = [...chats.entries()].find(([, c]) => c.name.toLowerCase() === to.toLowerCase());
    if (known) return known[0];
    return `${normalizePhone(to)}@s.whatsapp.net`;
  };

  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Habla con JARVIS desde «Mensaje a ti mismo», lee los chats recibidos y envía mensajes con tu confirmación.',
    official: false,
    warning: 'Conexión NO oficial (WhatsApp Web mediante Baileys). WhatsApp puede limitar o bloquear tu número si detecta uso automatizado. JARVIS nunca envía en masa: cada envío a otra persona pide tu confirmación y hay un máximo de 15 por hora. Enviar publicidad a quien no lo ha pedido puede infringir la ley (LSSI/RGPD).',
    docsUrl: 'https://faq.whatsapp.com/1317564962315842',
    fields: [{ key: 'phone', label: 'Tu número (para vincular con código)', secret: false, required: false, placeholder: '34600111222', help: 'Opcional: si no puedes escanear el QR, vincula con un código de 8 caracteres.' }],
    async test() {
      return { ok: true, detail: 'Listo para vincular: escanea el QR desde WhatsApp → Dispositivos vinculados' };
    },
    async start(ctx) {
      stopped = false;
      await connect(ctx);
    },
    stop: async () => stop(),
    status: () => ({
      state, qr, pairingCode, lastError,
      me: sock?.user && state === 'open' ? { name: sock.user.name ?? null, number: sock.user.id.split(/[:@]/)[0] } : null,
      chats: chats.size,
      sendsLastHour: sends.filter((t) => t > Date.now() - 3600_000).length,
      sendLimit: SEND_LIMIT_PER_HOUR,
    }),
    actions: {
      async pair(ctx, body) {
        const phone = normalizePhone(String(body.phone ?? ctx.get('phone') ?? ''));
        ctx.set('phone', phone);
        if (!sock || state !== 'qr') throw new Error('Activa el conector y espera a que aparezca el QR antes de pedir el código');
        pairingCode = await sock.requestPairingCode(phone);
        ctx.log('vincular', 'info', 'Código de vinculación generado');
        return { pairingCode };
      },
      async logout(ctx) {
        const s = sock;
        if (s && state === 'open') await s.logout().catch(() => undefined);
        stop();
        fs.rmSync(sessionDir(ctx), { recursive: true, force: true });
        chats.clear();
        state = 'logged_out';
        ctx.log('vincular', 'info', 'Dispositivo desvinculado y sesión borrada');
        return { ok: true };
      },
      async restart(ctx) {
        stopped = false;
        if (sock) return { state };
        await connect(ctx);
        return { state };
      },
    },
    tools: (ctx) => [
      defineTool({
        name: 'whatsapp.chats', description: 'Lista los chats de WhatsApp con mensajes recibidos desde que JARVIS se conectó.',
        parameters: z.object({}),
        permissions: ['connector.whatsapp.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA nombres y mensajes privados de tus contactos'], returns: 'Chats con nombre, número de mensajes y el último.',
        execute() {
          return [...chats.entries()].reverse().map(([jid, c]) => ({ chat: jid, name: c.name, messages: c.messages.length, last: c.messages.at(-1) ?? null }));
        },
      }),
      defineTool({
        name: 'whatsapp.read', description: 'Lee los mensajes recibidos de un chat (por nombre, número o identificador).',
        parameters: z.object({ chat: z.string().min(1).max(120), limit: z.number().int().min(1).max(50).default(20) }),
        permissions: ['connector.whatsapp.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA mensajes privados'], returns: 'Mensajes con remitente, texto y hora.',
        execute({ chat, limit }) {
          const c = chats.get(resolveJid(chat));
          if (!c) throw new Error('No hay mensajes de ese chat desde que JARVIS se conectó');
          return { name: c.name, messages: c.messages.slice(-limit) };
        },
      }),
      defineTool({
        name: 'whatsapp.send',
        description: 'Envía un mensaje de WhatsApp desde tu número a un contacto (número internacional o nombre de un chat reciente). Pide confirmación SIEMPRE.',
        parameters: z.object({ to: z.string().min(2).max(120), text: z.string().min(1).max(4000) }),
        permissions: ['connector.whatsapp.send'], risk: 'critical', sideEffects: true,
        risks: ['Se envía en tu nombre desde tu número personal', 'Uso automatizado no oficial: riesgo de bloqueo del número', 'No se puede deshacer'],
        returns: 'Confirmación del envío.',
        async execute({ to, text }) {
          const now = Date.now();
          while (sends.length && sends[0]! < now - 3600_000) sends.shift();
          if (sends.length >= SEND_LIMIT_PER_HOUR) throw new Error(`Límite de ${SEND_LIMIT_PER_HOUR} envíos por hora alcanzado (protección contra bloqueos)`);
          const jid = resolveJid(to);
          await say(jid, text);
          sends.push(now);
          ctx.log('enviar', 'info', `Mensaje enviado a ${jid.split('@')[0]!.replace(/\d(?=\d{3})/g, '•')}`);
          return { sent: true, to: jid };
        },
      }),
    ],
  };
}
