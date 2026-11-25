import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { computeNextRun, describeTrigger, renderTemplate } from '../src/automations/manager';
import { defineTool } from '../src/tools/registry';
import type { JarvisModule } from '../src/kernel/modules';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'jarvis' };

/** Herramientas de prueba: una de lectura, una con efectos (riesgo medio), una de riesgo alto y una que falla. */
function testModule(log: string[], failures: { n: number }): JarvisModule {
  return {
    manifest: { id: 'testtools', name: 'Pruebas', version: '1', description: 't' },
    start(ctx) {
      ctx.tools.register(defineTool({ name: 'test.read', description: 'lee', parameters: z.object({ q: z.string().default('') }), permissions: ['test.read'], risk: 'low', sideEffects: false, risks: [], returns: 'x',
        execute: ({ q }) => { if (failures.n > 0) { failures.n--; throw new Error('Fallo de red'); } log.push(`read:${q}`); return `leído ${q}`; } }));
      ctx.tools.register(defineTool({ name: 'test.write', description: 'escribe', parameters: z.object({ text: z.string() }), permissions: ['test.write'], risk: 'medium', sideEffects: true, risks: [], returns: 'x',
        execute: ({ text: t }) => { log.push(`write:${t}`); return 'ok'; } }));
      ctx.tools.register(defineTool({ name: 'test.danger', description: 'peligro', parameters: z.object({}), permissions: ['test.danger'], risk: 'high', sideEffects: true, risks: ['x'], returns: 'x',
        execute: () => { log.push('danger'); return 'hecho'; } }));
    },
  };
}

const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0] = []) {
  const log: string[] = [];
  const failures = { n: 0 };
  const provider = new ScriptedProvider(script);
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: [], providerFactory: () => provider, extraModules: [testModule(log, failures)] });
  await j.start();
  running.push(j);
  j.automations.retryDelayMs = 10;
  return { j, log, failures, provider };
}

const steps = (s: { tool: string; args?: object }[], trigger: object = { type: 'manual' }) => ({ name: 'Prueba', trigger, action: { mode: 'steps', steps: s.map((x) => ({ args: {}, ...x })) } });
const wait = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

describe('Automatizaciones: utilidades', () => {
  it('próxima ejecución diaria (días y hora local), intervalo y una vez', () => {
    const mon = new Date(2026, 10, 23, 9, 0); // lunes 23-11-2026 09:00
    expect(computeNextRun({ type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5, 6, 7] }, mon)).toEqual(new Date(2026, 10, 24, 8, 0));
    expect(computeNextRun({ type: 'daily', time: '10:30', days: [1, 2, 3, 4, 5, 6, 7] }, mon)).toEqual(new Date(2026, 10, 23, 10, 30));
    expect(computeNextRun({ type: 'daily', time: '08:00', days: [6] }, mon)).toEqual(new Date(2026, 10, 28, 8, 0)); // sábado
    expect(computeNextRun({ type: 'interval', minutes: 15 }, mon)).toEqual(new Date(2026, 10, 23, 9, 15));
    expect(computeNextRun({ type: 'once', at: '2026-11-23T08:00' }, mon)).toBeNull();
    expect(computeNextRun({ type: 'once', at: '2026-12-01T18:45' }, mon)).toEqual(new Date(2026, 11, 1, 18, 45));
    expect(computeNextRun({ type: 'manual' }, mon)).toBeNull();
    expect(describeTrigger({ type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] })).toBe('L M X J V a las 08:00');
  });
  it('plantillas en los argumentos', () => {
    const now = new Date(2026, 0, 5, 7, 3);
    expect(renderTemplate({ a: 'De {{event.from}}: {{ event.text }}', b: ['{{last}}', 3], c: '{{date}} {{time}} {{otro}}' }, { event: { from: 'Ana', text: 'hola' }, last: 'previo', now }))
      .toEqual({ a: 'De Ana: hola', b: ['previo', 3], c: '2026-01-05 07:03 ' });
  });
});

describe('Automatizaciones: ciclo de vida y permisos', () => {
  it('solo el usuario activa; activar concede los permisos justos a su identidad; JARVIS solo propone', async () => {
    const { j, log } = await setup();
    const prop = (await j.tools.invoke(AGENT, 'automations.propose', steps([{ tool: 'test.read', args: { q: 'x' } }, { tool: 'test.write', args: { text: '{{last}}' } }]), { interactive: true }));
    // Proponer no requiere permiso especial si el usuario lo aprueba; aquí el agente no tiene concesión → pregunta.
    expect(prop.status).toBe('pending_approval');
    const done = await j.tools.resolveApproval(USER, (prop as { approvalId: string }).approvalId, 'approved');
    const id = (done as { output: { id: string } }).output.id;
    const a = j.automations.get(id)!;
    expect(a).toMatchObject({ enabled: false, proposed: true, createdBy: 'agent:jarvis' });
    expect(() => j.automations.setEnabled(AGENT, id, true)).toThrow(/usuario/);
    await expect(j.automations.runNow(USER, id)).rejects.toThrow(/Actívala/);

    const on = j.automations.setEnabled(USER, id, true);
    expect(on).toMatchObject({ enabled: true, proposed: false, grants: ['test.read', 'test.write'] });
    expect(j.permissions.listGrants({ kind: 'automation', id }).map((g) => g.scope).sort()).toEqual(['test.read', 'test.write']);

    const run = await j.automations.runNow(USER, id);
    expect(run).toMatchObject({ status: 'ok', result: 'ok', trigger: 'Ejecución manual' });
    expect(log).toEqual(['read:x', 'write:leído x']);
    expect(run.log.map((l) => l.text)).toContain('Paso 2: test.write');

    j.automations.delete(USER, id);
    expect(j.permissions.listGrants({ kind: 'automation', id })).toHaveLength(0);
  });

  it('valida herramientas, intervalo mínimo con IA y prohíbe crear automatizaciones desde una automatización', async () => {
    const { j } = await setup();
    expect(() => j.automations.create(USER, steps([{ tool: 'no.existe' }]))).toThrow(/desconocida/);
    expect(() => j.automations.create(USER, { name: 'x', trigger: { type: 'interval', minutes: 10 }, action: { mode: 'ai', instructions: 'Haz algo útil', tools: [] } })).toThrow(/30 min/);
    expect(() => j.automations.create(USER, { name: 'x', trigger: { type: 'manual' }, action: { mode: 'ai', instructions: 'Haz algo útil', tools: ['automations.propose'] } })).toThrow(/no puede crear/);
    expect(() => j.automations.create(USER, { name: 'x', trigger: { type: 'daily', time: '25:00' }, action: { mode: 'steps', steps: [{ tool: 'test.read' }] } })).toThrow();
  });

  it('riesgo alto: la ejecución espera la confirmación del usuario', async () => {
    const { j, log } = await setup();
    const a = j.automations.create(USER, steps([{ tool: 'test.danger' }]));
    j.automations.setEnabled(USER, a.id, true);
    const notes: string[] = [];
    j.bus.on('notification', (n) => notes.push(n.title));
    const p = j.automations.runNow(USER, a.id);
    await wait(() => j.tools.listApprovals('pending').length === 1);
    expect(j.automations.get(a.id)!.lastRun!.status).toBe('waiting_approval');
    expect(notes[0]).toContain('necesita tu confirmación');
    expect(log).toEqual([]);
    await j.tools.resolveApproval(USER, j.tools.listApprovals('pending')[0]!.id, 'approved');
    expect(await p).toMatchObject({ status: 'ok' });
    expect(log).toEqual(['danger']);
  });

  it('sin permiso concedido para una herramienta → pide confirmación; denegada → estado «denied» y aviso', async () => {
    const { j } = await setup();
    const a = j.automations.create(USER, steps([{ tool: 'test.write', args: { text: 'x' } }]));
    j.automations.setEnabled(USER, a.id, true);
    j.permissions.revoke(USER, { kind: 'automation', id: a.id });
    const p = j.automations.runNow(USER, a.id);
    await wait(() => j.tools.listApprovals('pending').length === 1);
    await j.tools.resolveApproval(USER, j.tools.listApprovals('pending')[0]!.id, 'denied');
    expect(await p).toMatchObject({ status: 'denied', error: expect.stringContaining('Denegado por el usuario') });
  });
});

describe('Automatizaciones: disparadores', () => {
  it('diaria: el programador la ejecuta a su hora y calcula la siguiente; una vez → se desactiva sola', async () => {
    const { j, log } = await setup();
    const a = j.automations.create(USER, steps([{ tool: 'test.read', args: { q: 'diaria' } }], { type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5, 6, 7] }));
    j.automations.setEnabled(USER, a.id, true);
    const next = new Date(j.automations.get(a.id)!.nextRunAt!);
    expect(next.getHours()).toBe(8);
    await j.automations.tick(new Date(next.getTime() - 1000));
    expect(log).toEqual([]);
    await j.automations.tick(new Date(next.getTime() + 1000));
    await wait(() => log.length === 1);
    expect(new Date(j.automations.get(a.id)!.nextRunAt!).getTime()).toBe(next.getTime() + 86_400_000);

    const at = new Date(Date.now() + 3600_000);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const once = j.automations.create(USER, steps([{ tool: 'test.read', args: { q: 'una' } }], { type: 'once', at: `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}T${p2(at.getHours())}:${p2(at.getMinutes())}` }));
    j.automations.setEnabled(USER, once.id, true);
    await j.automations.tick(new Date(at.getTime() + 60_000));
    await wait(() => log.includes('read:una'));
    await wait(() => !j.automations.get(once.id)!.enabled);
    expect(j.automations.get(once.id)).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('WhatsApp recibido (con filtros) y plantillas del evento', async () => {
    const { j, log } = await setup();
    const a = j.automations.create(USER, steps([{ tool: 'test.write', args: { text: '{{event.name}} dice {{event.text}}' } }], { type: 'whatsapp', from: 'bar', contains: 'reserva' }));
    j.automations.setEnabled(USER, a.id, true);
    j.bus.emit('connector.event', { connector: 'whatsapp', event: 'message', data: { from: '34611', name: 'Bar La Plaza', text: 'Hola' } });
    j.bus.emit('connector.event', { connector: 'whatsapp', event: 'message', data: { from: '34622', name: 'Ana', text: 'una reserva' } });
    j.bus.emit('connector.event', { connector: 'whatsapp', event: 'message', data: { from: '34611', name: 'Bar La Plaza', text: 'Quiero una RESERVA' } });
    await wait(() => log.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual(['write:Bar La Plaza dice Quiero una RESERVA']);
  });

  it('condición: CPU por encima del umbral durante X minutos, una sola vez hasta que baje', async () => {
    const { j, log } = await setup();
    let cpu = 95;
    j.automations.sampleCpu = () => cpu;
    const a = j.automations.create(USER, steps([{ tool: 'test.read', args: { q: 'cpu' } }], { type: 'condition', metric: 'cpu', above: 90, forMinutes: 5 }));
    j.automations.setEnabled(USER, a.id, true);
    const t0 = Date.now();
    await j.automations.tick(new Date(t0));
    await j.automations.tick(new Date(t0 + 4 * 60_000));
    expect(log).toEqual([]);
    await j.automations.tick(new Date(t0 + 5 * 60_000));
    await wait(() => log.length === 1);
    await j.automations.tick(new Date(t0 + 6 * 60_000));
    cpu = 20;
    await j.automations.tick(new Date(t0 + 7 * 60_000));
    cpu = 99;
    await j.automations.tick(new Date(t0 + 8 * 60_000));
    await j.automations.tick(new Date(t0 + 13 * 60_000));
    await wait(() => log.length === 2);
  });

  it('Gmail: la primera consulta solo toma nota; después dispara por cada correo nuevo', async () => {
    const { j, log } = await setup();
    let inbox = [{ id: 'm1', from: 'Ana', subject: 'Viejo', snippet: '', date: '' }];
    j.tools.register(defineTool({ name: 'gmail.search', description: 'g', parameters: z.object({ query: z.string(), limit: z.number().optional() }), permissions: ['connector.google.gmail.read'], risk: 'medium', sideEffects: false, risks: [], returns: 'x', execute: () => inbox }));
    const a = j.automations.create(USER, steps([{ tool: 'test.write', args: { text: 'Correo de {{event.from}}: {{event.subject}}' } }], { type: 'gmail', query: 'from:ana' }));
    expect(j.automations.setEnabled(USER, a.id, true).grants).toContain('connector.google.gmail.read');
    const t0 = Date.now();
    await j.automations.tick(new Date(t0));
    expect(log).toEqual([]);
    inbox = [{ id: 'm2', from: 'Ana', subject: 'Nuevo', snippet: '', date: '' }, ...inbox];
    await j.automations.tick(new Date(t0 + 60_000)); // antes de 5 min: no consulta
    expect(log).toEqual([]);
    await j.automations.tick(new Date(t0 + 5 * 60_000 + 1));
    await wait(() => log.length === 1);
    expect(log).toEqual(['write:Correo de Ana: Nuevo']);
  });
});

describe('Automatizaciones: ejecución', () => {
  it('reintento seguro tras un fallo sin efectos; sin reintento si ya hubo efectos', async () => {
    const { j, log, failures } = await setup();
    const a = j.automations.create(USER, { ...steps([{ tool: 'test.read', args: { q: 'r' } }]), retries: 2 });
    j.automations.setEnabled(USER, a.id, true);
    failures.n = 1;
    expect(await j.automations.runNow(USER, a.id)).toMatchObject({ status: 'error', attempt: 1 });
    await wait(() => log.includes('read:r'));
    await wait(() => j.automations.runs(a.id).some((r) => r.status === 'ok'));
    expect(j.automations.runs(a.id).map((r) => [r.attempt, r.status])).toEqual([[2, 'ok'], [1, 'error']]);

    const b = j.automations.create(USER, { ...steps([{ tool: 'test.write', args: { text: 'w' } }, { tool: 'test.read' }]), retries: 2 });
    j.automations.setEnabled(USER, b.id, true);
    failures.n = 5;
    const r = await j.automations.runNow(USER, b.id);
    expect(r.status).toBe('error');
    await new Promise((res) => setTimeout(res, 60));
    expect(j.automations.runs(b.id)).toHaveLength(1);
    expect(j.automations.runs(b.id)[0]!.log.at(-1)!.text).toContain('Sin reintento');
  });

  it('límite diario, ejecuciones solapadas y emergencia → omitidas', async () => {
    const { j } = await setup();
    const a = j.automations.create(USER, { ...steps([{ tool: 'test.read' }]), maxRunsPerDay: 1 });
    j.automations.setEnabled(USER, a.id, true);
    expect((await j.automations.runNow(USER, a.id)).status).toBe('ok');
    expect(await j.automations.runNow(USER, a.id)).toMatchObject({ status: 'skipped', error: expect.stringContaining('Límite diario') });
    j.permissions.setLockdown(USER, true);
    await expect(j.automations.runNow(USER, a.id)).rejects.toThrow(/emergencia/);
    expect(await j.automations.trigger(a.id, 'x', null)).toMatchObject({ status: 'skipped', error: 'Modo emergencia activo' });
  });

  it('modo IA: usa solo las herramientas elegidas, con su identidad, y guarda resultado y coste', async () => {
    const { j, log, provider } = await setup([
      toolCall('c1', 'test.danger', {}),
      toolCall('c2', 'test.read', { q: 'correo' }),
      text('Resumen: leí el correo.'),
    ]);
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    const a = j.automations.create(USER, { name: 'Resumen', trigger: { type: 'manual' }, action: { mode: 'ai', instructions: 'Lee el correo y resúmelo', tools: ['test.read'] } });
    expect(j.automations.setEnabled(USER, a.id, true).grants.sort()).toEqual(['notify.send', 'system.time.read', 'test.read'].sort());
    const r = await j.automations.runNow(USER, a.id);
    expect(r).toMatchObject({ status: 'denied', result: 'Resumen: leí el correo.' });
    expect(r.error).toContain('test.danger');
    expect(r.costUsd).toBeGreaterThan(0);
    expect(log).toEqual(['read:correo']);
    expect(provider.calls[0]!.tools!.map((t) => t.name).sort()).toEqual(expect.arrayContaining(['test.read']));
    expect(JSON.stringify(provider.calls[0]!.messages)).toContain('Disparador: Ejecución manual');
  });

  it('API HTTP: crear y activar, listar, ejecutar, historial, borrar; emergencia', async () => {
    const { j } = await setup();
    const app = await buildServer(j, 'z'.repeat(43));
    const auth = { authorization: `Bearer ${'z'.repeat(43)}` };
    expect((await app.inject({ method: 'POST', url: '/api/automations', headers: auth, payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/automations/scopes', headers: auth, payload: steps([{ tool: 'test.write', args: { text: 'a' } }]) })).json()).toEqual({ scopes: ['test.write'] });
    const a = (await app.inject({ method: 'POST', url: '/api/automations', headers: auth, payload: { ...steps([{ tool: 'test.read' }]), enable: true } })).json();
    expect(a).toMatchObject({ enabled: true, grants: ['test.read'] });
    expect((await app.inject({ method: 'POST', url: `/api/automations/${a.id}/run`, headers: auth, payload: {} })).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject({ url: `/api/automations/${a.id}/runs`, headers: auth })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'PUT', url: `/api/automations/${a.id}`, headers: auth, payload: { ...steps([{ tool: 'test.write', args: { text: 'b' } }]), name: 'Cambiada' } })).json()).toMatchObject({ name: 'Cambiada', grants: ['test.write'] });
    j.permissions.setLockdown(USER, true);
    expect((await app.inject({ method: 'POST', url: `/api/automations/${a.id}/run`, headers: auth, payload: {} })).statusCode).toBe(423);
    j.permissions.setLockdown(USER, false);
    expect((await app.inject({ method: 'DELETE', url: `/api/automations/${a.id}`, headers: auth })).json()).toEqual({ deleted: true });
    expect((await app.inject({ url: '/api/automations', headers: auth })).json()).toEqual([]);
    await app.close();
  });
});
