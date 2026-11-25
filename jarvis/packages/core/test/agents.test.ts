import { describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { extractJson } from '../src/agents/tasks';
import { AGENTS, allowsTool } from '../src/agents/definitions';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const plan = (subtasks: object[]) => text(`Este es el plan:\n\`\`\`json\n${JSON.stringify({ subtasks })}\n\`\`\``);

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0]) {
  const provider = new ScriptedProvider(script);
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactory: () => provider, embedder: null });
  await j.start();
  j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
  return { j, provider };
}

describe('Agentes: definiciones', () => {
  it('8 agentes con herramientas acotadas', () => {
    expect(AGENTS.map((a) => a.id)).toEqual(['investigador', 'programador', 'documental', 'productividad', 'analista', 'sistema', 'automatizacion', 'integraciones']);
    const prog = AGENTS.find((a) => a.id === 'programador')!;
    expect(allowsTool(prog, 'fs.create_file')).toBe(true);
    expect(allowsTool(prog, 'app.close')).toBe(false);
    expect(allowsTool(AGENTS.find((a) => a.id === 'investigador')!, 'fs.delete')).toBe(false);
  });
  it('extrae el JSON del plan aunque venga con texto o bloques', () => {
    expect(extractJson('Vale. {"a":1} listo')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(() => extractJson('sin json')).toThrow();
  });
});

describe('Agentes: ejecución', () => {
  it('coordinador planifica → agentes ejecutan con su identidad → síntesis; coste acumulado', async () => {
    const { j, provider } = await setup([
      plan([{ agent: 'analista', title: 'Analizar', instructions: 'Analiza la idea' }, { agent: 'documental', title: 'Redactar', instructions: 'Redacta un resumen' }]),
      text('Análisis: la idea es viable.'),
      text('Resumen redactado.'),
      text('Resultado final: idea viable y resumen listo.'),
    ]);
    const t = j.tasks.start('Evalúa una idea de negocio y redacta un resumen');
    const done = await j.tasks.waitFor(t.id);
    expect(done.status).toBe('done');
    expect(done.subtasks.map((s) => [s.agentId, s.status, s.result])).toEqual([
      ['analista', 'done', 'Análisis: la idea es viable.'],
      ['documental', 'done', 'Resumen redactado.'],
    ]);
    expect(done.result).toBe('Resultado final: idea viable y resumen listo.');
    expect(done.costUsd).toBeGreaterThan(0);
    // El segundo agente recibe el resultado del primero.
    const secondPrompt = JSON.stringify(provider.calls[2]!.messages[0]);
    expect(secondPrompt).toContain('Análisis: la idea es viable.');
    // Cada agente usa su propio prompt y solo sus herramientas.
    expect(provider.calls[1]!.system).toMatch(/análisis/i);
    expect(provider.calls[1]!.tools.map((x) => x.name)).not.toContain('fs.create_file');
    expect(provider.calls[2]!.tools.map((x) => x.name)).toContain('fs.create_file');
    expect(provider.calls[0]!.tools).toEqual([]); // el coordinador no usa herramientas
    expect(j.tasks.agents().find((a) => a.id === 'analista')!.stats).toMatchObject({ subtasks: 1, done: 1 });
  });

  it('herramienta no permitida para el agente → denegada; permiso pendiente → espera al usuario', async () => {
    const { j } = await setup([
      plan([{ agent: 'productividad', title: 'Hora', instructions: 'Di la hora' }]),
      toolCall('t1', 'command.run', { commandId: 'x' }), // no está entre sus herramientas
      toolCall('t2', 'system.datetime'),
      text('Son las doce.'),
      text('Hecho: son las doce.'),
    ]);
    const approvals: string[] = [];
    j.bus.on('approval.requested', (a) => approvals.push(a.id));
    const t = j.tasks.start('Dime qué hora es');
    // espera a que pida permiso (agente productividad sin concesión)
    for (let i = 0; i < 100 && !approvals.length; i++) await new Promise((r) => setTimeout(r, 10));
    const mid = j.tasks.get(t.id)!;
    expect(mid.subtasks[0]!.status).toBe('waiting_approval');
    expect(j.tools.getApproval(approvals[0]!)!.principal).toEqual({ kind: 'agent', id: 'productividad' });
    await j.tools.resolveApproval(USER, approvals[0]!, 'approved');
    const done = await j.tasks.waitFor(t.id);
    expect(done.status).toBe('done');
    const log = done.subtasks[0]!.log.map((l) => l.text).join(' | ');
    expect(log).toMatch(/command\.run: Denegado: Esta herramienta no está permitida/);
    expect(log).toMatch(/system\.datetime: Completado/);
  });

  it('plan ilegible → una sola subtarea con el agente de análisis', async () => {
    const { j } = await setup([text('No sé hacer JSON'), text('Hecho.'), text('Final.')]);
    const done = await j.tasks.waitFor(j.tasks.start('Algo difícil de planificar').id);
    expect(done.subtasks.map((s) => s.agentId)).toEqual(['analista']);
    expect(done.status).toBe('done');
  });

  it('agentes desactivados no se usan; agente desconocido → el de análisis', async () => {
    const { j } = await setup([plan([{ agent: 'programador', title: 'X', instructions: 'X' }, { agent: 'inventado', title: 'Y', instructions: 'Y' }]), text('a'), text('b'), text('final')]);
    j.tasks.setEnabled(USER, 'programador', false);
    expect(() => j.tasks.setEnabled({ kind: 'agent', id: 'programador' }, 'programador', true)).toThrow(/Solo el usuario/);
    const done = await j.tasks.waitFor(j.tasks.start('Tarea de dos pasos').id);
    expect(done.subtasks.map((s) => s.agentId)).toEqual(['analista', 'analista']);
  });

  it('cancelar y emergencia detienen la tarea', async () => {
    let release!: () => void;
    const { j } = await setup([plan([{ agent: 'analista', title: 'Lento', instructions: 'x' }]), () => new Promise((r) => { release = () => r(text('tarde')); })]);
    const t = j.tasks.start('Tarea lenta de prueba');
    for (let i = 0; i < 100 && j.tasks.get(t.id)!.subtasks[0]?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10));
    j.permissions.setLockdown(USER, true);
    release();
    const done = await j.tasks.waitFor(t.id);
    expect(done.status).toBe('cancelled');
  });

  it('API: crear, listar, ver, agentes; emergencia impide crear', async () => {
    const { j } = await setup([plan([{ agent: 'analista', title: 'A', instructions: 'A' }]), text('ok'), text('final')]);
    const app = await buildServer(j, 'z'.repeat(43));
    const auth = { authorization: `Bearer ${'z'.repeat(43)}` };
    const created = (await app.inject({ method: 'POST', url: '/api/tasks', headers: auth, payload: { goal: 'Analiza algo útil' } })).json();
    await j.tasks.waitFor(created.id);
    expect((await app.inject({ url: `/api/tasks/${created.id}`, headers: auth })).json()).toMatchObject({ status: 'done', result: 'final' });
    expect((await app.inject({ url: '/api/tasks', headers: auth })).json()).toHaveLength(1);
    expect((await app.inject({ url: '/api/agents', headers: auth })).json()).toHaveLength(8);
    j.permissions.setLockdown(USER, true);
    expect((await app.inject({ method: 'POST', url: '/api/tasks', headers: auth, payload: { goal: 'Otra cosa más' } })).statusCode).toBe(423);
    await app.close();
  });
});
