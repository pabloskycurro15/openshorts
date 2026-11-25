import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateTaskRequest, type Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';

const USER: Principal = { kind: 'user', id: 'owner' };

export function registerAgentRoutes(app: FastifyInstance, j: Jarvis) {
  app.get('/api/agents', async () => j.tasks.agents());
  app.put('/api/agents/:id', async (req, reply) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    try {
      j.tasks.setEnabled(USER, (req.params as { id: string }).id, enabled);
      j.audit.append({ principal: USER, action: enabled ? 'agent.enable' : 'agent.disable', target: (req.params as { id: string }).id, outcome: 'success' });
      return { enabled };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
  app.get('/api/tasks', async () => j.tasks.list());
  app.get('/api/tasks/:id', async (req, reply) => j.tasks.get((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'No encontrada' }));
  app.post('/api/tasks', async (req, reply) => {
    const { goal } = CreateTaskRequest.parse(req.body);
    if (j.permissions.isLockdown()) return reply.code(423).send({ error: 'Modo emergencia activo' });
    j.audit.append({ principal: USER, action: 'task.create', outcome: 'success', details: { goal: goal.slice(0, 120) } });
    return j.tasks.start(goal);
  });
  app.post('/api/tasks/:id/cancel', async (req) => ({ cancelled: j.tasks.cancel((req.params as { id: string }).id) }));
  app.delete('/api/tasks/:id', async (req, reply) => {
    try {
      return j.tasks.delete((req.params as { id: string }).id) ? { deleted: true } : reply.code(404).send({ error: 'No encontrada' });
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });
}
