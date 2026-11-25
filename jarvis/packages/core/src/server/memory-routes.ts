import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MemoryCategory, MemoryInput, MemorySettings, type Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';

const USER: Principal = { kind: 'user', id: 'owner' };

/** Rutas de la sección Memoria (el usuario siempre puede ver todo lo que JARVIS recuerda). */
export function registerMemoryRoutes(app: FastifyInstance, j: Jarvis) {
  const m = j.memory;
  app.get('/api/memory', async (req) => {
    const q = z.object({ q: z.string().max(500).optional(), category: MemoryCategory.optional(), project: z.string().optional(), status: z.enum(['confirmed', 'suggested']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
    let hits = await m.search({ query: q.q, categories: q.category ? [q.category] : undefined, project: q.project, includePersonal: true, limit: q.limit ?? 60 });
    if (q.status) hits = hits.filter((h) => h.status === q.status);
    return { items: hits, counts: m.counts() };
  });
  app.get('/api/memory/settings', async () => ({ settings: m.getSettings(), semantic: m.semanticStatus() }));
  app.put('/api/memory/settings', async (req) => ({ settings: m.updateSettings(USER, MemorySettings.partial().parse(req.body)), semantic: m.semanticStatus() }));
  app.post('/api/memory/semantic/load', async (_req, reply) => {
    try {
      await m.enableSemantic();
      return m.semanticStatus();
    } catch (err) {
      return reply.code(502).send({ error: `No se pudo cargar el modelo: ${(err as Error).message}` });
    }
  });
  app.get('/api/memory/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const mem = m.get(id);
    return mem ? { memory: mem, links: m.links(id) } : reply.code(404).send({ error: 'No encontrado' });
  });
  app.post('/api/memory', async (req) => m.create(USER, MemoryInput.parse(req.body), { source: 'usuario', status: 'confirmed' }));
  app.patch('/api/memory/:id', async (req, reply) => {
    try {
      return m.update(USER, (req.params as { id: string }).id, MemoryInput.partial().parse(req.body));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });
  app.post('/api/memory/:id/confirm', async (req) => m.confirm(USER, (req.params as { id: string }).id));
  app.delete('/api/memory/:id', async (req, reply) => (m.delete(USER, (req.params as { id: string }).id) ? { deleted: true } : reply.code(404).send({ error: 'No encontrado' })));
  app.post('/api/memory/links', async (req, reply) => {
    const b = z.object({ fromId: z.string(), toId: z.string(), relation: z.string().min(1).max(60) }).parse(req.body);
    try {
      return m.link(USER, b.fromId, b.toId, b.relation);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
  app.delete('/api/memory/links', async (req) => {
    const b = z.object({ fromId: z.string(), toId: z.string(), relation: z.string() }).parse(req.body);
    return { removed: m.unlink(USER, b.fromId, b.toId, b.relation) };
  });
}
