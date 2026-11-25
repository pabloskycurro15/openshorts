import { EnergyVad, parseWake } from './vad';
import { RecognitionFailure, type RecognitionHandlers, type SpeechRecognizer } from './types';

export const WHISPER_MODEL = 'onnx-community/whisper-base';
export const WHISPER_SIZE_MB = 80;

type ModelState = 'idle' | 'loading' | 'ready' | 'error';

/** Gestor del modelo Whisper en un worker (uno para toda la app). */
export class WhisperEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private readyPromise: Promise<void> | null = null;
  state: ModelState = 'idle';
  progress = 0;
  error: string | null = null;
  private listeners = new Set<() => void>();

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  get supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Descarga (la primera vez) y prepara el modelo. */
  load(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.state = 'loading';
    this.error = null;
    this.emit();
    this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; text?: string; message?: string; loaded?: number; total?: number };
        if (m.type === 'progress') {
          this.progress = m.total ? m.loaded! / m.total : 0;
          this.emit();
        } else if (m.type === 'ready') {
          this.state = 'ready';
          this.progress = 1;
          this.emit();
          resolve();
        } else if (m.type === 'result') {
          this.pending.get(m.id!)?.resolve(m.text ?? '');
          this.pending.delete(m.id!);
        } else if (m.type === 'error') {
          if (m.id !== undefined && this.pending.has(m.id)) {
            this.pending.get(m.id)!.reject(new Error(m.message));
            this.pending.delete(m.id);
          } else {
            this.state = 'error';
            this.error = m.message ?? 'Error desconocido';
            this.readyPromise = null;
            this.emit();
            reject(new Error(this.error));
          }
        }
      };
    });
    this.worker.postMessage({ type: 'load', model: WHISPER_MODEL });
    return this.readyPromise;
  }

  transcribe(audio: Float32Array, language = 'spanish'): Promise<string> {
    if (!this.worker || this.state !== 'ready') return Promise.reject(new Error('El modelo de voz local no está listo'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
    });
  }
}

export const whisper = new WhisperEngine();

/** Micrófono a 16 kHz mediante AudioWorklet. Devuelve una función para cerrarlo. */
async function openMic(onChunk: (c: Float32Array) => void): Promise<() => void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw new RecognitionFailure('not-allowed', 'Permiso de micrófono denegado o sin micrófono.');
  }
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/vad-worklet.js');
  // Política de reproducción automática: sin gesto previo el audio nace en pausa.
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => undefined);
    if (ctx.state === 'suspended') {
      const wake = () => { void ctx.resume(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
      window.addEventListener('pointerdown', wake);
      window.addEventListener('keydown', wake);
    }
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'jarvis-capture');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
  src.connect(node);
  return () => {
    node.port.onmessage = null;
    src.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

const LANG: Record<string, string> = { es: 'spanish', en: 'english', fr: 'french', de: 'german', it: 'italian', pt: 'portuguese', ca: 'catalan' };
const whisperLang = (bcp47: string) => LANG[bcp47.slice(0, 2).toLowerCase()] ?? 'spanish';

/** Reconocimiento 100 % local: micrófono → detector de voz → Whisper. */
export class LocalWhisperRecognizer implements SpeechRecognizer {
  readonly processor = 'Whisper en tu propio equipo (sin enviar audio)';
  private close: (() => void) | null = null;
  private finish: (() => void) | null = null;

  get supported() {
    return whisper.supported;
  }

  async listen(lang: string, h: RecognitionHandlers = {}): Promise<string> {
    await whisper.load();
    this.abort();
    const vad = new EnergyVad();
    let resolveSeg!: (a: Float32Array | null) => void;
    const segment = new Promise<Float32Array | null>((r) => (resolveSeg = r));
    let heard = false;
    const noSpeech = setTimeout(() => { if (!heard) resolveSeg(null); }, 8000);
    this.finish = () => resolveSeg(null);
    this.close = await openMic((c) => {
      const seg = vad.push(c);
      if (vad.isSpeaking && !heard) { heard = true; h.onPartial?.('Te escucho…'); }
      if (seg) resolveSeg(seg);
    });
    const audio = await segment;
    clearTimeout(noSpeech);
    this.close?.();
    this.close = null;
    if (!audio) return '';
    h.onPartial?.('Transcribiendo en local…');
    return whisper.transcribe(audio, whisperLang(lang));
  }

  stop() {
    this.finish?.();
  }

  abort() {
    this.close?.();
    this.close = null;
    this.finish?.();
  }
}

/**
 * Escucha continua de la palabra de activación, 100 % local. El detector de voz solo
 * despierta a Whisper cuando alguien habla; si la frase empieza por «Jarvis», avisa con
 * la orden que la siga (puede venir vacía).
 */
export class WakeWordListener {
  private close: (() => void) | null = null;
  private busy = false;
  paused = false;

  get active() {
    return !!this.close;
  }

  async start(lang: string, onWake: (command: string) => void, onHeard?: (text: string) => void) {
    if (this.close) return;
    await whisper.load();
    const vad = new EnergyVad({ maxSpeechMs: 8000 });
    this.close = await openMic((c) => {
      if (this.paused) { vad.reset(); return; }
      const seg = vad.push(c);
      if (!seg || this.busy) return;
      this.busy = true;
      whisper.transcribe(seg, whisperLang(lang))
        .then((text) => {
          onHeard?.(text);
          const w = parseWake(text);
          if (w.wake) onWake(w.command);
        })
        .catch(() => undefined)
        .finally(() => { this.busy = false; });
    });
  }

  stop() {
    this.close?.();
    this.close = null;
  }
}

/** Pitido de activación (dos tonos) para confirmar que JARVIS escucha. */
export function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, now + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.11);
      o.stop(now + i * 0.11 + 0.2);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch { /* sin audio */ }
}
