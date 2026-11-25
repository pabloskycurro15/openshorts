import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BackupSettings, type Principal } from '@jarvis/shared';
import type { Jarvis } from '../app';
import { checkUpdates, cleanup, runDiagnostics } from '../maintenance/diagnostics';

const USER: Principal = { kind: 'user', id: 'owner' };
const id = (req: { params: unknown }) => (req.params as { id: string }).id;

/** Copias de seguridad, diagnóstico, mantenimiento, actualizaciones y alertas de seguridad. */
export function registerMaintenanceRoutes(app: FastifyInstance, j: Jarvis) {
  const b = j.backups;
  const bad = (reply: { code(n: number): { send(x: unknown): unknown } }, err: unknown) => reply.code(400).send({ error: (err as Error).message });

  app.get('/api/backups', async () => b.status());
  app.put('/api/backups/settings', async (req, reply) => { try { return b.updateSettings(USER, BackupSettings.partial().parse(req.body)); } catch (err) { return bad(reply, err); } });
  app.put('/api/backups/passphrase', async (req, reply) => {
    try { b.setPassphrase(USER, z.object({ passphrase: z.string().max(200) }).parse(req.body).passphrase); return { ok: true }; } catch (err) { return bad(reply, err); }
  });
  app.put('/api/backups/supabase-key', async (req, reply) => {
    try { b.setSupabaseKey(USER, z.object({ key: z.string().min(20).max(500).nullable() }).parse(req.body).key); return { ok: true }; } catch (err) { return bad(reply, err); }
  });
  app.post('/api/backups/supabase-test', async () => b.testSupabase());
  app.post('/api/backups', async (req, reply) => { try { return await b.create(USER); } catch (err) { return bad(reply, err); } });
  app.post('/api/backups/:id/verify', async (req, reply) => { try { return await b.verify(id(req)); } catch (err) { return bad(reply, err); } });
  app.post('/api/backups/:id/restore', async (req, reply) => {
    try { return await b.prepareRestore(USER, id(req), z.object({ passphrase: z.string().max(200).optional() }).parse(req.body ?? {}).passphrase); } catch (err) { return bad(reply, err); }
  });
  app.post('/api/backups/restore/cancel', async () => { b.cancelRestore(USER); return { ok: true }; });
  app.delete('/api/backups/:id', async (req, reply) => { try { b.delete(USER, id(req)); return { deleted: true }; } catch (err) { return bad(reply, err); } });

  app.get('/api/diagnostics', async () => runDiagnostics(j));
  app.post('/api/maintenance/cleanup', async (req) => {
    const o = z.object({ days: z.number().int().min(7).max(3650).default(90), vacuum: z.boolean().default(false) }).parse(req.body ?? {});
    return cleanup(j, USER, o.days, o.vacuum);
  });
  app.get('/api/updates', async (_req, reply) => { try { return await checkUpdates(j); } catch (err) { return reply.code(502).send({ error: (err as Error).message }); } });

  app.get('/api/security/alerts', async () => ({ alerts: j.monitor.list(), unacknowledged: j.monitor.unacknowledged(), autoLockdown: j.monitor.autoLockdown() }));
  app.post('/api/security/alerts/ack', async (req) => ({ acknowledged: j.monitor.acknowledge(USER, z.object({ id: z.string().optional() }).parse(req.body ?? {}).id) }));
  app.put('/api/security/auto-lockdown', async (req) => { j.monitor.setAutoLockdown(USER, z.object({ on: z.boolean() }).parse(req.body).on); return { autoLockdown: j.monitor.autoLockdown() }; });
}
