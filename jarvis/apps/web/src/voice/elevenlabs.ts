import type { SpeakOptions, SpeechSynthesizer } from './types';
import { readStore } from '../lib/storage';

/**
 * Voz premium de ElevenLabs, servida por el núcleo (la clave nunca llega al navegador).
 * Pide el audio de cada frase en cuanto se encola y las reproduce en orden.
 */
export class ElevenLabsSynthesizer implements SpeechSynthesizer {
  readonly id = 'elevenlabs' as const;
  readonly supported = typeof Audio !== 'undefined';
  private queue: Promise<Blob | null>[] = [];
  private playing = false;
  private current: HTMLAudioElement | null = null;
  private generation = 0;
  private listeners = new Set<(s: boolean) => void>();
  private idleWaiters: (() => void)[] = [];
  onError?: (msg: string) => void;

  enqueue(text: string, o: SpeakOptions) {
    if (!text) return;
    const token = readStore<string | null>('jarvis.token', null);
    const gen = this.generation;
    this.queue.push(
      fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`);
          return r.blob();
        })
        .catch((e: Error) => {
          if (gen === this.generation) this.onError?.(e.message);
          return null;
        }),
    );
    this.volume = o.volume;
    if (!this.playing) void this.pump();
  }

  private volume = 1;

  private async pump() {
    this.playing = true;
    this.emit(true);
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const blob = await this.queue.shift()!;
      if (!blob || gen !== this.generation) continue;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = this.volume;
      this.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    }
    if (gen === this.generation) this.finish();
  }

  private finish() {
    this.playing = false;
    this.current = null;
    this.emit(false);
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((r) => r());
  }

  cancel() {
    this.generation++;
    this.queue = [];
    this.current?.pause();
    this.finish();
  }

  whenIdle() {
    return this.playing ? new Promise<void>((r) => this.idleWaiters.push(r)) : Promise.resolve();
  }

  onSpeakingChange(cb: (s: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(s: boolean) {
    for (const l of this.listeners) l(s);
  }
}
