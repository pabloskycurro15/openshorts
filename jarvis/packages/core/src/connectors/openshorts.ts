import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';

/** OpenShorts (tu propio servidor): convertir vídeos largos en clips verticales. */
export function openshortsConnector(): ConnectorDef {
  const url = (ctx: ConnectorCtx, p: string) => `${(ctx.get('baseUrl') ?? 'http://localhost:8000').replace(/\/+$/, '')}${p}`;
  return {
    id: 'openshorts',
    name: 'OpenShorts',
    description: 'Envía vídeos de YouTube a tu servidor OpenShorts para sacar clips verticales y consulta su progreso.',
    official: true,
    warning: 'Usa tu clave de Gemini (la de Configuración → Cerebro) y la cuota gratuita de Google. El procesamiento ocurre en tu servidor OpenShorts.',
    docsUrl: 'https://github.com/pabloskycurro15/openshorts',
    fields: [{ key: 'baseUrl', label: 'Dirección del servidor', secret: false, required: true, default: 'http://localhost:8000', placeholder: 'http://localhost:8000' }],
    async test(ctx) {
      const u = new URL(url(ctx, '/'));
      if (!/^https?:$/.test(u.protocol)) throw new Error('La dirección debe empezar por http:// o https://');
      await jsonFetch(ctx.fetch, url(ctx, '/api/translate/languages'), { timeoutMs: 8000 });
      if (!ctx.secret('ai.google.apiKey')) return { ok: true, detail: 'Servidor accesible. Aviso: falta la clave de Gemini (Configuración → Cerebro) para procesar vídeos.' };
      return { ok: true, detail: 'Servidor OpenShorts accesible' };
    },
    tools: (ctx) => [
      defineTool({
        name: 'openshorts.process', description: 'Envía un vídeo de YouTube a OpenShorts para generar clips verticales. Devuelve un jobId.',
        parameters: z.object({ url: z.url().refine((u) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(u), 'Debe ser un enlace de YouTube') }),
        permissions: ['connector.openshorts.process'], risk: 'medium', sideEffects: true,
        risks: ['Consume cuota de tu clave de Gemini y recursos de tu servidor'], returns: 'Identificador del trabajo.',
        async execute({ url: video }) {
          const key = ctx.secret('ai.google.apiKey');
          if (!key) throw new Error('Falta la clave de Gemini en Configuración → Cerebro');
          return jsonFetch<{ job_id: string }>(ctx.fetch, url(ctx, '/api/process'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-gemini-key': key }, body: JSON.stringify({ url: video }) });
        },
      }),
      defineTool({
        name: 'openshorts.status', description: 'Consulta el estado de un trabajo de OpenShorts y sus clips.',
        parameters: z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }),
        permissions: ['connector.openshorts.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Estado, últimas líneas de registro y resultado.',
        async execute({ jobId }) {
          const r = await jsonFetch<{ status: string; logs?: string[]; result?: unknown }>(ctx.fetch, url(ctx, `/api/status/${jobId}`));
          return { status: r.status, logs: (r.logs ?? []).slice(-8), result: r.result ?? null };
        },
      }),
    ],
  };
}
