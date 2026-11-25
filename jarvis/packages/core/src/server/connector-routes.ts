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
  // Vuelta de OAuth desde el navegador (sin token de JARVIS; la protege el «state» de un solo uso).
  app.get('/oauth/:id/callback', async (req, reply) => {
    const q = z.record(z.string(), z.string()).parse(req.query);
    let ok = true;
    let msg: string;
    try { msg = await c.oauthCallback(id(req), q); } catch (err) { ok = false; msg = (err as Error).message; }
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    void reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").header('cache-control', 'no-store').type('text/html; charset=utf-8').code(ok ? 200 : 400);
    return `<!doctype html><html lang="es"><meta charset="utf-8"><title>JARVIS</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#060b18;color:#e8eefc;font-family:system-ui">
<div style="max-width:420px;padding:28px;border:1px solid ${ok ? '#ff8a1f' : '#ef4444'};border-radius:16px;text-align:center;box-shadow:0 0 40px ${ok ? '#ff8a1f44' : '#ef444444'}">
<div style="letter-spacing:.4em;color:#ff8a1f;font-size:13px">J A R V I S</div><h1 style="font-size:20px">${ok ? 'Conexión completada' : 'No se pudo conectar'}</h1><p style="color:#9fb0d0">${esc(msg)}</p><p style="color:#5d6f93;font-size:12px">Ya puedes cerrar esta pestaña.</p></div></body></html>`;
  });
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
