import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import {
  API_VERSION,
  EmergencyRequest,
  InvokeToolRequest,
  ResolveApprovalRequest,
  RevokeRequest,
  type HealthResponse,
  type Principal,
} from '@jarvis/shared';
import { tokensEqual } from '../security/auth';
import type { Jarvis } from '../app';

const USER: Principal = { kind: 'user', id: 'owner' };

/**
 * API interna del núcleo (REST + WebSocket de eventos).
 * Todas las rutas salvo /api/ping exigen el token: Authorization: Bearer <token>
 * (en WebSocket, ?token=<token>, porque el navegador no permite cabeceras).
 */
export async function buildServer(j: Jarvis, token: string): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: j.logger.child({ component: 'http' }) as unknown as FastifyBaseLogger,
    bodyLimit: 1_000_000,
  });
  await app.register(websocket);

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/api/ping') return;
    const header = req.headers.authorization;
    const fromHeader = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const fromQuery = req.url.startsWith('/api/events') ? (req.query as { token?: string }).token : undefined;
    const provided = fromHeader ?? fromQuery;
    if (!provided || !tokensEqual(provided, token)) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
  });

  app.setErrorHandler((err: { statusCode?: number; message: string; name?: string }, _req, reply) => {
    const status = err.name === 'ZodError' ? 400 : err.statusCode ?? 500;
    reply.code(status).send({ error: status === 500 ? 'Error interno' : err.message });
  });

  app.get('/api/ping', async () => ({ pong: true, api: API_VERSION }));

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const modules = j.modules.list();
    return {
      status: modules.every((m) => m.status === 'running') ? 'ok' : 'degraded',
      version: j.version,
      uptimeSec: Math.round(process.uptime()),
      lockdown: j.permissions.isLockdown(),
      modules,
    };
  });

  app.get('/api/modules', async () => j.modules.list());
  app.get('/api/tools', async () => j.tools.describe());

  app.post('/api/tools/invoke', async (req) => {
    const body = InvokeToolRequest.parse(req.body);
    return j.tools.invoke(USER, body.tool, body.args);
  });

  app.get('/api/approvals', async (req) => {
    const status = (req.query as { status?: string }).status;
    return j.tools.listApprovals(status === 'pending' || status === 'approved' || status === 'denied' || status === 'expired' ? status : undefined);
  });
  app.get('/api/approvals/:id', async (req, reply) => {
    const a = j.tools.getApproval((req.params as { id: string }).id);
    return a ?? reply.code(404).send({ error: 'No encontrada' });
  });
  app.post('/api/approvals/:id', async (req, reply) => {
    const { decision } = ResolveApprovalRequest.parse(req.body);
    try {
      return await j.tools.resolveApproval(USER, (req.params as { id: string }).id, decision);
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get('/api/permissions', async () => j.permissions.listGrants());
  app.post('/api/permissions/revoke', async (req) => {
    const { principal, scope } = RevokeRequest.parse(req.body);
    return { removed: j.permissions.revoke(USER, principal, scope) };
  });
  app.post('/api/permissions/revoke-all', async () => ({ removed: j.permissions.revokeAll(USER) }));

  app.get('/api/audit', async (req) => {
    const q = req.query as { limit?: string; before?: string };
    return j.audit.list({ limit: q.limit ? Number(q.limit) : undefined, beforeSeq: q.before ? Number(q.before) : undefined });
  });
  app.get('/api/audit/verify', async () => j.audit.verify());

  app.post('/api/emergency', async (req) => {
    const { lockdown } = EmergencyRequest.parse(req.body);
    j.permissions.setLockdown(USER, lockdown);
    const cancelled = lockdown ? j.tools.expireAllPending() : 0;
    return { lockdown, cancelledApprovals: cancelled };
  });

  app.get('/api/events', { websocket: true }, (socket) => {
    const off = j.bus.onAny((env) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(env));
    });
    socket.on('close', off);
    socket.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString(), payload: { api: API_VERSION } }));
  });

  return app;
}
