import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildTwiml, phoneConnector } from '../src/connectors/phone';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const SID = `AC${'a'.repeat(32)}`;
const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

function fakeTwilio() {
  const calls: { to: string; from: string; twiml: string }[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.includes('geocoding-api.open-meteo.com')) return Response.json({ results: [{ name: 'Nerja', admin1: 'Andalucía', country: 'España', latitude: 36.75, longitude: -3.87 }] });
    if (url.includes('api.open-meteo.com/v1/forecast')) return Response.json({ current: { temperature_2m: 17.4, apparent_temperature: 16.8, weather_code: 1, wind_speed_10m: 12 }, daily: { time: ['2026-11-27', '2026-11-28'], weather_code: [2, 61], temperature_2m_max: [20.2, 18], temperature_2m_min: [11.6, 10], precipitation_probability_max: [10, 70] } });
    const auth = (init.headers as Record<string, string>)?.authorization;
    if (auth !== `Basic ${Buffer.from(`${SID}:secreto`).toString('base64')}`) return Response.json({ message: 'Authenticate' }, { status: 401 });
    if (url.endsWith(`/Accounts/${SID}.json`)) return Response.json({ status: 'active', type: 'Trial', friendly_name: 'x' });
    if (url.endsWith(`/Accounts/${SID}/Calls.json`) && init.method === 'POST') {
      const p = new URLSearchParams(String(init.body));
      calls.push({ to: p.get('To')!, from: p.get('From')!, twiml: p.get('Twiml')! });
      return Response.json({ sid: `CA${calls.length}`, status: 'queued' }, { status: 201 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

async function setup(script: ConstructorParameters<typeof ScriptedProvider>[0] = []) {
  const t = fakeTwilio();
  const provider = new ScriptedProvider(script);
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: [phoneConnector()], fetch: t.f, providerFactory: () => provider });
  await j.start();
  running.push(j);
  j.connectors.configure(USER, 'phone', { accountSid: SID, authToken: 'secreto', from: '+15005550006', to: '600 111 222' });
  return { j, ...t, provider };
}

describe('Llamadas de teléfono (Twilio simulado)', () => {
  it('voz española, texto escapado y repetición', () => {
    const x = buildTwiml('Hola <Pablo> & compañía', 2);
    expect(x).toContain('<Say language="es-ES" voice="Polly.Sergio-Neural">Hola &lt;Pablo&gt; &amp; compañía</Say>');
    expect(x.match(/Hola &lt;Pablo/g)).toHaveLength(2);
  });

  it('solo llama al número del propietario, con límite diario; llamada de prueba; clave nunca expuesta', async () => {
    const { j, calls } = await setup();
    expect(await j.connectors.enable(USER, 'phone')).toEqual({ ok: true, detail: 'Twilio conectado (cuenta de prueba: solo puede llamar a números verificados)' });
    expect(await j.connectors.action(USER, 'phone', 'test_call', {})).toMatchObject({ sid: 'CA1', status: 'queued' });
    expect(calls[0]).toMatchObject({ to: '+34600111222', from: '+15005550006' });
    expect(calls[0]!.twiml).toContain('llamada de prueba');
    // La herramienta no tiene parámetro de destino: no puede llamar a otra persona.
    expect(await j.tools.invoke(USER, 'phone.call', { message: 'Hola', to: '+34611000000' } as object)).toMatchObject({ status: 'error' });
    for (let i = 0; i < 5; i++) expect((await j.tools.invoke(USER, 'phone.call', { message: `Aviso número ${i}` })).status).toBe('ok');
    expect(await j.tools.invoke(USER, 'phone.call', { message: 'Uno más' })).toMatchObject({ status: 'error', error: expect.stringContaining('Límite de 6') });
    expect(calls.every((c) => c.to === '+34600111222')).toBe(true);
    expect(JSON.stringify(j.connectors.list())).not.toContain('secreto');
  });

  it('alerta crítica → llamada (una cada 30 min); con «no» no llama', async () => {
    const { j, calls } = await setup();
    await j.connectors.enable(USER, 'phone');
    j.monitor.raise('prueba', 'critical', 'Ráfaga de acciones', 'detalle', false);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.twiml).toContain('Alerta de seguridad crítica: Ráfaga de acciones');
    j.monitor.raise('otra', 'critical', 'Otra', 'detalle', false);
    j.monitor.raise('aviso', 'warning', 'Aviso menor', 'detalle', false);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    j.connectors.configure(USER, 'phone', { alerts: 'no' });
  });

  it('buenos días a las 7:15: el tiempo (Open-Meteo) + llamada, sin pedir confirmación cada mañana', async () => {
    const { j, calls } = await setup([
      toolCall('w', 'weather.forecast', { place: 'Nerja' }),
      toolCall('c', 'phone.call', { message: 'Buenos días, Pablo. Hoy jueves en Nerja, casi despejado y hasta veinte grados. ¡A por el día!' }),
      text('Llamada hecha.'),
    ]);
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    await j.connectors.enable(USER, 'phone');
    const a = j.automations.create(USER, { name: 'Buenos días por teléfono', trigger: { type: 'daily', time: '07:15', days: [1, 2, 3, 4, 5, 6, 7] }, action: { mode: 'ai', instructions: 'Dame los buenos días por teléfono con el tiempo en Nerja', tools: ['weather.forecast', 'phone.call'] } });
    expect(j.automations.setEnabled(USER, a.id, true).grants).toEqual(expect.arrayContaining(['weather.read', 'connector.phone.call']));
    const next = new Date(j.automations.get(a.id)!.nextRunAt!);
    expect([next.getHours(), next.getMinutes()]).toEqual([7, 15]);
    await j.automations.tick(new Date(next.getTime() + 1000));
    await new Promise((r) => { const t = setInterval(() => { if (j.automations.get(a.id)!.lastRun?.status === 'ok') { clearInterval(t); r(null); } }, 20); });
    expect(j.tools.listApprovals('pending')).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.twiml).toContain('Buenos días, Pablo');
    const w = await j.tools.invoke(USER, 'weather.forecast', { place: 'Nerja' });
    expect(w).toMatchObject({ status: 'ok', output: { place: 'Nerja, Andalucía, España', now: { temp: 17, sky: 'casi despejado' }, tomorrow: { sky: 'lluvia débil', rainChance: 70 } } });
  });
});
