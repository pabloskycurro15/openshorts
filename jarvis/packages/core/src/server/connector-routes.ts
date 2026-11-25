import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';

const USER: Principal = { kind: 'user', id: 'owner' };
const id = (req: { params: unknown }) => (req.params as { id: string }).id;

/** Centro de conectores: configurar, activar (= aprobación del usuario), probar y acciones. */
export function registerConnectorRoutes(app: FastifyInstance, j: Jarvis) {
  const c = j.connectors;
  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => reply.code(400).send({ error: (err as Error).message });
  app.get('/api/connectors', async () => c.list());
  app.put('/api/connectors/:id', async (req, reply) => {
    try {
      c.configure(USER, id(req), z.record(z.string(), z.string().max(4000)).parse(req.body));
      return c.list().find((x) => x.id === id(req));
    } catch (err) { return fail(reply, err); }
  });
  app.post('/api/connectors/:id/enable', async (req, reply) => {
    if (j.permissions.isLockdown()) return reply.code(423).send({ error: 'Modo emergencia activo' });
    try { return await c.enable(USER, id(req)); } catch (err) { return fail(reply, err); }
  });
  app.post('/api/connectors/:id/disable', async (req, reply) => {
    try { await c.disable(USER, id(req)); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
  app.post('/api/connectors/:id/test', async (req, reply) => {
    try { return await c.test(id(req)); } catch (err) { return fail(reply, err); }
  });
  app.delete('/api/connectors/:id/credentials', async (req, reply) => {
    try { await c.deleteCredentials(USER, id(req)); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
  app.post('/api/connectors/:id/actions/:action', async (req, reply) => {
    if (j.permissions.isLockdown()) return reply.code(423).send({ error: 'Modo emergencia activo' });
    try {
      return (await c.action(USER, id(req), (req.params as { action: string }).action, z.record(z.string(), z.unknown()).parse(req.body ?? {}))) ?? { ok: true };
    } catch (err) { return fail(reply, err); }
  });
}
