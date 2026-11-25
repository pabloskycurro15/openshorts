import type { ElevenLabsSettings, ElevenLabsVoice, Principal, VoiceStatus } from '@jarvis/shared';
import { ElevenLabsSettings as Schema } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { SecretVault } from '../security/vault';
import type { AuditLog } from '../security/audit';
import { monthStart } from '../ai/budget';

export const ELEVENLABS_KEY_SECRET = 'voice.elevenlabs.apiKey';
const SETTINGS_KEY = 'voice.elevenlabs';

/**
 * Por defecto: «Adam», voz masculina grave del catálogo público de ElevenLabs, con el
 * modelo multilingüe (habla español). El usuario puede elegir otra desde la interfaz.
 */
export const DEFAULT_ELEVENLABS: ElevenLabsSettings = {
  enabled: false,
  voiceId: 'pNInz6obpgDQGcFmaJgB',
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarity: 0.75,
};

export class VoiceServiceError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Síntesis de voz con ElevenLabs a través del núcleo: la clave vive cifrada en el
 * núcleo y el navegador nunca la ve. Servicio de pago: desactivado hasta que el
 * usuario lo active explícitamente.
 */
export class ElevenLabsService {
  constructor(
    private db: Database,
    private vault: SecretVault,
    private audit: AuditLog,
    private baseUrl = process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io',
    private fetchImpl: typeof fetch = fetch,
  ) {}

  getSettings(): ElevenLabsSettings {
    const raw = getSetting(this.db, SETTINGS_KEY);
    const parsed = Schema.safeParse({ ...DEFAULT_ELEVENLABS, ...(raw ? (JSON.parse(raw) as object) : {}) });
    return parsed.success ? parsed.data : { ...DEFAULT_ELEVENLABS };
  }

  updateSettings(by: Principal, patch: Partial<ElevenLabsSettings>): ElevenLabsSettings {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede cambiar la voz');
    const next = Schema.parse({ ...this.getSettings(), ...patch });
    if (next.enabled && !this.vault.has(ELEVENLABS_KEY_SECRET)) throw new VoiceServiceError('Añade primero la clave de ElevenLabs', 400);
    setSetting(this.db, SETTINGS_KEY, JSON.stringify(next));
    this.audit.append({ principal: by, action: 'voice.elevenlabs.settings', outcome: 'success', details: next });
    return next;
  }

  setKey(by: Principal, key: string): void {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede configurar credenciales');
    const k = key.trim();
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(k)) throw new VoiceServiceError('No parece una clave de ElevenLabs', 400);
    this.vault.set(ELEVENLABS_KEY_SECRET, k);
    this.audit.append({ principal: by, action: 'voice.elevenlabs.key.set', outcome: 'success', details: { suffix: k.slice(-4) } });
  }

  deleteKey(by: Principal): boolean {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede borrar credenciales');
    const ok = this.vault.delete(ELEVENLABS_KEY_SECRET);
    const s = this.getSettings();
    if (s.enabled) setSetting(this.db, SETTINGS_KEY, JSON.stringify({ ...s, enabled: false }));
    this.audit.append({ principal: by, action: 'voice.elevenlabs.key.delete', outcome: 'success' });
    return ok;
  }

  status(): VoiceStatus {
    const r = this.db.prepare("SELECT COALESCE(SUM(chars), 0) AS c FROM voice_usage WHERE provider = 'elevenlabs' AND ts >= ?").get(monthStart()) as { c: number };
    return { elevenlabs: { configured: this.vault.has(ELEVENLABS_KEY_SECRET), settings: this.getSettings(), charsMonth: r.c } };
  }

  private key(): string {
    const k = this.vault.get(ELEVENLABS_KEY_SECRET);
    if (!k) throw new VoiceServiceError('ElevenLabs no está configurado', 409);
    return k;
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), 'xi-api-key': this.key() } });
    } catch (err) {
      if (err instanceof VoiceServiceError) throw err;
      throw new VoiceServiceError('No hay conexión con ElevenLabs', 502);
    }
    if (res.status === 401) throw new VoiceServiceError('La clave de ElevenLabs no es válida', 401);
    if (res.status === 429) throw new VoiceServiceError('ElevenLabs: límite de uso o de caracteres alcanzado', 429);
    if (!res.ok) throw new VoiceServiceError(`ElevenLabs respondió con error ${res.status}`, 502);
    return res;
  }

  async voices(): Promise<ElevenLabsVoice[]> {
    const res = await this.call('/v1/voices', { method: 'GET' });
    const body = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return (body.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name, labels: v.labels ?? {} }));
  }

  /** Convierte texto en audio MP3. Solo si el usuario ha activado el servicio. */
  async synthesize(text: string): Promise<Buffer> {
    const s = this.getSettings();
    if (!s.enabled) throw new VoiceServiceError('La voz de ElevenLabs está desactivada', 409);
    const res = await this.call(`/v1/text-to-speech/${encodeURIComponent(s.voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: s.modelId, voice_settings: { stability: s.stability, similarity_boost: s.similarity } }),
    });
    const audio = Buffer.from(await res.arrayBuffer());
    this.db.prepare('INSERT INTO voice_usage (ts, provider, chars) VALUES (?, ?, ?)').run(new Date().toISOString(), 'elevenlabs', text.length);
    return audio;
  }
}
