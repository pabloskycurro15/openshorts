import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createJarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { buildServer } from '../src/server/http';
import { tmpDir } from './helpers';

const TOKEN = 'c'.repeat(43);
const auth = { authorization: `Bearer ${TOKEN}` };
const KEY = 'sk_elevenlabsSECRETO1234567890abcdef';
let app: FastifyInstance | undefined;
let fake: http.Server | undefined;
afterEach(async () => { await app?.close(); fake?.close(); app = undefined; });

/** Imita la API de ElevenLabs (voces y texto a voz). */
async function fakeElevenLabs() {
  const calls: { url: string; key: string | undefined; body: string }[] = [];
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ url: req.url ?? '', key: req.headers['xi-api-key'] as string | undefined, body });
      if (req.headers['xi-api-key'] !== KEY) { res.writeHead(401); return res.end('{}'); }
      if (req.url === '/v1/voices') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ voices: [{ voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', labels: { gender: 'male', description: 'deep' } }] }));
      }
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]));
    });
  });
  await new Promise<void>((r) => fake!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(fake!.address() as { port: number }).port}`, calls };
}

async function setup(voiceBaseUrl?: string) {
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', voiceBaseUrl });
  await j.start();
  app = await buildServer(j, TOKEN);
  return { j, app };
}

describe('Voz', () => {
  it('el uso del micrófono queda auditado', async () => {
    const { app, j } = await setup();
    await app.inject({ method: 'POST', url: '/api/voice/event', headers: auth, payload: { event: 'mic_on', processor: 'navegador (Google)' } });
    await app.inject({ method: 'POST', url: '/api/voice/event', headers: auth, payload: { event: 'mic_off' } });
    expect(j.audit.list().slice(0, 2).map((e) => e.action)).toEqual(['voice.mic_off', 'voice.mic_on']);
    expect((await app.inject({ method: 'POST', url: '/api/voice/event', headers: auth, payload: { event: 'espiar' } })).statusCode).toBe(400);
  });

  it('ElevenLabs desactivado por defecto; no se puede activar sin clave', async () => {
    const { app } = await setup();
    const s = (await app.inject({ url: '/api/voice/status', headers: auth })).json();
    expect(s.elevenlabs).toMatchObject({ configured: false, charsMonth: 0, settings: { enabled: false, voiceId: 'pNInz6obpgDQGcFmaJgB', modelId: 'eleven_multilingual_v2' } });
    expect((await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/settings', headers: auth, payload: { enabled: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/voice/tts', headers: auth, payload: { text: 'hola' } })).statusCode).toBe(409);
  });

  it('con clave: lista voces, sintetiza audio, cuenta caracteres y nunca devuelve la clave', async () => {
    const fakeApi = await fakeElevenLabs();
    const { app } = await setup(fakeApi.url);
    expect((await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/key', headers: auth, payload: { apiKey: 'mala clave!' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/key', headers: auth, payload: { apiKey: KEY } })).json()).toEqual({ configured: true });

    const voices = (await app.inject({ url: '/api/voice/elevenlabs/voices', headers: auth })).json();
    expect(voices).toEqual([{ voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', labels: { gender: 'male', description: 'deep' } }]);

    // Desactivado: aún no sintetiza (no hay gasto sin activación explícita).
    expect((await app.inject({ method: 'POST', url: '/api/voice/tts', headers: auth, payload: { text: 'hola' } })).statusCode).toBe(409);
    await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/settings', headers: auth, payload: { enabled: true, stability: 0.4 } });
    const tts = await app.inject({ method: 'POST', url: '/api/voice/tts', headers: auth, payload: { text: 'Buenas tardes, señor.' } });
    expect(tts.statusCode).toBe(200);
    expect(tts.headers['content-type']).toBe('audio/mpeg');
    expect(tts.rawPayload.subarray(0, 3).toString()).toBe('ID3');

    const call = fakeApi.calls.find((c) => c.url.startsWith('/v1/text-to-speech/'))!;
    expect(call.url).toBe('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB?output_format=mp3_44100_128');
    expect(JSON.parse(call.body)).toEqual({ text: 'Buenas tardes, señor.', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.75 } });

    const status = await app.inject({ url: '/api/voice/status', headers: auth });
    expect(status.json().elevenlabs.charsMonth).toBe('Buenas tardes, señor.'.length);
    for (const url of ['/api/voice/status', '/api/audit?limit=200']) expect((await app.inject({ url, headers: auth })).body).not.toContain('SECRETO');
  });

  it('borrar la clave desactiva el servicio', async () => {
    const fakeApi = await fakeElevenLabs();
    const { app } = await setup(fakeApi.url);
    await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/key', headers: auth, payload: { apiKey: KEY } });
    await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/settings', headers: auth, payload: { enabled: true } });
    await app.inject({ method: 'DELETE', url: '/api/voice/elevenlabs/key', headers: auth });
    expect((await app.inject({ url: '/api/voice/status', headers: auth })).json().elevenlabs).toMatchObject({ configured: false, settings: { enabled: false } });
  });

  it('clave rechazada por ElevenLabs → error claro', async () => {
    const fakeApi = await fakeElevenLabs();
    const { app } = await setup(fakeApi.url);
    await app.inject({ method: 'PUT', url: '/api/voice/elevenlabs/key', headers: auth, payload: { apiKey: 'otraClaveQueNoEsLaBuena1234' } });
    const r = await app.inject({ url: '/api/voice/elevenlabs/voices', headers: auth });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toMatch(/no es válida/);
  });
});
