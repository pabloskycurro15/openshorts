import { describe, expect, it } from 'vitest';
import type { ChatEvent, Principal } from '@jarvis/shared';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { JARVIS_PRINCIPAL, MAX_STEPS } from '../src/ai/engine';
import { ProviderError } from '../src/ai/provider';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0], withKey = true) {
  const provider = new ScriptedProvider(script);
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', providerFactory: () => provider });
  await j.start();
  if (withKey) j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
  // Estas pruebas fijan Opus; el repartidor tiene sus propias pruebas.
  j.ai.budget.updateSettings({ model: 'claude-opus-5-5' });
  const events: ChatEvent[] = [];
  const run = (message: string, conversationId?: string, signal?: AbortSignal) => j.ai.engine.run({ message, conversationId }, (e) => events.push(e), signal);
  return { j, provider, events, run };
}

const of = <T extends ChatEvent['type']>(events: ChatEvent[], type: T) => events.filter((e): e is Extract<ChatEvent, { type: T }> => e.type === type);

describe('ChatEngine', () => {
  it('sin clave API avisa y no llama a nadie', async () => {
    const { events, run, provider } = await setup([], false);
    await run('hola');
    expect(of(events, 'error')[0]!.message).toMatch(/clave/);
    expect(provider.calls).toHaveLength(0);
  });

  it('respuesta simple: streaming, persistencia, coste y estado', async () => {
    const { j, events, run, provider } = await setup([text('Buenas tardes.')]);
    const states: string[] = [];
    j.bus.on('assistant.state', ({ state }) => states.push(state));
    await run('Hola, JARVIS');
    const start = of(events, 'start')[0]!;
    expect(start.title).toBe('Hola, JARVIS');
    expect(of(events, 'text').map((e) => e.delta).join('')).toBe('Buenas tardes.');
    const usage = of(events, 'usage')[0]!;
    // 1000 entrada × 4 $/M + 100 salida × 20 $/M = 0,006 $
    expect(usage.costUsd).toBeCloseTo(0.006);
    expect(of(events, 'done')[0]!.stopReason).toBe('end_turn');
    expect(j.ai.store.view(start.conversationId).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(provider.calls[0]!.model).toBe('claude-opus-5-5');
    expect(provider.calls[0]!.system).toMatch(/JARVIS/);
    expect(states).toEqual(['thinking', 'speaking', 'idle']);
    expect(j.audit.list().some((e) => e.action === 'ai.turn')).toBe(true);
  });

  it('herramienta sin permiso → pide confirmación; "aprobar siempre" la concede para la próxima vez', async () => {
    const { j, events, run, provider } = await setup([
      toolCall('t1', 'system.datetime', {}, 'Consulto la hora.'),
      text('Son las doce.'),
      toolCall('t2', 'system.datetime'),
      text('Sigue siendo pronto.'),
    ]);
    j.bus.on('approval.requested', (a) => void j.tools.resolveApproval(USER, a.id, 'approved_always'));
    await run('¿Qué hora es?');
    expect(of(events, 'approval_required')).toHaveLength(1);
    expect(of(events, 'approval_required')[0]!.reason).toBe('Devuelve la fecha y hora actuales del equipo y su zona horaria. (permiso: system.time.read)');
    expect(of(events, 'tool_result')[0]).toMatchObject({ tool: 'system.datetime', status: 'ok' });
    // El modelo recibe el resultado real de la herramienta.
    const second = provider.calls[1]!.messages.at(-1)!;
    expect(second.content[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1' });
    expect(j.permissions.listGrants(JARVIS_PRINCIPAL).map((g) => g.scope)).toEqual(['system.time.read']);

    const conv = of(events, 'start')[0]!.conversationId;
    events.length = 0;
    await run('¿Y ahora?', conv);
    expect(of(events, 'approval_required')).toHaveLength(0);
    expect(of(events, 'tool_result')[0]!.status).toBe('ok');
  });

  it('herramienta denegada: el modelo recibe el error y la conversación continúa', async () => {
    const { j, events, run, provider } = await setup([toolCall('t1', 'system.info'), text('Entendido, no consultaré el equipo.')]);
    j.bus.on('approval.requested', (a) => void j.tools.resolveApproval(USER, a.id, 'denied'));
    await run('¿Cómo va el equipo?');
    expect(of(events, 'tool_result')[0]!.status).toBe('denied');
    const res = provider.calls[1]!.messages.at(-1)!.content[0] as { isError?: boolean; content: string };
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no lo intentes por otra vía/);
    expect(of(events, 'done')[0]!.stopReason).toBe('end_turn');
  });

  it('herramienta inexistente o argumentos no válidos → error devuelto al modelo, sin ejecutar', async () => {
    const { events, run } = await setup([toolCall('t1', 'fs.delete_everything', { path: '/' }), toolCall('t2', 'system.info', { x: 1 }), text('No puedo.')]);
    await run('borra todo');
    expect(of(events, 'tool_result').map((e) => e.status)).toEqual(['error', 'error']);
  });

  it('cancelar mientras espera confirmación deja el historial válido', async () => {
    const ctrl = new AbortController();
    const { j, events, run } = await setup([toolCall('t1', 'system.info')]);
    j.bus.on('approval.requested', () => setTimeout(() => ctrl.abort(), 10));
    await run('estado', undefined, ctrl.signal);
    expect(of(events, 'done')[0]!.stopReason).toBe('cancelled');
    const conv = of(events, 'start')[0]!.conversationId;
    const hist = j.ai.store.history(conv);
    expect(hist.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(hist[2]!.content[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1', isError: true });
  });

  it('límite de gasto alcanzado → no llama al modelo', async () => {
    const { j, events, run, provider } = await setup([text('x')]);
    j.ai.budget.updateSettings({ monthlyLimitUsd: 0.001 });
    j.ai.budget.record({ conversationId: null, provider: 'anthropic', model: 'claude-opus-5-5', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.002 });
    await run('hola');
    expect(provider.calls).toHaveLength(0);
    expect(of(events, 'error')[0]!.message).toMatch(/Límite de gasto/);
  });

  it('aviso al cruzar el 80 % del límite', async () => {
    const { j, events, run } = await setup([text('ok')]);
    j.ai.budget.updateSettings({ monthlyLimitUsd: 0.007 }); // la respuesta cuesta 0,006
    await run('hola');
    expect(of(events, 'warning')[0]!.message).toMatch(/%/);
  });

  it('negativa del modelo: se informa y la respuesta parcial no entra en el historial', async () => {
    const { j, events, run } = await setup([{ ...text('parcial'), stopReason: 'refusal', refusalDetail: 'política' }]);
    await run('algo');
    expect(of(events, 'error')[0]!.message).toMatch(/declinado.*política/);
    expect(j.ai.store.history(of(events, 'start')[0]!.conversationId)).toHaveLength(1);
  });

  it('error del proveedor → mensaje claro y estado de error', async () => {
    const { j, events, run } = await setup([() => { throw new ProviderError('No hay conexión con Anthropic. Revisa Internet.', 'network'); }]);
    const states: string[] = [];
    j.bus.on('assistant.state', ({ state }) => states.push(state));
    await run('hola');
    expect(of(events, 'error')[0]!.message).toBe('No hay conexión con Anthropic. Revisa Internet.');
    expect(states.at(-1)).toBe('error');
  });

  it(`corta tras ${MAX_STEPS} pasos para no gastar sin fin`, async () => {
    const script = Array.from({ length: MAX_STEPS + 2 }, (_, i) => toolCall(`t${i}`, 'system.datetime'));
    const { j, events, run, provider } = await setup(script);
    j.permissions.grant(USER, JARVIS_PRINCIPAL, 'system.time.read');
    await run('bucle');
    expect(provider.calls).toHaveLength(MAX_STEPS);
    expect(of(events, 'done')[0]!.stopReason).toBe('max_steps');
  });

  it('el modo emergencia corta la respuesta en curso', async () => {
    const { j, events, run } = await setup([toolCall('t1', 'system.info')]);
    j.bus.on('approval.requested', () => setTimeout(() => j.permissions.setLockdown(USER, true), 5));
    await run('estado');
    expect(of(events, 'done')[0]!.stopReason).toBe('cancelled');
  });

  it('no admite dos respuestas a la vez en la misma conversación', async () => {
    let release!: () => void;
    const { j, run, events } = await setup([() => new Promise((r) => { release = () => r(text('a')); }), text('b')]);
    const first = run('uno');
    await new Promise((r) => setTimeout(r, 5));
    const conv = of(events, 'start')[0]!.conversationId;
    await expect(j.ai.engine.run({ message: 'dos', conversationId: conv }, () => {})).rejects.toThrow(/ya está respondiendo/);
    release();
    await first;
  });
});
