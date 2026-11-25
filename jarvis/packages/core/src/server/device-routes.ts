import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';
import type { DeviceView } from '../security/devices';

const USER: Principal = { kind: 'user', id: 'owner' };
export const deviceOf = (req: FastifyRequest) => (req as FastifyRequest & { device?: DeviceView }).device ?? null;

/** Vinculación de dispositivos, notificaciones push y acceso remoto. */
export function registerDeviceRoutes(app: FastifyInstance, j: Jarvis) {
  app.get('/api/me', async (req) => {
    const d = deviceOf(req);
    return d ? { kind: 'device', device: d } : { kind: 'local', device: null };
  });

  // ── Vinculación ──
  app.post('/api/pair/start', async (req, reply) => {
    // Solo desde un cliente local o un dispositivo ya vinculado (el gancho de autenticación lo garantiza).
    if (j.permissions.isLockdown()) return reply.code(423).send({ error: 'Modo emergencia activo' });
    const p = j.devices.startPairing(USER);
    const base = j.remote?.pairingBase() ?? null;
    const link = base ? `${base}/#/pair?code=${p.code}` : null;
    return { ...p, link, qr: link ? await QRCode.toDataURL(link, { margin: 1, width: 260, color: { dark: '#0a1020', light: '#ffffff' } }) : null };
  });
  app.post('/api/pair/cancel', async () => { j.devices.cancelPairing(); return { ok: true }; });
  app.post('/api/pair/complete', async (req, reply) => {
    const body = z.object({ code: z.string().min(4).max(20), name: z.string().max(60).default('Dispositivo'), platform: z.string().max(40).default('web') }).parse(req.body);
    try {
      return j.devices.completePairing({ ...body, ip: req.ip });
    } catch (err) {
      (req as FastifyRequest & { authFailed?: boolean }).authFailed = true;
      return reply.code(403).send({ error: (err as Error).message });
    }
  });

  // ── Dispositivos ──
  app.get('/api/devices', async () => j.devices.list());
  app.delete('/api/devices/:id', async (req, reply) => (j.devices.revoke(USER, (req.params as { id: string }).id) ? { revoked: true } : reply.code(404).send({ error: 'No encontrado' })));

  // ── Push ──
  app.get('/api/push/key', async () => ({ publicKey: j.push.publicKey(), subscriptions: j.push.count() }));
  app.post('/api/push/subscribe', async (req, reply) => {
    const sub = z.object({ endpoint: z.url().max(2000), keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }) }).parse(req.body);
    try {
      j.push.subscribe(deviceOf(req)?.id ?? null, sub);
      return { subscribed: true };
    } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
  });
  app.post('/api/push/unsubscribe', async (req) => ({ removed: j.push.unsubscribe(z.object({ endpoint: z.string().max(2000) }).parse(req.body).endpoint) }));
  app.post('/api/push/test', async () => j.push.sendAll({ title: 'JARVIS', body: 'Las notificaciones funcionan en este dispositivo.', url: '/', tag: 'prueba' }));

  // ── Acceso remoto ──
  app.get('/api/remote', async (_req, reply) => j.remote?.status() ?? reply.code(501).send({ error: 'Acceso remoto no disponible en este modo' }));
  app.put('/api/remote', async (req, reply) => {
    if (!j.remote) return reply.code(501).send({ error: 'Acceso remoto no disponible en este modo' });
    const patch = z.object({ mode: z.enum(['off', 'lan']).optional(), port: z.number().int().optional(), publicUrl: z.string().max(200).nullable().optional() }).parse(req.body);
    try { return await j.remote.configure(USER, patch); } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
  });
}
