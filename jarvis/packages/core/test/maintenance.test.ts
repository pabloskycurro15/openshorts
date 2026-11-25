import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { openBackup, sealBackup } from '../src/maintenance/backup';
import { checkUpdates, cleanup, runDiagnostics } from '../src/maintenance/diagnostics';
import { defineTool } from '../src/tools/registry';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'jarvis' };
const PASS = 'mi frase muy secreta 2026';

const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

async function make(dataDir = tmpDir(), f?: typeof fetch) {
  const j = createJarvis(loadConfig({}, { dataDir, logLevel: 'silent' }), { embedder: null, connectors: [], fetch: f });
  await j.start();
  running.push(j);
  return { j, dataDir };
}

describe('Copias de seguridad: formato', () => {
  it('cifra y descifra; frase incorrecta o datos alterados se detectan', () => {
    const blob = sealBackup([{ name: 'a.txt', data: Buffer.from('hola') }, { name: 'b.bin', data: Buffer.from([1, 2, 3]) }], PASS, '9.9.9');
    expect(blob.subarray(0, 8).toString()).toBe('JARVISBK');
    expect(blob.includes(Buffer.from('hola'))).toBe(false);
    const { manifest, entries } = openBackup(blob, PASS);
    expect(manifest).toMatchObject({ format: 1, jarvisVersion: '9.9.9' });
    expect(entries.map((e) => [e.name, e.data.toString('hex')])).toEqual([['a.txt', Buffer.from('hola').toString('hex')], ['b.bin', '010203']]);
    expect(() => openBackup(blob, 'otra frase cualquiera')).toThrow(/Frase incorrecta/);
    const bad = Buffer.from(blob);
    bad[bad.length - 5]! ^= 0xff;
    expect(() => openBackup(bad, PASS)).toThrow(/Frase incorrecta o copia dañada/);
    expect(() => openBackup(Buffer.from('no soy una copia ni de lejos, qué va, nada de nada'), PASS)).toThrow(/No es una copia/);
  });
});

describe('Copias de seguridad: ciclo completo', () => {
  it('crear (verificada), retención, y restaurar en OTRO equipo con la frase: datos y secretos vuelven', async () => {
    const { j } = await make();
    await expect(j.backups.create(USER)).rejects.toThrow(/frase/);
    expect(() => j.backups.setPassphrase(USER, 'corta')).toThrow(/12/);
    j.backups.setPassphrase(USER, PASS);
    j.backups.updateSettings(USER, { keep: 2 });
    const conv = j.ai.store.create('Conversación importante');
    j.vault.set('connector.github.token', 'ghp_secreto_original');
    const b1 = await j.backups.create(USER);
    expect(b1).toMatchObject({ verified: true, location: 'local' });
    expect(b1.verifyDetail).toMatch(/Base de datos íntegra .*1 conversaciones/);
    const file = path.join(j.backups.dir(), b1.file);
    expect(fs.readFileSync(file).includes(Buffer.from('ghp_secreto_original'))).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    await new Promise((r) => setTimeout(r, 1100));
    await j.backups.create(USER);
    await new Promise((r) => setTimeout(r, 1100));
    await j.backups.create(USER);
    expect(j.backups.status().backups).toHaveLength(2); // retención: 2
    const last = j.backups.status().backups[0]!;

    // «Otro equipo»: carpeta de datos nueva, clave maestra distinta. Se trae el archivo a su carpeta de copias.
    const { j: k, dataDir: dir2 } = await make();
    fs.mkdirSync(k.backups.dir(), { recursive: true });
    fs.copyFileSync(path.join(j.backups.dir(), last.file), path.join(k.backups.dir(), last.file));
    const found = k.backups.status().backups.find((x) => x.file === last.file)!;
    expect(found).toMatchObject({ verified: false });
    await expect(k.backups.prepareRestore(USER, found.id, 'frase equivocada!!')).rejects.toThrow(/Frase incorrecta/);
    await expect(k.backups.prepareRestore(AGENT, found.id, PASS)).rejects.toThrow(/usuario/);
    expect(await k.backups.prepareRestore(USER, found.id, PASS)).toMatchObject({ detail: expect.stringMatching(/íntegra/) });
    expect(k.backups.status().restorePending).toBe(true);
    await k.stop();
    running.splice(running.indexOf(k), 1);

    // Al reiniciar se aplica: la conversación y el secreto (con la clave maestra restaurada) vuelven.
    const { j: k2 } = await make(dir2);
    expect(k2.restored).toBe(true);
    expect(k2.ai.store.exists(conv.id)).toBe(true);
    expect(k2.vault.get('connector.github.token')).toBe('ghp_secreto_original');
    expect(k2.audit.verify().ok).toBe(true);
    expect(fs.readdirSync(dir2).some((f) => f.startsWith('pre-restore-'))).toBe(true);
    expect(k2.backups.status().restorePending).toBe(false);
  });

  it('copia automática diaria a su hora (una vez al día)', async () => {
    const { j } = await make();
    j.backups.setPassphrase(USER, PASS);
    j.backups.updateSettings(USER, { auto: true, time: '03:30' });
    const day = new Date(2026, 10, 26, 3, 0);
    await j.backups.tick(day);
    expect(j.backups.status().backups).toHaveLength(0);
    await j.backups.tick(new Date(2026, 10, 26, 3, 31));
    expect(j.backups.status().backups).toMatchObject([{ auto: true, verified: true }]);
    await j.backups.tick(new Date(2026, 10, 26, 9, 0));
    expect(j.backups.status().backups).toHaveLength(1);
  });

  it('copia externa en Supabase Storage (API simulada): crea contenedor privado, sube cifrado, descarga y verifica', async () => {
    const store = new Map<string, Buffer>();
    let bucket: { public: boolean } | null = null;
    const calls: string[] = [];
    const f = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const h = (init.headers ?? {}) as Record<string, string>;
      calls.push(`${init.method ?? 'GET'} ${url.replace('https://abc.supabase.co/storage/v1/', '')}`);
      if (h.authorization !== 'Bearer sb_secret_prueba_000000000000' || h.apikey !== 'sb_secret_prueba_000000000000') return new Response('{"message":"unauthorized"}', { status: 401 });
      const p = url.replace('https://abc.supabase.co/storage/v1/', '');
      if (p === 'bucket/jarvis-backups') return bucket ? Response.json({ id: 'jarvis-backups', ...bucket }) : new Response('{"error":"not found"}', { status: 400 });
      if (p === 'bucket' && init.method === 'POST') { bucket = { public: JSON.parse(String(init.body)).public }; return Response.json({ name: 'jarvis-backups' }); }
      if (p.startsWith('object/jarvis-backups/')) {
        const name = p.slice('object/jarvis-backups/'.length);
        if (init.method === 'POST') { store.set(name, Buffer.from(init.body as Uint8Array)); return Response.json({ Key: name }); }
        const b = store.get(name);
        return b ? new Response(new Uint8Array(b)) : new Response('{}', { status: 404 });
      }
      if (p === 'object/jarvis-backups' && init.method === 'DELETE') { for (const n of JSON.parse(String(init.body)).prefixes) store.delete(n); return Response.json([]); }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const { j } = await make(tmpDir(), f);
    j.backups.setPassphrase(USER, PASS);
    expect(() => j.backups.updateSettings(USER, { offsite: true })).toThrow(/Supabase/);
    expect(() => j.backups.updateSettings(USER, { supabaseUrl: 'https://evil.example.com' })).toThrow(/supabase\.co/);
    j.backups.updateSettings(USER, { supabaseUrl: 'https://abc.supabase.co/' });
    j.backups.setSupabaseKey(USER, 'sb_secret_prueba_000000000000');
    expect(await j.backups.testSupabase()).toEqual({ ok: true, detail: 'Contenedor privado «jarvis-backups» creado' });
    expect(bucket).toEqual({ public: false });
    j.backups.updateSettings(USER, { offsite: true, keep: 1 });
    await j.backups.create(USER);
    expect(store.size).toBe(1);
    const [name, blob] = [...store.entries()][0]!;
    expect(blob.subarray(0, 8).toString()).toBe('JARVISBK');
    const remote = j.backups.status().backups.find((b) => b.location === 'supabase')!;
    expect(remote.file).toBe(name);
    expect(await j.backups.verify(remote.id)).toMatchObject({ verified: true });
    await new Promise((r) => setTimeout(r, 1100));
    await j.backups.create(USER);
    expect(store.size).toBe(1); // retención también fuera
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true);
    expect(JSON.stringify(j.backups.status())).not.toContain('sb_secret');
  });
});

describe('Vigilancia de seguridad', () => {
  it('ráfaga de acciones con efectos de un agente → alerta crítica y modo emergencia automático', async () => {
    const { j } = await make();
    j.tools.register(defineTool({ name: 'test.touch', description: 't', parameters: z.object({}), permissions: ['test.touch'], risk: 'low', sideEffects: true, risks: [], returns: 'x', execute: () => 'ok' }));
    j.permissions.grant(USER, AGENT, 'test.touch');
    const notes: string[] = [];
    j.bus.on('notification', (n) => notes.push(n.title));
    for (let i = 0; i < 25; i++) await j.tools.invoke(AGENT, 'test.touch', {});
    expect(j.permissions.isLockdown()).toBe(true);
    const a = j.monitor.list()[0]!;
    expect(a).toMatchObject({ level: 'critical', rule: 'burst', action: 'Modo emergencia activado automáticamente', acknowledged: false });
    expect(notes.some((n) => n.includes('Ráfaga'))).toBe(true);
    expect(j.monitor.list().filter((x) => x.rule === 'burst')).toHaveLength(1); // sin repetir
    expect(j.monitor.acknowledge(USER)).toBe(1);
    expect(j.monitor.unacknowledged()).toBe(0);
  });

  it('con el bloqueo automático desactivado solo avisa; denegaciones y escalada se detectan', async () => {
    const { j } = await make();
    j.monitor.setAutoLockdown(USER, false);
    j.tools.register(defineTool({ name: 'test.touch', description: 't', parameters: z.object({}), permissions: ['test.touch'], risk: 'low', sideEffects: true, risks: [], returns: 'x', execute: () => 'ok' }));
    j.permissions.grant(USER, AGENT, 'test.touch');
    for (let i = 0; i < 21; i++) await j.tools.invoke(AGENT, 'test.touch', {});
    expect(j.permissions.isLockdown()).toBe(false);
    for (let i = 0; i < 6; i++) await j.tools.invoke({ kind: 'agent', id: 'curioso' }, 'test.touch', {});
    expect(() => j.automations.setEnabled({ kind: 'agent', id: 'curioso' }, 'x', true)).toThrow();
    const rules = j.monitor.list().map((a) => a.rule);
    expect(rules).toEqual(expect.arrayContaining(['burst', 'denials', 'escalation']));
  });

  it('fallos de autenticación repetidos y dispositivo nuevo; auditoría manipulada → crítica', async () => {
    const { j } = await make();
    const app = await buildServer(j, 'z'.repeat(43));
    for (let i = 0; i < 5; i++) await app.inject({ url: '/api/health', headers: { authorization: 'Bearer malo' } });
    expect(j.monitor.list()[0]).toMatchObject({ rule: 'auth', level: 'warning' });
    const { code } = (await app.inject({ method: 'POST', url: '/api/pair/start', headers: { authorization: `Bearer ${'z'.repeat(43)}` } })).json();
    expect((await app.inject({ method: 'POST', url: '/api/pair/complete', remoteAddress: '10.0.0.9', payload: { code, name: 'Móvil raro' } })).statusCode).toBe(200);
    expect(j.monitor.list().find((a) => a.rule === 'device')).toMatchObject({ level: 'info', detail: expect.stringContaining('Móvil raro') });
    await app.close();
    expect(j.monitor.checkAudit()).toBe(true);
    j.db.exec('DROP TRIGGER IF EXISTS audit_no_update');
    j.db.exec("UPDATE audit_log SET action = 'falsificado' WHERE seq = 2");
    expect(j.monitor.checkAudit()).toBe(false);
    expect(j.monitor.list()[0]).toMatchObject({ rule: 'audit.tampered', level: 'critical' });
    expect(j.permissions.isLockdown()).toBe(true);
  });
});

describe('Diagnóstico, mantenimiento y actualizaciones', () => {
  it('diagnóstico completo sin secretos; limpieza de historiales antiguos (nunca la auditoría)', async () => {
    const { j } = await make();
    j.vault.set('ai.anthropic.apiKey', 'sk-ant-api03-SECRETO-00000000000000');
    const r = runDiagnostics(j);
    expect(r.checks.map((c) => c.id)).toEqual(['db', 'audit', 'vault', 'modules', 'disk', 'ai', 'connectors', 'automations', 'backup', 'security', 'remote', 'runtime']);
    expect(r.checks.find((c) => c.id === 'db')!.status).toBe('ok');
    expect(r.checks.find((c) => c.id === 'backup')!.status).toBe('warn');
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    j.db.prepare("INSERT INTO connector_log (ts, connector, operation, outcome, detail) VALUES ('2020-01-01T00:00:00Z', 'x', 'y', 'ok', 'z')").run();
    const auditBefore = j.audit.verify();
    expect(cleanup(j, USER, 90, true)).toMatchObject({ connectorLog: 1 });
    expect(j.audit.verify()).toMatchObject({ ok: true });
    expect((j.audit.verify() as { count: number }).count).toBe((auditBefore as { count: number }).count + 1);
  });

  it('comprobar actualizaciones en GitHub Releases', async () => {
    const { j } = await make();
    const rel = (tag: string) => (async () => Response.json({ tag_name: tag, html_url: `https://github.com/x/y/releases/${tag}`, body: 'Novedades' })) as unknown as typeof fetch;
    expect(await checkUpdates(j, rel('v99.0.0'))).toMatchObject({ newer: true, latest: '99.0.0', detail: 'Disponible la versión 99.0.0' });
    expect(await checkUpdates(j, rel(`v${j.version}`))).toMatchObject({ newer: false });
    expect(await checkUpdates(j, (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch)).toMatchObject({ latest: null, newer: false });
  });

  it('API HTTP de copias y alertas', async () => {
    const { j } = await make();
    const app = await buildServer(j, 'z'.repeat(43));
    const auth = { authorization: `Bearer ${'z'.repeat(43)}` };
    expect((await app.inject({ method: 'PUT', url: '/api/backups/passphrase', headers: auth, payload: { passphrase: 'corta' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/backups/passphrase', headers: auth, payload: { passphrase: PASS } })).json()).toEqual({ ok: true });
    const b = (await app.inject({ method: 'POST', url: '/api/backups', headers: auth })).json();
    expect(b).toMatchObject({ verified: true });
    expect((await app.inject({ url: '/api/backups', headers: auth })).json()).toMatchObject({ hasPassphrase: true, backups: [{ id: b.id }] });
    expect(JSON.stringify((await app.inject({ url: '/api/backups', headers: auth })).json())).not.toContain(PASS);
    expect((await app.inject({ url: '/api/diagnostics', headers: auth })).json().checks.length).toBe(12);
    expect((await app.inject({ url: '/api/security/alerts', headers: auth })).json()).toMatchObject({ autoLockdown: true });
    await app.close();
  });
});
