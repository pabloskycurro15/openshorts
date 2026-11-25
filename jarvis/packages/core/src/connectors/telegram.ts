import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';

interface TgUpdate { update_id: number; message?: { message_id: number; chat: { id: number; type: string; title?: string; first_name?: string; username?: string }; text?: string } }

/**
 * Telegram (API oficial de bots). El bot solo obedece al chat del propietario,
 * que el usuario autoriza desde la interfaz; el resto de chats se anotan y se ignoran.
 */
export function telegramConnector(opts: { baseUrl?: string; pollTimeoutSec?: number } = {}): ConnectorDef {
  const base = opts.baseUrl ?? 'https://api.telegram.org';
  let stopped = true;
  let loop: Promise<void> | null = null;
  let abort: AbortController | null = null;
  let bot: string | null = null;
  const pending = new Map<string, { chatId: string; name: string; text: string; ts: string }>();
  let lastError: string | null = null;

  const api = <T>(ctx: ConnectorCtx, method: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number) =>
    jsonFetch<{ ok: boolean; result: T }>(ctx.fetch, `${base}/bot${ctx.get('botToken')}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal, timeoutMs,
    }).then((r) => r.result);

  const send = async (ctx: ConnectorCtx, chatId: string, text: string) => {
    for (let i = 0; i < text.length; i += 4000) await api(ctx, 'sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000) });
  };

  async function poll(ctx: ConnectorCtx) {
    let offset = 0;
    while (!stopped) {
      try {
        abort = new AbortController();
        const updates = await api<TgUpdate[]>(ctx, 'getUpdates', { offset, timeout: opts.pollTimeoutSec ?? 25, allowed_updates: ['message'] }, abort.signal, ((opts.pollTimeoutSec ?? 25) + 10) * 1000);
        lastError = null;
        // Si el servidor devuelve al instante (sin long polling), no saturar el bucle.
        if (!updates.length) await new Promise((r) => setTimeout(r, 250));
        for (const u of updates) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text) continue;
          const chatId = String(m.chat.id);
          if (chatId !== ctx.get('ownerChatId')) {
            pending.set(chatId, { chatId, name: m.chat.title ?? m.chat.username ?? m.chat.first_name ?? chatId, text: m.text.slice(0, 200), ts: new Date().toISOString() });
            ctx.log('mensaje', 'info', `Mensaje de un chat no autorizado (${chatId}) ignorado`);
            continue;
          }
          if (ctx.lockdown()) {
            await send(ctx, chatId, '⛔ JARVIS está en modo emergencia. No ejecuto órdenes remotas.');
            continue;
          }
          ctx.log('orden', 'info', m.text.slice(0, 120));
          const reply = await ctx.converse(m.text, 'telegram');
          await send(ctx, chatId, reply);
        }
      } catch (err) {
        if (stopped) break;
        lastError = (err as Error).message;
        ctx.log('recibir', 'error', lastError);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  return {
    id: 'telegram',
    name: 'Telegram',
    description: 'Habla con JARVIS desde Telegram y recibe avisos. Usa un bot propio creado con @BotFather.',
    official: true,
    docsUrl: 'https://core.telegram.org/bots/tutorial',
    fields: [
      { key: 'botToken', label: 'Token del bot', secret: true, required: true, placeholder: '123456:ABC…', help: 'Créalo en Telegram con @BotFather → /newbot.' },
      { key: 'ownerChatId', label: 'Chat autorizado', secret: false, required: false, help: 'Escribe a tu bot y autoriza tu chat desde aquí. Solo ese chat puede dar órdenes.' },
    ],
    async test(ctx) {
      const me = await api<{ username: string }>(ctx, 'getMe');
      bot = me.username;
      return { ok: true, detail: `Bot @${me.username} conectado` };
    },
    async start(ctx) {
      stopped = false;
      if (!bot) await this.test(ctx).catch(() => undefined);
      loop = poll(ctx);
    },
    async stop() {
      stopped = true;
      abort?.abort();
      await loop?.catch(() => undefined);
      loop = null;
    },
    status: () => ({ bot, listening: !stopped, pendingChats: [...pending.values()], lastError }),
    actions: {
      async authorize(ctx, body) {
        const chatId = z.string().regex(/^-?\d{1,20}$/).parse(String(body.chatId));
        ctx.set('ownerChatId', chatId);
        pending.delete(chatId);
        await send(ctx, chatId, '✅ Chat autorizado. Ya puedes hablar con JARVIS por aquí.');
        return { ownerChatId: chatId };
      },
    },
    tools: (ctx) => [
      defineTool({
        name: 'telegram.send',
        description: 'Envía un mensaje de Telegram al usuario (solo a su chat autorizado). Útil para avisos.',
        parameters: z.object({ text: z.string().min(1).max(8000) }),
        permissions: ['connector.telegram.send'],
        risk: 'medium',
        sideEffects: true,
        risks: ['Envía un mensaje a tu chat de Telegram'],
        returns: 'Confirmación del envío.',
        async execute({ text }) {
          const chatId = ctx.get('ownerChatId');
          if (!chatId) throw new Error('No hay chat autorizado: escribe a tu bot y autorízalo en Conectores');
          await send(ctx, chatId, text);
          return { sent: true };
        },
      }),
    ],
  };
}
