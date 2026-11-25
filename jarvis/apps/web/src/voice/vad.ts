/**
 * Detector de actividad de voz por energía con suelo de ruido adaptativo.
 * Recibe bloques de 100 ms a 16 kHz y devuelve frases completas (con un poco de
 * margen antes y después). Sencillo, sin modelos y sin coste: decide cuándo merece
 * la pena despertar a Whisper.
 */
export interface VadOptions {
  sampleRate: number;
  /** Silencio que cierra una frase (ms). */
  hangoverMs: number;
  /** Duración mínima de una frase (ms). */
  minSpeechMs: number;
  /** Duración máxima de una frase (ms). */
  maxSpeechMs: number;
  /** Margen previo conservado (ms). */
  preRollMs: number;
  /** Energía mínima absoluta para considerar voz. */
  minRms: number;
  /** Cuántas veces el ruido de fondo debe superar la voz. */
  ratio: number;
}

export const DEFAULT_VAD: VadOptions = { sampleRate: 16000, hangoverMs: 700, minSpeechMs: 300, maxSpeechMs: 12000, preRollMs: 300, minRms: 0.008, ratio: 3 };

export function rms(chunk: Float32Array): number {
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i]! * chunk[i]!;
  return Math.sqrt(s / Math.max(1, chunk.length));
}

export class EnergyVad {
  private o: VadOptions;
  private floor = 0.004;
  private pre: Float32Array[] = [];
  private seg: Float32Array[] = [];
  private speaking = false;
  private silentMs = 0;
  private voicedMs = 0;
  private chunkMs = 100;

  constructor(opts: Partial<VadOptions> = {}) {
    this.o = { ...DEFAULT_VAD, ...opts };
  }

  get isSpeaking() {
    return this.speaking;
  }

  /** Procesa un bloque. Devuelve una frase completa cuando termina, o null. */
  push(chunk: Float32Array): Float32Array | null {
    this.chunkMs = (chunk.length / this.o.sampleRate) * 1000;
    const e = rms(chunk);
    const voiced = e > Math.max(this.o.minRms, this.floor * this.o.ratio);
    // Suelo de ruido: baja rápido con el silencio y sube despacio siempre, de modo que un
    // ruido constante (ventilador, aire acondicionado) acaba dejando de contar como voz.
    this.floor = e < this.floor ? this.floor * 0.7 + e * 0.3 : this.floor * 0.985 + e * 0.015;
    if (!this.speaking) {
      this.pre.push(chunk);
      const maxPre = Math.ceil(this.o.preRollMs / this.chunkMs);
      while (this.pre.length > maxPre) this.pre.shift();
      if (voiced) {
        this.speaking = true;
        this.seg = [...this.pre];
        this.pre = [];
        this.silentMs = 0;
        this.voicedMs = this.chunkMs;
      }
      return null;
    }
    this.seg.push(chunk);
    if (voiced) {
      this.silentMs = 0;
      this.voicedMs += this.chunkMs;
    } else {
      this.silentMs += this.chunkMs;
    }
    const total = this.seg.length * this.chunkMs;
    if (this.silentMs >= this.o.hangoverMs || total >= this.o.maxSpeechMs) {
      const out = this.voicedMs >= this.o.minSpeechMs ? concat(this.seg) : null;
      this.reset();
      return out;
    }
    return null;
  }

  reset() {
    this.speaking = false;
    this.seg = [];
    this.pre = [];
    this.silentMs = 0;
    this.voicedMs = 0;
  }
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * ¿La frase empieza por la palabra de activación? Admite las variantes con las que
 * Whisper suele transcribir «Jarvis» en español. Devuelve la orden que siga, si la hay.
 */
const WAKE = /^\s*[¡¿"'«(]*\s*(?:oye|hola|eh|ey|hey)?[\s,]*(jarvis|yarvis|harvis|charvis|jarbis|yarbis|jarvi|yarvi|járvis|yárvis|chavis|jervis|garvis)\b[\s,.:;!¡?¿-]*/i;

export function parseWake(text: string): { wake: boolean; command: string } {
  const m = WAKE.exec(text);
  if (!m) return { wake: false, command: '' };
  return { wake: true, command: text.slice(m[0].length).replace(/^[\s,.:;!¡?¿-]+/, '').trim() };
}
