import { vi } from 'vitest';

// ── Dobles de la Web Speech API ──
export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.onerror?.({ error: 'aborted' }); this.onend?.(); }
  say(parts: { text: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

export function installFakeSynthesis() {
  const spoken: { text: string; rate: number; pitch: number; lang: string }[] = [];
  let queue: { onend?: () => void }[] = [];
  const synth = {
    speak: (u: SpeechSynthesisUtterance & { onend?: () => void }) => { spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, lang: u.lang }); queue.push(u); },
    cancel: () => { queue = []; },
    getVoices: () => [] as SpeechSynthesisVoice[],
    addEventListener: () => {}, removeEventListener: () => {},
    finishAll: () => { const q = queue; queue = []; q.forEach((u) => u.onend?.()); },
  };
  class Utt { text: string; lang = ''; rate = 1; pitch = 1; volume = 1; voice: unknown = null; onend?: () => void; onerror?: () => void; constructor(t: string) { this.text = t; } }
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utt);
  return { spoken, synth };
}

