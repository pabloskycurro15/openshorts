import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssistantState } from '@jarvis/shared';
import { readStore, writeStore } from '../lib/storage';
import { useConnection } from '../lib/connection';
import { core } from '../lib/api';
import { SentenceChunker, speakableText } from './text';
import { RecognitionFailure, type SpeechSynthesizer } from './types';
import { WebSpeechRecognizer, WebSpeechSynthesizer, pickDefaultVoice, systemVoices } from './webspeech';
import { ElevenLabsSynthesizer } from './elevenlabs';
import { LocalWhisperRecognizer, WakeWordListener, chime, whisper, WHISPER_SIZE_MB } from './local';
import { desktop } from '../lib/desktop';

export interface VoiceSettings {
  engine: 'system' | 'elevenlabs';
  /** Reconocimiento: servicio del navegador (nube) o Whisper local (privado). */
  recognition: 'browser' | 'local';
  /** Palabra de activación «Jarvis» (solo con reconocimiento local). */
  wakeWord: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
  lang: string;
  /** Cuándo responder hablando: solo si se habló, siempre o nunca. */
  replyMode: 'voice' | 'always' | 'never';
  /** Enviar en cuanto se termina de hablar (si no, el texto queda para revisarlo). */
  autoSend: boolean;
  /** Manos libres: tras cada respuesta hablada vuelve a escuchar. */
  handsFree: boolean;
  readNotifications: boolean;
  /** Modo discreto: silencia toda la voz. */
  muted: boolean;
}

export const DEFAULT_VOICE: VoiceSettings = {
  engine: 'system',
  recognition: 'browser',
  wakeWord: false, voiceURI: null, rate: 1, pitch: 0.85, volume: 1, lang: 'es-ES',
  replyMode: 'voice', autoSend: true, handsFree: false, readNotifications: false, muted: false,
};
const KEY = 'jarvis.voice';

export interface ModelInfo { state: 'idle' | 'loading' | 'ready' | 'error'; progress: number; error: string | null; sizeMb: number }

interface VoiceApi {
  model: ModelInfo;
  loadModel: () => Promise<void>;
  /** Escucha local de la palabra de activación en marcha. */
  wakeActive: boolean;
  lastHeard: string;
  /** Suscribirse a activaciones («Jarvis, …»). Devuelve la función para anular. */
  onWake: (cb: (command: string) => void) => () => void;
  /** Recoge una activación que llegó sin nadie escuchando (p. ej. desde otra sección). */
  takePendingWake: () => string | null;
  settings: VoiceSettings;
  update: (p: Partial<VoiceSettings>) => void;
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  /** Quién procesa el audio del micrófono. */
  processor: string;
  listening: boolean;
  speaking: boolean;
  partial: string;
  error: string | null;
  clearError: () => void;
  /** Escucha una intervención. Interrumpe cualquier respuesta hablada. */
  listen: () => Promise<string>;
  stopListening: () => void;
  /** Respuesta hablada en streaming. */
  beginReply: () => void;
  feed: (delta: string) => void;
  endReply: () => void;
  say: (text: string) => void;
  cancelSpeech: () => void;
  whenIdle: () => Promise<void>;
}

const Ctx = createContext<VoiceApi | null>(null);

export function VoiceProvider({ children, recognizer: injectedRec }: { children: ReactNode; recognizer?: WebSpeechRecognizer }) {
  const [settings, setSettings] = useState<VoiceSettings>(() => ({
    ...DEFAULT_VOICE,
    // En la app de escritorio no existe el servicio del navegador: Whisper local por defecto.
    ...(desktop() ? { recognition: 'local' as const } : {}),
    ...readStore<Partial<VoiceSettings>>(KEY, {}),
  }));
  const [model, setModel] = useState<ModelInfo>({ state: whisper.state, progress: whisper.progress, error: whisper.error, sizeMb: WHISPER_SIZE_MB });
  const [wakeActive, setWakeActive] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const wakeSubs = useRef(new Set<(c: string) => void>());
  const pendingWake = useRef<string | null>(null);
  const wake = useMemo(() => new WakeWordListener(), []);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { feed: events } = useConnection();

  const browserRec = useMemo(() => injectedRec ?? new WebSpeechRecognizer(), [injectedRec]);
  const localRec = useMemo(() => new LocalWhisperRecognizer(), []);
  const rec = settings.recognition === 'local' ? localRec : browserRec;

  useEffect(() => { const off = whisper.onChange(() => setModel({ state: whisper.state, progress: whisper.progress, error: whisper.error, sizeMb: WHISPER_SIZE_MB })); return () => { off(); }; }, []);
  const system = useMemo(() => new WebSpeechSynthesizer(), []);
  const eleven = useMemo(() => new ElevenLabsSynthesizer(), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const chunker = useRef(new SentenceChunker());
  const replying = useRef(false);

  useEffect(() => writeStore(KEY, settings), [settings]);

  // Elegir voz por defecto cuando el sistema cargue sus voces.
  useEffect(() => {
    if (!system.supported || settings.voiceURI) return;
    const choose = () => {
      const v = pickDefaultVoice(systemVoices());
      if (v) setSettings((s) => (s.voiceURI ? s : { ...s, voiceURI: v.voiceURI }));
    };
    choose();
    window.speechSynthesis.addEventListener?.('voiceschanged', choose);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', choose);
  }, [system, settings.voiceURI]);

  useEffect(() => {
    const a = system.onSpeakingChange(setSpeaking);
    const b = eleven.onSpeakingChange(setSpeaking);
    eleven.onError = (m) => setError(`Voz de ElevenLabs: ${m}`);
    return () => { a(); b(); };
  }, [system, eleven]);

  const synth = useCallback((): SpeechSynthesizer => (settingsRef.current.engine === 'elevenlabs' ? eleven : system), [eleven, system]);
  const opts = () => {
    const s = settingsRef.current;
    return { voiceURI: s.voiceURI ?? undefined, rate: s.rate, pitch: s.pitch, volume: s.volume, lang: s.lang };
  };

  const cancelSpeech = useCallback(() => {
    system.cancel();
    eleven.cancel();
    chunker.current = new SentenceChunker();
    replying.current = false;
  }, [system, eleven]);

  const say = useCallback((text: string) => {
    if (settingsRef.current.muted) return;
    const t = speakableText(text);
    if (t) synth().enqueue(t, opts());
  }, [synth]);

  const listen = useCallback(async () => {
    cancelSpeech(); // interrupción: hablar corta la respuesta
    setError(null);
    setPartial('');
    setListening(true);
    void core.voiceEvent('mic_on', rec.processor).catch(() => undefined);
    try {
      return await rec.listen(settingsRef.current.lang, { onPartial: setPartial });
    } catch (err) {
      if (err instanceof RecognitionFailure && err.code === 'not-allowed') void core.voiceEvent('mic_denied').catch(() => undefined);
      setError(err instanceof Error ? err.message : String(err));
      return '';
    } finally {
      setListening(false);
      void core.voiceEvent('mic_off').catch(() => undefined);
    }
  }, [rec, cancelSpeech]);

  // Palabra de activación: escucha local continua mientras esté activada.
  useEffect(() => {
    if (!(settings.wakeWord && settings.recognition === 'local' && whisper.supported)) {
      if (wake.active) { wake.stop(); setWakeActive(false); void core.voiceEvent('wake_off').catch(() => undefined); }
      return;
    }
    let cancelled = false;
    void wake.start(settings.lang, (command) => {
      chime();
      void core.voiceEvent('wake_detected', 'Whisper local').catch(() => undefined);
      if (wakeSubs.current.size) wakeSubs.current.forEach((s) => s(command));
      else pendingWake.current = command;
      window.dispatchEvent(new CustomEvent('jarvis:wake'));
    }, setLastHeard).then(() => {
      if (cancelled) { wake.stop(); return; }
      setWakeActive(true);
      void core.voiceEvent('wake_on', 'Whisper local').catch(() => undefined);
    }).catch((e: Error) => { setError(`Palabra de activación: ${e.message}`); setSettings((s) => ({ ...s, wakeWord: false })); });
    return () => { cancelled = true; wake.stop(); setWakeActive(false); };
  }, [settings.wakeWord, settings.recognition, settings.lang, wake]);

  // No despertarse con su propia voz ni mientras se escucha una orden.
  useEffect(() => { wake.paused = listening || speaking; }, [listening, speaking, wake]);

  // Lectura en voz alta de avisos importantes (si el usuario lo activa).
  const seen = useRef<number>(events[0]?.id ?? 0);
  useEffect(() => {
    const fresh = events.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = events[0]!.id;
    if (!settingsRef.current.readNotifications) return;
    for (const e of fresh.reverse()) {
      const p = e.payload as Record<string, unknown>;
      if (e.type === 'approval.requested') say(`Necesito tu confirmación para usar ${String(p.tool).replace(/[._]/g, ' ')}.`);
      if (e.type === 'emergency.changed') say(p.lockdown ? 'Modo emergencia activado.' : 'Modo emergencia desactivado.');
    }
  }, [events, say]);

  const api = useMemo<VoiceApi>(() => ({
    model,
    loadModel: () => whisper.load(),
    wakeActive,
    lastHeard,
    onWake: (cb) => { wakeSubs.current.add(cb); return () => { wakeSubs.current.delete(cb); }; },
    takePendingWake: () => { const p = pendingWake.current; pendingWake.current = null; return p; },
    settings,
    update: (p) => setSettings((s) => ({ ...s, ...p })),
    recognitionSupported: rec.supported,
    synthesisSupported: system.supported,
    processor: rec.processor,
    listening, speaking, partial, error,
    clearError: () => setError(null),
    listen,
    stopListening: () => rec.stop(),
    beginReply: () => { chunker.current = new SentenceChunker(); replying.current = true; },
    feed: (delta) => {
      if (!replying.current || settingsRef.current.muted) return;
      for (const s of chunker.current.push(delta)) synth().enqueue(s, opts());
    },
    endReply: () => {
      if (!replying.current) return;
      if (!settingsRef.current.muted) for (const s of chunker.current.flush()) synth().enqueue(s, opts());
      replying.current = false;
    },
    say, cancelSpeech,
    whenIdle: () => synth().whenIdle(),
  }), [model, wakeActive, lastHeard, settings, rec, system, listening, speaking, partial, error, listen, synth, say, cancelSpeech]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useVoice(): VoiceApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVoice fuera de VoiceProvider');
  return v;
}

/** Estado que muestra el núcleo visual: la voz local tiene prioridad sobre el estado del núcleo. */
export function useDisplayState(): AssistantState {
  const { assistant } = useConnection();
  const { listening, speaking } = useVoice();
  if (assistant === 'offline' || assistant === 'error') return assistant;
  if (listening) return 'listening';
  if (speaking) return 'speaking';
  return assistant;
}
