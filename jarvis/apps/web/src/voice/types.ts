/** Contratos de voz intercambiables (Web Speech hoy; Whisper/ElevenLabs/openWakeWord después). */

export interface RecognitionHandlers {
  onPartial?: (text: string) => void;
}

export type RecognitionError = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | 'aborted' | 'other';

export interface SpeechRecognizer {
  readonly supported: boolean;
  /** Quién procesa el audio (se muestra al usuario y se audita). */
  readonly processor: string;
  /** Escucha una intervención y devuelve el texto final ('' si no se dijo nada). */
  listen(lang: string, h?: RecognitionHandlers): Promise<string>;
  stop(): void;
  abort(): void;
}

export interface SpeakOptions {
  voiceURI?: string;
  rate: number;
  pitch: number;
  volume: number;
  lang: string;
}

export interface SpeechSynthesizer {
  readonly supported: boolean;
  readonly id: 'system' | 'elevenlabs';
  /** Encola una frase. */
  enqueue(text: string, opts: SpeakOptions): void;
  cancel(): void;
  /** Se resuelve cuando la cola se vacía. */
  whenIdle(): Promise<void>;
  onSpeakingChange(cb: (speaking: boolean) => void): () => void;
}

export class RecognitionFailure extends Error {
  constructor(public code: RecognitionError, message: string) {
    super(message);
  }
}
