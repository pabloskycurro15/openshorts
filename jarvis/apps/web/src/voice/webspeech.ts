import { RecognitionFailure, type RecognitionHandlers, type SpeakOptions, type SpeechRecognizer, type SpeechSynthesizer } from './types';

// Tipos mínimos de la Web Speech API (no están en lib.dom de TypeScript).
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function recognitionCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function browserVendor(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'servicio de voz de Microsoft (Edge)';
  if (/Chrome\//.test(ua)) return 'servicio de voz de Google (Chrome)';
  if (/Safari\//.test(ua)) return 'servicio de voz de Apple (Safari)';
  return 'servicio de voz del navegador';
}

const ERRORS: Record<string, [RecognitionFailure['code'], string]> = {
  'not-allowed': ['not-allowed', 'Permiso de micrófono denegado. Actívalo en la configuración del navegador.'],
  'service-not-allowed': ['not-allowed', 'El navegador no permite el reconocimiento de voz en esta página.'],
  'audio-capture': ['not-allowed', 'No se encuentra ningún micrófono.'],
  network: ['network', 'El servicio de reconocimiento de voz del navegador no está disponible (¿sin Internet?).'],
  'no-speech': ['no-speech', 'No he oído nada.'],
  aborted: ['aborted', 'Escucha cancelada.'],
};

/** Reconocimiento con la Web Speech API. OJO: el navegador envía el audio a su servicio en la nube. */
export class WebSpeechRecognizer implements SpeechRecognizer {
  private rec: SR | null = null;
  get supported() {
    return !!recognitionCtor();
  }
  get processor() {
    return browserVendor();
  }

  listen(lang: string, h: RecognitionHandlers = {}): Promise<string> {
    const Ctor = recognitionCtor();
    if (!Ctor) return Promise.reject(new RecognitionFailure('unsupported', 'Este navegador no admite reconocimiento de voz. Prueba con Chrome o Edge.'));
    this.abort();
    const rec = new Ctor();
    this.rec = rec;
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let failure: RecognitionFailure | null = null;
    return new Promise((resolve, reject) => {
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        h.onPartial?.((finalText + interim).trim());
      };
      rec.onerror = (e) => {
        const [code, msg] = ERRORS[e.error] ?? ['other', `Error de reconocimiento: ${e.error}`];
        if (code !== 'no-speech' && code !== 'aborted') failure = new RecognitionFailure(code, msg);
      };
      rec.onend = () => {
        if (this.rec === rec) this.rec = null;
        if (failure) reject(failure);
        else resolve(finalText.trim());
      };
      try {
        rec.start();
      } catch (err) {
        reject(new RecognitionFailure('other', err instanceof Error ? err.message : String(err)));
      }
    });
  }

  stop() {
    this.rec?.stop();
  }
  abort() {
    this.rec?.abort();
    this.rec = null;
  }
}

/** Síntesis con las voces instaladas en el sistema / navegador. */
export class WebSpeechSynthesizer implements SpeechSynthesizer {
  readonly id = 'system' as const;
  private pending = 0;
  private listeners = new Set<(s: boolean) => void>();
  private idleWaiters: (() => void)[] = [];

  get supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  enqueue(text: string, o: SpeakOptions) {
    if (!this.supported || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = o.lang;
    u.rate = o.rate;
    u.pitch = o.pitch;
    u.volume = o.volume;
    const voice = o.voiceURI ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === o.voiceURI) : undefined;
    if (voice) u.voice = voice;
    const done = () => this.dec();
    u.onend = done;
    u.onerror = done;
    this.inc();
    window.speechSynthesis.speak(u);
  }

  cancel() {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    this.pending = 0;
    this.emit(false);
    this.flushIdle();
  }

  whenIdle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  onSpeakingChange(cb: (s: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private inc() {
    if (this.pending++ === 0) this.emit(true);
  }
  private dec() {
    if (this.pending === 0) return;
    if (--this.pending === 0) {
      this.emit(false);
      this.flushIdle();
    }
  }
  private emit(s: boolean) {
    for (const l of this.listeners) l(s);
  }
  private flushIdle() {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((r) => r());
  }
}

export function systemVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

const MALE_HINTS = /(pablo|alvaro|álvaro|jorge|diego|enrique|raul|raúl|carlos|juan|miguel|male|hombre|masculin)/i;

/** Elige la mejor voz por defecto: español de España, preferiblemente masculina y natural. */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const es = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('es-es'));
  const pool = es.length ? es : voices.filter((v) => v.lang.toLowerCase().startsWith('es'));
  const score = (v: SpeechSynthesisVoice) => (MALE_HINTS.test(v.name) ? 2 : 0) + (/natural|neural|online/i.test(v.name) ? 1 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}
