import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import { randomBytes } from 'node:crypto';
import type { Jarvis } from '../app';
import { ADOBE_CSP, ADOBE_PAGE } from '../connectors/adobe';

const USER: Principal = { kind: 'user', id: 'owner' };
const id = (req: { params: unknown }) => (req.params as { id: string }).id;

/** Centro de conectores: configurar, activar (= aprobación del usuario), probar y acciones. */
export function registerConnectorRoutes(app: FastifyInstance, j: Jarvis) {
  const c = j.connectors;
  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => reply.code(400).send({ error: (err as Error).message });
  app.get('/api/connectors', async () => c.list());
  // Webhooks de Twilio (conversación por teléfono). Sin token de JARVIS: los protege la firma de Twilio.
  for (const p of ['/phone/voice', '/phone/pin', '/phone/gather', '/phone/wait']) {
    app.post(p, async (req, reply) => {
      if (!j.connectors.isEnabled('phone')) return reply.code(404).type('text/xml').send('<Response><Reject/></Response>');
      const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
      const r = await j.phone.webhook(p, req.query as Record<string, string>, params, req.headers['x-twilio-signature'] as string | undefined);
      return reply.code(r.status).type('text/xml').send(r.body);
    });
  }
  // Editor de Adobe Express: página aislada (otro origen: localhost) con su propia CSP y nonce.
  app.get('/adobe-express', async (_req, reply) => {
    const nonce = randomBytes(16).toString('base64');
    void reply.header('content-security-policy', ADOBE_CSP.replace("'unsafe-inline' https://cc-embed", `'nonce-${nonce}' https://cc-embed`)).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').type('text/html; charset=utf-8');
    return ADOBE_PAGE.replace('<script type="module">', `<script type="module" nonce="${nonce}">`);
  });
  app.post('/adobe-express/upload', { bodyLimit: 60 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({ ticket: z.string().min(20).max(100), data: z.string().max(80 * 1024 * 1024), name: z.string().max(100).optional() }).parse(req.body);
    try { return j.adobe.saveExport(b.ticket, b.data, b.name); } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
  });
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
