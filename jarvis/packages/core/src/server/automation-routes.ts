import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AutomationInput, type Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';

const USER: Principal = { kind: 'user', id: 'owner' };
const id = (req: { params: unknown }) => (req.params as { id: string }).id;

/** Automatizaciones: el usuario las crea, revisa, activa (concede permisos), ejecuta y borra. */
export function registerAutomationRoutes(app: FastifyInstance, j: Jarvis) {
  const m = j.automations;
  const bad = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => {
    const e = err as Error & { issues?: unknown };
    return reply.code(e.message === 'Modo emergencia activo' ? 423 : 400).send({ error: e.issues ? z.prettifyError(err as z.ZodError) : e.message });
  };
  app.get('/api/automations', async () => m.list());
  app.get('/api/automations/:id', async (req, reply) => m.get(id(req)) ?? reply.code(404).send({ error: 'No encontrada' }));
  app.get('/api/automations/:id/runs', async (req) => m.runs(id(req)));
  app.post('/api/automations/scopes', async (req, reply) => {
    try { return { scopes: m.requiredScopes(AutomationInput.parse(req.body)) }; } catch (err) { return bad(reply, err); }
  });
  app.post('/api/automations', async (req, reply) => {
    try {
      const { enable, ...input } = z.object({ enable: z.boolean().default(false) }).passthrough().parse(req.body);
      const a = m.create(USER, input);
      return enable ? m.setEnabled(USER, a.id, true) : a;
    } catch (err) { return bad(reply, err); }
  });
  app.put('/api/automations/:id', async (req, reply) => {
    try { return m.update(USER, id(req), req.body); } catch (err) { return bad(reply, err); }
  });
  app.post('/api/automations/:id/enabled', async (req, reply) => {
    try { return m.setEnabled(USER, id(req), z.object({ enabled: z.boolean() }).parse(req.body).enabled); } catch (err) { return bad(reply, err); }
  });
  app.post('/api/automations/:id/run', async (req, reply) => {
    if (!m.get(id(req))) return reply.code(404).send({ error: 'No encontrada' });
    // Se lanza y se responde enseguida si tarda; el progreso llega por eventos.
    const p = m.runNow(USER, id(req));
    p.catch(() => undefined);
    try {
      return await Promise.race([p, new Promise((r) => setTimeout(() => r({ started: true }), 300))]);
    } catch (err) { return bad(reply, err); }
  });
  app.delete('/api/automations/:id', async (req, reply) => (m.delete(USER, id(req)) ? { deleted: true } : reply.code(404).send({ error: 'No encontrada' })));
}
