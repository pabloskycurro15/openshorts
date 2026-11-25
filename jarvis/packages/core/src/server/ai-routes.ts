import type { FastifyInstance } from 'fastify';
import { AiSettings, ChatRequest, SetApiKeyRequest, type ChatEvent, type Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';
import { ConversationBusyError } from '../ai/engine';
import type { ProviderId } from '../ai/service';

const USER: Principal = { kind: 'user', id: 'owner' };

/** Rutas del cerebro IA: configuración, presupuesto, conversaciones y chat en streaming. */
export function registerAiRoutes(app: FastifyInstance, j: Jarvis) {
  app.get('/api/ai/status', async () => j.ai.status());

  app.put('/api/ai/settings', async (req, reply) => {
    const patch = AiSettings.partial().parse(req.body);
    if (patch.model && patch.model !== 'auto' && !j.ai.status().models.some((m) => m.id === patch.model)) return reply.code(400).send({ error: 'Modelo desconocido' });
    const s = j.ai.budget.updateSettings(patch);
    j.audit.append({ principal: USER, action: 'ai.settings', outcome: 'success', details: s });
    return s;
  });

  const providerOf = (req: { params: unknown }): ProviderId | null => {
    const p = (req.params as { provider?: string }).provider ?? 'anthropic';
    return p === 'anthropic' || p === 'openai' || p === 'google' ? p : null;
  };

  // Las claves solo entran: ninguna ruta las devuelve. (/api/ai/key = Anthropic, por compatibilidad)
  const setKey = async (req: { body: unknown; params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const provider = providerOf(req);
    if (!provider) return reply.code(404).send({ error: 'Proveedor desconocido' });
    const { apiKey } = SetApiKeyRequest.parse(req.body);
    try {
      j.ai.setApiKey(USER, apiKey, provider);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return { configured: true };
  };
  app.put('/api/ai/key', setKey);
  app.put('/api/ai/keys/:provider', setKey);
  app.delete('/api/ai/key', async () => ({ deleted: j.ai.deleteApiKey(USER) }));
  app.delete('/api/ai/keys/:provider', async (req, reply) => {
    const provider = providerOf(req);
    return provider ? { deleted: j.ai.deleteApiKey(USER, provider) } : reply.code(404).send({ error: 'Proveedor desconocido' });
  });

  app.post('/api/ai/test', async () => j.ai.test('anthropic'));
  app.post('/api/ai/test/:provider', async (req, reply) => {
    const provider = providerOf(req);
    return provider ? j.ai.test(provider) : reply.code(404).send({ error: 'Proveedor desconocido' });
  });

  app.get('/api/conversations', async () => j.ai.store.list());
  app.get('/api/conversations/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const c = j.ai.store.get(id);
    if (!c) return reply.code(404).send({ error: 'No encontrada' });
    return { conversation: c, messages: j.ai.store.view(id), active: j.ai.engine.activeConversations().includes(id) };
  });
  app.delete('/api/conversations/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (j.ai.engine.activeConversations().includes(id)) return reply.code(409).send({ error: 'Detén la respuesta antes de borrar' });
    const ok = j.ai.store.delete(id);
    if (ok) j.audit.append({ principal: USER, action: 'conversation.delete', target: id, outcome: 'success' });
    return ok ? { deleted: true } : reply.code(404).send({ error: 'No encontrada' });
  });

  app.post('/api/chat/:id/stop', async (req) => ({ stopped: j.ai.engine.stop((req.params as { id: string }).id) }));

  /** Respuesta en streaming: una línea JSON (ChatEvent) por evento. */
  app.post('/api/chat', async (req, reply) => {
    const body = ChatRequest.parse(req.body);
    if (body.conversationId && !j.ai.store.exists(body.conversationId)) return reply.code(404).send({ error: 'Conversación inexistente' });
    if (body.conversationId && j.ai.engine.activeConversations().includes(body.conversationId)) {
      return reply.code(409).send({ error: 'Esta conversación ya está respondiendo' });
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    // Si el cliente se va (cierra la pestaña), se cancela para no gastar en balde.
    const ctrl = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ctrl.abort();
    });
    const emit = (e: ChatEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`);
    };
    try {
      await j.ai.engine.run(body, emit, ctrl.signal);
    } catch (err) {
      emit({ type: 'error', message: err instanceof ConversationBusyError ? err.message : (err as Error).message });
      emit({ type: 'done', stopReason: 'error' });
    }
    res.end();
  });
}
