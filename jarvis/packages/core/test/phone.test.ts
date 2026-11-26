import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildTwiml, phoneConnector, speakable, twilioSignature } from '../src/connectors/phone';
import { buildServer } from '../src/server/http';
import { ScriptedProvider, text, toolCall } from './fakes';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const SID = `AC${'a'.repeat(32)}`;
const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

function fakeTwilio() {
  const calls: { to: string; from: string; twiml: string | null; url?: string | null }[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.includes('geocoding-api.open-meteo.com')) return Response.json({ results: [{ name: 'Nerja', admin1: 'Andalucía', country: 'España', latitude: 36.75, longitude: -3.87 }] });
    if (url.includes('api.open-meteo.com/v1/forecast')) return Response.json({ current: { temperature_2m: 17.4, apparent_temperature: 16.8, weather_code: 1, wind_speed_10m: 12 }, daily: { time: ['2026-11-27', '2026-11-28'], weather_code: [2, 61], temperature_2m_max: [20.2, 18], temperature_2m_min: [11.6, 10], precipitation_probability_max: [10, 70] } });
    const auth = (init.headers as Record<string, string>)?.authorization;
    if (auth !== `Basic ${Buffer.from(`${SID}:secreto`).toString('base64')}`) return Response.json({ message: 'Authenticate' }, { status: 401 });
    if (url.endsWith(`/Accounts/${SID}.json`)) return Response.json({ status: 'active', type: 'Trial', friendly_name: 'x' });
    if (url.endsWith(`/Accounts/${SID}/Calls.json`) && init.method === 'POST') {
      const p = new URLSearchParams(String(init.body));
      calls.push({ to: p.get('To')!, from: p.get('From')!, twiml: p.get('Twiml'), url: p.get('Url') });
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
    expect(x).toContain('<Say voice="Polly.Sergio-Neural" language="es-ES">Hola &lt;Pablo&gt; &amp; compañía</Say>');
    expect(x.match(/Hola &lt;Pablo/g)).toHaveLength(2);
  });

  it('solo llama al número del propietario, con límite diario; llamada de prueba; clave nunca expuesta', async () => {
    const { j, calls } = await setup();
    expect(await j.connectors.enable(USER, 'phone')).toEqual({ ok: true, detail: 'Twilio conectado (cuenta de prueba) · solo mensajes: añade la dirección pública para conversar' });
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

  it('conversación por teléfono: firma de Twilio, solo tu número, PIN, respuesta de JARVIS, espera y despedida', async () => {
    const t = fakeTwilio();
    const provider = new (await import('./fakes')).ScriptedProvider([
      text('Hoy tienes **dos** reuniones:\n- A las 10 con Ana\n- A las 12 con Juan'),
      async () => { await new Promise((r) => setTimeout(r, 7500)); return text('Listo, ya está.'); },
    ]);
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, fetch: t.f, providerFactory: () => provider });
    await j.start();
    running.push(j);
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    const PUB = 'https://mi-pc.tail1234.ts.net';
    j.connectors.configure(USER, 'phone', { accountSid: SID, authToken: 'secreto', from: '+15005550006', to: '600 111 222', publicUrl: PUB, pin: '4321' });
    expect(await j.connectors.enable(USER, 'phone')).toMatchObject({ ok: true, detail: expect.stringContaining('modo conversación') });
    const app = await buildServer(j, 'z'.repeat(43));
    const post = (path: string, params: Record<string, string>, sign = true) => app.inject({
      method: 'POST', url: path, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sign ? { 'x-twilio-signature': twilioSignature('secreto', PUB + path, params) } : {}) },
      payload: new URLSearchParams(params).toString(),
    });
    const base = { AccountSid: SID, CallSid: 'CA9', To: '+15005550006' };

    expect((await post('/phone/voice', { ...base, From: '+34600111222', Direction: 'inbound' }, false)).statusCode).toBe(403);
    expect((await post('/phone/voice', { ...base, From: '+34611999999', Direction: 'inbound' })).body).toContain('<Reject');
    const v = await post('/phone/voice', { ...base, From: '+34600111222', Direction: 'inbound' });
    expect(v.body).toContain('Marca tu PIN');
    expect((await post('/phone/gather', { ...base, SpeechResult: 'borra todo' })).body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    expect((await post('/phone/pin', { ...base, Digits: '0000' })).body).toContain('PIN incorrecto');
    const okPin = await post('/phone/pin', { ...base, Digits: '4321' });
    expect(okPin.body).toContain('¿en qué te ayudo?');
    expect(okPin.body).toContain(`action="${PUB}/phone/gather"`);

    const g = await post('/phone/gather', { ...base, SpeechResult: '¿Qué tengo hoy?' });
    expect(g.body).toContain('Hoy tienes dos reuniones: A las 10 con Ana A las 12 con Juan');
    expect(g.body).toContain('<Gather input="speech" language="es-ES"');
    expect(JSON.stringify(provider.calls[0]!.messages)).toContain('Llamada de voz');

    // Respuesta lenta: Twilio no puede esperar más de 15 s → «Un momento» y se redirige a la espera.
    const slow = await post('/phone/gather', { ...base, SpeechResult: 'Haz una cosa larga' });
    expect(slow.body).toContain(`<Redirect method="POST">${PUB}/phone/wait</Redirect>`);
    const done = await post('/phone/wait', base);
    expect(done.body).toContain('Listo, ya está.');

    expect((await post('/phone/gather', { ...base, SpeechResult: '' })).body).toContain('¿Sigues ahí?');
    expect((await post('/phone/gather', { ...base, SpeechResult: 'Nada más, adiós' })).body).toContain('<Hangup/>');
    await app.close();

    // Saliente con dirección pública → conversación (Url en lugar de un mensaje fijo).
    await j.tools.invoke(USER, 'phone.call', { message: 'Buenos días' });
    const call = t.calls.at(-1)!;
    expect(call.twiml).toBeNull();
    expect(speakable('Mira [esto](https://x.com) y **aquello**')).toBe('Mira esto y aquello');
  }, 30_000);

  it('por teléfono, lo que necesita confirmación queda pendiente en la app y la llamada sigue', async () => {
    const t = fakeTwilio();
    const provider = new (await import('./fakes')).ScriptedProvider([
      toolCall('n', 'notify.send', { title: 'Recordatorio', body: 'Comprar pan' }),
      text('Te lo he dejado pendiente de confirmar en la app.'),
    ]);
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, fetch: t.f, providerFactory: () => provider });
    await j.start();
    running.push(j);
    j.ai.setApiKey(USER, 'sk-ant-api03-PRUEBA-0000000000000000');
    const PUB = 'https://pc.ts.net:8443';
    j.connectors.configure(USER, 'phone', { accountSid: SID, authToken: 'secreto', from: '+15005550006', to: '600111222', publicUrl: PUB });
    await j.connectors.enable(USER, 'phone');
    const app = await buildServer(j, 'z'.repeat(43));
    const post = (path: string, params: Record<string, string>) => app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature('secreto', PUB + path, params) }, payload: new URLSearchParams(params).toString() });
    const base = { AccountSid: SID, CallSid: 'CA7', From: '+34600111222', To: '+15005550006', Direction: 'inbound' };
    await post('/phone/voice', base);
    let r = (await post('/phone/gather', { ...base, SpeechResult: 'Recuérdame comprar pan' })).body;
    while (r.includes('/phone/wait')) r = (await post('/phone/wait', base)).body;
    expect(r).toContain('Te lo he dejado pendiente de confirmar en la app.');
    expect(j.tools.listApprovals('pending')).toHaveLength(1);
    expect(JSON.stringify(provider.calls[1]!.messages)).toContain('Queda pendiente de la confirmación del usuario');
    await app.close();
  }, 30_000);
});
