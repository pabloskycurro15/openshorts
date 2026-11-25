import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import { defineTool } from '../src/tools/registry';
import type { JarvisModule } from '../src/kernel/modules';
import { makeJarvis } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'productivity' };

let sideEffectCount = 0;
const dangerTool = defineTool({
  name: 'test.delete_thing',
  description: 'Herramienta de prueba de alto riesgo',
  parameters: z.object({ id: z.string() }),
  permissions: (a) => [`test.delete:${a.id}`],
  risk: 'high',
  sideEffects: true,
  risks: ['Borra cosas'],
  returns: 'ok',
  execute: ({ id }) => { sideEffectCount++; return { deleted: id }; },
});
const testModule: JarvisModule = {
  manifest: { id: 'testtools', name: 't', version: '0', description: '' },
  start: (ctx) => ctx.tools.register(dangerTool),
};

describe('ToolRegistry', () => {
  it('system.info devuelve datos reales del equipo', async () => {
    const j = await makeJarvis();
    const r = await j.tools.invoke(USER, 'system.info', {});
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const out = r.output as { cpu: { cores: number }; memory: { totalBytes: number } };
    expect(out.cpu.cores).toBeGreaterThan(0);
    expect(out.memory.totalBytes).toBeGreaterThan(0);
  });

  it('valida argumentos y rechaza herramientas desconocidas', async () => {
    const j = await makeJarvis();
    expect((await j.tools.invoke(USER, 'system.info', { evil: 1 })).status).toBe('error');
    expect((await j.tools.invoke(USER, 'no.existe', {})).status).toBe('error');
  });

  it('agente sin permiso → denegado, sin ejecutar', async () => {
    const j = await makeJarvis();
    expect(await j.tools.invoke(AGENT, 'system.info', {})).toMatchObject({ status: 'denied' });
  });

  it('riesgo alto: queda pendiente, y solo se ejecuta al aprobar', async () => {
    const j = await makeJarvis([testModule]);
    sideEffectCount = 0;
    const r = await j.tools.invoke(USER, 'test.delete_thing', { id: 'a1' });
    expect(r.status).toBe('pending_approval');
    expect(sideEffectCount).toBe(0);
    if (r.status !== 'pending_approval') return;
    expect(j.tools.listApprovals('pending')).toHaveLength(1);

    await expect(j.tools.resolveApproval(AGENT, r.approvalId, 'approved')).rejects.toThrow(/Solo el usuario/);
    const res = await j.tools.resolveApproval(USER, r.approvalId, 'approved');
    expect(res).toEqual({ status: 'ok', output: { deleted: 'a1' } });
    expect(sideEffectCount).toBe(1);
    expect(j.tools.getApproval(r.approvalId)!.status).toBe('approved');
    await expect(j.tools.resolveApproval(USER, r.approvalId, 'approved')).rejects.toThrow(/caducada/);
  });

  it('denegar una aprobación no ejecuta nada', async () => {
    const j = await makeJarvis([testModule]);
    sideEffectCount = 0;
    const r = await j.tools.invoke(USER, 'test.delete_thing', { id: 'b' });
    if (r.status !== 'pending_approval') throw new Error('esperaba pendiente');
    expect(await j.tools.resolveApproval(USER, r.approvalId, 'denied')).toMatchObject({ status: 'denied' });
    expect(sideEffectCount).toBe(0);
  });

  it('el modo emergencia anula aprobaciones previas y cancela pendientes', async () => {
    const j = await makeJarvis([testModule]);
    sideEffectCount = 0;
    const r = await j.tools.invoke(USER, 'test.delete_thing', { id: 'c' });
    if (r.status !== 'pending_approval') throw new Error('esperaba pendiente');
    j.permissions.setLockdown(USER, true);
    expect(await j.tools.resolveApproval(USER, r.approvalId, 'approved')).toMatchObject({ status: 'denied' });
    expect(sideEffectCount).toBe(0);
    j.permissions.setLockdown(USER, false);
    await j.tools.invoke(USER, 'test.delete_thing', { id: 'd' });
    expect(j.tools.expireAllPending()).toBe(1);
    expect(j.tools.listApprovals('expired')).toHaveLength(1);
  });

  it('permisos dinámicos por recurso para agentes', async () => {
    const j = await makeJarvis([testModule]);
    j.permissions.grant(USER, AGENT, 'test.delete:tmp-*');
    expect((await j.tools.invoke(AGENT, 'test.delete_thing', { id: 'tmp-1' })).status).toBe('pending_approval');
    // concesión válida, pero el riesgo alto siempre exige confirmación
    expect((await j.tools.invoke(AGENT, 'test.delete_thing', { id: 'prod-1' })).status).toBe('denied');
  });

  it('todas las invocaciones quedan auditadas y la cadena es válida', async () => {
    const j = await makeJarvis();
    await j.tools.invoke(USER, 'system.info', {});
    await j.tools.invoke(AGENT, 'system.info', {});
    const entries = j.audit.list().filter((e) => e.action === 'tool.invoke');
    expect(entries.map((e) => e.outcome).sort()).toEqual(['denied', 'success']);
    expect(j.audit.verify().ok).toBe(true);
  });
});

describe('ToolRegistry — espera de aprobaciones', () => {
  it('waitForApproval obtiene el resultado aunque la decisión llegue antes de empezar a esperar', async () => {
    const j = await makeJarvis([testModule]);
    const r = await j.tools.invoke(USER, 'test.delete_thing', { id: 'w1' });
    if (r.status !== 'pending_approval') throw new Error('esperaba pendiente');
    const resolving = j.tools.resolveApproval(USER, r.approvalId, 'approved'); // sin await: carrera
    const waited = await j.tools.waitForApproval(r.approvalId);
    expect(waited).toEqual({ status: 'ok', output: { deleted: 'w1' } });
    await resolving;
  });

  it('una aprobación caducada resuelve la espera como denegada', async () => {
    const j = await makeJarvis([testModule]);
    const r = await j.tools.invoke(USER, 'test.delete_thing', { id: 'w2' });
    if (r.status !== 'pending_approval') throw new Error('esperaba pendiente');
    const p = j.tools.waitForApproval(r.approvalId);
    j.tools.expireAllPending();
    expect(await p).toMatchObject({ status: 'denied' });
  });

  it('un agente interactivo sin permiso recibe una pregunta (no una denegación); en segundo plano se deniega', async () => {
    const j = await makeJarvis();
    expect((await j.tools.invoke(AGENT, 'system.info', {}, { interactive: true })).status).toBe('pending_approval');
    expect((await j.tools.invoke(AGENT, 'system.info', {})).status).toBe('denied');
  });
});
