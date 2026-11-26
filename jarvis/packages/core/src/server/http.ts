import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ControlConfigError } from '../control/config';
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
import { registerAiRoutes } from './ai-routes';
import { registerVoiceRoutes } from './voice-routes';
import { registerMemoryRoutes } from './memory-routes';
import { registerAgentRoutes } from './agent-routes';
import { registerConnectorRoutes } from './connector-routes';
import { registerAutomationRoutes } from './automation-routes';
import { registerDeviceRoutes } from './device-routes';
import { registerMaintenanceRoutes } from './maintenance-routes';
import { AuthThrottle } from '../security/devices';

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
  // Formularios (los webhooks de Twilio llegan como application/x-www-form-urlencoded).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const throttle = new AuthThrottle();
  // Orígenes de la app nativa (Capacitor). La web servida por el núcleo es del mismo origen y no necesita CORS.
  const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost']);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && NATIVE_ORIGINS.has(origin) && req.url.startsWith('/api/')) {
      void reply.header('access-control-allow-origin', origin).header('vary', 'origin')
        .header('access-control-allow-headers', 'authorization, content-type').header('access-control-allow-methods', 'GET, POST, PUT, DELETE');
      if (req.method === 'OPTIONS') return reply.code(204).send();
    }
    // La interfaz estática es pública (no contiene datos); toda la API exige token o dispositivo vinculado.
    if (!req.url.startsWith('/api/') || req.url === '/api/ping') return;
    if (throttle.blocked(req.ip)) return reply.code(429).send({ error: 'Demasiados intentos fallidos. Espera unos minutos.' });
    if (req.url === '/api/pair/complete') return;
    const header = req.headers.authorization;
    const fromHeader = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const fromQuery = req.url.startsWith('/api/events') ? (req.query as { token?: string }).token : undefined;
    const provided = fromHeader ?? fromQuery;
    if (provided && tokensEqual(provided, token)) return;
    const device = provided && provided.length >= 32 && provided.length <= 64 ? j.devices.authenticate(provided, req.ip) : null;
    if (device) {
      (req as typeof req & { device?: typeof device }).device = device;
      return;
    }
    throttle.fail(req.ip);
    j.bus.emit('security.auth_failed', { ip: req.ip, path: req.url.split('?')[0]! });
    return reply.code(401).send({ error: 'No autorizado' });
  });
  // Los códigos de vinculación erróneos también cuentan como intentos fallidos.
  app.addHook('onResponse', async (req) => {
    if (!(req as typeof req & { authFailed?: boolean }).authFailed) return;
    throttle.fail(req.ip);
    j.bus.emit('security.auth_failed', { ip: req.ip, path: req.url.split('?')[0]! });
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
    // (approved_always concede el permiso de forma permanente; ver ToolRegistry.resolveApproval)
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

  app.get('/api/control/config', async () => j.control.get());
  app.put('/api/control/config', async (req, reply) => {
    try {
      return j.control.set(USER, req.body);
    } catch (err) {
      if (err instanceof ControlConfigError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  registerAiRoutes(app, j);
  registerVoiceRoutes(app, j);
  registerMemoryRoutes(app, j);
  registerAgentRoutes(app, j);
  registerConnectorRoutes(app, j);
  registerAutomationRoutes(app, j);
  registerDeviceRoutes(app, j);
  registerMaintenanceRoutes(app, j);

  app.get('/api/events', { websocket: true }, (socket) => {
    const off = j.bus.onAny((env) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(env));
    });
    socket.on('close', off);
    socket.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString(), payload: { api: API_VERSION } }));
  });

  if (j.config.webDir) {
    await app.register(fastifyStatic, {
      root: j.config.webDir,
      index: 'index.html',
      setHeaders: (res) => {
        res.header('x-content-type-options', 'nosniff');
        res.header('referrer-policy', 'no-referrer');
        res.header(
          'content-security-policy',
          // wasm-unsafe-eval: motor de voz local (WebAssembly). Hugging Face: solo para descargar el modelo una vez.
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss: https://huggingface.co https://*.huggingface.co https://*.hf.co; frame-ancestors 'none'",
        );
      },
    });
  }

  return app;
}
