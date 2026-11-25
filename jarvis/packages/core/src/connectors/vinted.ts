import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type Conv = { id: number; description?: string; unread?: boolean; updated_at?: string; opposite_user?: { login?: string }; item_count?: number };
type Msg = { entity_type: string; entity?: { body?: string; user_id?: number; title?: string; subtitle?: string; price?: { amount?: string; currency_code?: string } | string }; created_at_ts?: string; created_time_ago?: string };

/**
 * Vinted — EXPERIMENTAL y NO OFICIAL. Vinted no ofrece API para particulares: este conector
 * usa la misma API interna que su web con la sesión de tu navegador (cookie que tú copias).
 * Puede dejar de funcionar sin aviso, la sesión caduca y Vinted podría limitar la cuenta.
 * Alternativa estable: Vinted avisa por correo de cada mensaje → automatización con Gmail.
 */
export function vintedConnector(): ConnectorDef {
  const base = (ctx: ConnectorCtx) => `https://${(ctx.get('domain') ?? 'www.vinted.es').replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const headers = (ctx: ConnectorCtx) => ({ cookie: ctx.get('cookie') ?? '', 'user-agent': ctx.get('userAgent') || DEFAULT_UA, accept: 'application/json, text/plain, */*', 'accept-language': 'es-ES,es;q=0.9' });

  async function api<T>(ctx: ConnectorCtx, p: string, init: RequestInit = {}): Promise<T> {
    const res = await ctx.fetch(`${base(ctx)}${p}`, { ...init, headers: { ...headers(ctx), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) }, redirect: 'manual' });
    const text = await res.text();
    if (res.status === 401 || res.status === 302) throw new Error('La sesión de Vinted ha caducado: vuelve a copiar la cookie desde tu navegador (Conectores → Vinted)');
    if (res.status === 403) throw new Error(/datadome|captcha/i.test(text) ? 'Vinted ha bloqueado el acceso automático (protección anti-robots). Abre Vinted en el navegador, vuelve a copiar la cookie y usa el mismo navegador/User-Agent.' : 'Vinted denegó el acceso (403)');
    if (!res.ok) throw new Error(`Vinted respondió HTTP ${res.status}`);
    try { return JSON.parse(text) as T; } catch { throw new Error('Vinted devolvió algo inesperado (¿ha cambiado su web?)'); }
  }

  return {
    id: 'vinted',
    name: 'Vinted',
    description: 'Lee tus conversaciones de Vinted y responde con tu confirmación.',
    official: false,
    warning: 'EXPERIMENTAL y NO OFICIAL: Vinted no tiene API pública. Usa la cookie de tu sesión del navegador (como si fueras tú en la web); puede dejar de funcionar si Vinted cambia su web, la sesión caduca cada cierto tiempo y Vinted podría limitar tu cuenta por uso automatizado. Alternativa estable sin riesgo: deja que JARVIS lea los avisos de mensajes que Vinted te envía por correo (Automatizaciones → «Correo nuevo» con from:vinted).',
    docsUrl: 'https://www.vinted.es/inbox',
    fields: [
      { key: 'domain', label: 'Dominio', secret: false, required: true, default: 'www.vinted.es', placeholder: 'www.vinted.es' },
      { key: 'cookie', label: 'Cookie de sesión', secret: true, required: true, placeholder: 'access_token_web=…; _vinted_es_session=…', help: 'En el navegador con Vinted abierto: F12 → Red → recarga → cualquier petición a vinted.es → Encabezados → copia el valor de «Cookie». Es como tu contraseña: se guarda cifrada.' },
      { key: 'userAgent', label: 'User-Agent del navegador (opcional)', secret: false, required: false, help: 'Copia el de la misma petición; ayuda a que Vinted no bloquee el acceso.' },
    ],
    async test(ctx) {
      const r = await api<{ conversations?: Conv[]; pagination?: { total_entries?: number } }>(ctx, '/api/v2/inbox?page=1&per_page=1');
      if (!Array.isArray(r.conversations)) throw new Error('Respuesta de Vinted no reconocida');
      return { ok: true, detail: `Sesión válida · ${r.pagination?.total_entries ?? r.conversations.length} conversación(es)` };
    },
    tools: (ctx) => [
      defineTool({
        name: 'vinted.inbox', description: 'Tus conversaciones recientes de Vinted (quién, artículo, sin leer).',
        parameters: z.object({ limit: z.number().int().min(1).max(50).default(15), unreadOnly: z.boolean().default(false) }),
        permissions: ['connector.vinted.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA tus conversaciones de Vinted'], returns: 'Id, usuario, último mensaje, si está sin leer y fecha.',
        async execute({ limit, unreadOnly }) {
          const r = await api<{ conversations: Conv[] }>(ctx, `/api/v2/inbox?page=1&per_page=${limit}`);
          return r.conversations.filter((c) => !unreadOnly || c.unread).map((c) => ({ id: c.id, with: c.opposite_user?.login ?? '?', last: c.description ?? '', unread: !!c.unread, updatedAt: c.updated_at ?? null, items: c.item_count ?? null }));
        },
      }),
      defineTool({
        name: 'vinted.read', description: 'Lee una conversación de Vinted completa (mensajes, ofertas y estado del pedido).',
        parameters: z.object({ conversationId: z.number().int().positive() }),
        permissions: ['connector.vinted.read'], risk: 'medium', sideEffects: false,
        risks: ['Muestra a la IA una conversación privada'], returns: 'Usuario, artículo y mensajes en orden.',
        async execute({ conversationId }) {
          const r = await api<{ conversation: { opposite_user?: { login?: string; id?: number }; subtitle?: string; messages?: Msg[] } }>(ctx, `/api/v2/conversations/${conversationId}`);
          const other = r.conversation.opposite_user;
          return {
            with: other?.login ?? '?', subject: r.conversation.subtitle ?? null,
            messages: (r.conversation.messages ?? []).map((m) => ({
              from: m.entity?.user_id && other?.id && m.entity.user_id === other.id ? other.login : m.entity?.user_id ? 'yo' : 'Vinted',
              type: m.entity_type,
              text: m.entity?.body ?? [m.entity?.title, m.entity?.subtitle].filter(Boolean).join(' · ') ?? '',
              when: m.created_time_ago ?? m.created_at_ts ?? null,
            })).filter((m) => m.text),
          };
        },
      }),
      defineTool({
        name: 'vinted.reply', description: 'Responde en una conversación de Vinted en tu nombre. Pide confirmación SIEMPRE.',
        parameters: z.object({ conversationId: z.number().int().positive(), text: z.string().min(1).max(2000) }),
        permissions: ['connector.vinted.reply'], risk: 'critical', sideEffects: true,
        risks: ['Se envía en tu nombre a otra persona', 'Uso no oficial: Vinted podría limitar la cuenta'], returns: 'Confirmación.',
        async execute({ conversationId, text }) {
          // La web de Vinted exige un token CSRF que aparece en su HTML.
          const page = await ctx.fetch(`${base(ctx)}/inbox/${conversationId}`, { headers: { ...headers(ctx), accept: 'text/html' } });
          const html = await page.text();
          const csrf = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /"CSRF_TOKEN\\?":\\?"([^"\\]+)/.exec(html)?.[1];
          if (!csrf) throw new Error('No he podido preparar la respuesta (Vinted no dio su token de seguridad). Responde desde la app de Vinted.');
          await api(ctx, `/api/v2/conversations/${conversationId}/replies`, { method: 'POST', headers: { 'x-csrf-token': csrf }, body: JSON.stringify({ reply: { body: text, photo_temp_uuids: null, is_personal_data_sharing_check_skipped: false } }) });
          return { sent: true };
        },
      }),
    ],
  };
}
