import type { FastifyInstance, FastifyReply } from 'fastify';
import { ElevenLabsSettings, TtsRequest, VoiceEventRequest, type Principal } from '@jarvis/shared';
import { z } from 'zod';
import type { Jarvis } from '../app';
import { VoiceServiceError } from '../voice/elevenlabs';

const USER: Principal = { kind: 'user', id: 'owner' };

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof VoiceServiceError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

/** Rutas de voz. El micrófono y el reconocimiento viven en el cliente; aquí se registran y se sirve la voz premium. */
export function registerVoiceRoutes(app: FastifyInstance, j: Jarvis) {
  app.get('/api/voice/status', async () => j.voice.status());

  /** Registro de uso del micrófono (requisito: trazabilidad de permisos de sensores). */
  app.post('/api/voice/event', async (req) => {
    const { event, processor } = VoiceEventRequest.parse(req.body);
    j.audit.append({ principal: USER, action: `voice.${event}`, outcome: 'success', details: processor ? { processor } : null });
    return { ok: true };
  });

  app.put('/api/voice/elevenlabs/key', async (req, reply) => {
    const { apiKey } = z.object({ apiKey: z.string().min(1).max(200) }).parse(req.body);
    try {
      j.voice.setKey(USER, apiKey);
      return { configured: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.delete('/api/voice/elevenlabs/key', async () => ({ deleted: j.voice.deleteKey(USER) }));

  app.put('/api/voice/elevenlabs/settings', async (req, reply) => {
    try {
      return j.voice.updateSettings(USER, ElevenLabsSettings.partial().parse(req.body));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/voice/elevenlabs/voices', async (_req, reply) => {
    try {
      return await j.voice.voices();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/voice/tts', async (req, reply) => {
    const { text } = TtsRequest.parse(req.body);
    try {
      const audio = await j.voice.synthesize(text);
      return reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').send(audio);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
