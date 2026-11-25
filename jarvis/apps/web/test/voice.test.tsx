import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentenceChunker, speakableText } from '../src/voice/text';
import { WebSpeechRecognizer, WebSpeechSynthesizer, pickDefaultVoice } from '../src/voice/webspeech';
import { RecognitionFailure } from '../src/voice/types';
import { FakeRecognition, installFakeSynthesis } from './voice-fakes';

beforeEach(() => { FakeRecognition.instances = []; });
afterEach(() => vi.unstubAllGlobals());

describe('texto para voz', () => {
  it('quita el formato y sustituye el código', () => {
    expect(speakableText('Hola **señor**, ejecuta `npm test`.\n\n```js\nconst x = 1;\n```\nVisita https://x.com')).toBe('Hola señor, ejecuta npm test. He dejado un bloque de código en pantalla. Visita el enlace en pantalla');
    expect(speakableText('- uno\n- dos\n## Título')).toBe('uno dos Título');
  });

  it('trocea en frases completas según llega el texto', () => {
    const c = new SentenceChunker();
    expect(c.push('Buenas tar')).toEqual([]);
    expect(c.push('des, señor. Todo está en or')).toEqual(['Buenas tardes, señor.']);
    expect(c.push('den. ¿Algo más?')).toEqual(['Todo está en orden.']);
    expect(c.flush()).toEqual(['¿Algo más?']);
  });

  it('no corta tras abreviaturas cortas ni dentro de bloques de código', () => {
    const c = new SentenceChunker();
    expect(c.push('Sí. De acuerdo, lo preparo ahora mismo. ')).toEqual(['Sí. De acuerdo, lo preparo ahora mismo.']);
    expect(c.push('Mira: ```\nfoo. bar. baz.\n')).toEqual([]);
    expect(c.push('``` Listo. ')).toEqual(['Mira: He dejado un bloque de código en pantalla. Listo.']);
  });
});

describe('reconocimiento (Web Speech)', () => {
  it('informa de que no hay soporte', async () => {
    const r = new WebSpeechRecognizer();
    expect(r.supported).toBe(false);
    await expect(r.listen('es-ES')).rejects.toBeInstanceOf(RecognitionFailure);
  });

  it('entrega parciales y el texto final en español de España', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const r = new WebSpeechRecognizer();
    const partials: string[] = [];
    const p = r.listen('es-ES', { onPartial: (t) => partials.push(t) });
    const fr = FakeRecognition.instances[0]!;
    expect(fr.lang).toBe('es-ES');
    expect(fr.interimResults).toBe(true);
    fr.say([{ text: 'qué hora', final: false }]);
    fr.say([{ text: 'qué hora es', final: true }]);
    fr.onend!();
    expect(await p).toBe('qué hora es');
    expect(partials).toEqual(['qué hora', 'qué hora es']);
  });

  it('permiso denegado → error claro; silencio → texto vacío', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const r = new WebSpeechRecognizer();
    const p1 = r.listen('es-ES');
    FakeRecognition.instances[0]!.onerror!({ error: 'not-allowed' });
    FakeRecognition.instances[0]!.onend!();
    await expect(p1).rejects.toThrow(/Permiso de micrófono denegado/);
    const p2 = r.listen('es-ES');
    FakeRecognition.instances[1]!.onerror!({ error: 'no-speech' });
    FakeRecognition.instances[1]!.onend!();
    expect(await p2).toBe('');
  });
});

describe('síntesis (Web Speech)', () => {
  it('encola frases con los ajustes y avisa al terminar', async () => {
    const { spoken, synth } = installFakeSynthesis();
    const s = new WebSpeechSynthesizer();
    const changes: boolean[] = [];
    s.onSpeakingChange((x) => changes.push(x));
    const o = { rate: 1.1, pitch: 0.85, volume: 1, lang: 'es-ES' };
    s.enqueue('Primera.', o);
    s.enqueue('Segunda.', o);
    const idle = s.whenIdle();
    synth.finishAll();
    await idle;
    expect(spoken).toEqual([{ text: 'Primera.', rate: 1.1, pitch: 0.85, lang: 'es-ES' }, { text: 'Segunda.', rate: 1.1, pitch: 0.85, lang: 'es-ES' }]);
    expect(changes).toEqual([true, false]);
  });

  it('cancelar vacía la cola (interrupción)', async () => {
    installFakeSynthesis();
    const s = new WebSpeechSynthesizer();
    s.enqueue('Hola.', { rate: 1, pitch: 1, volume: 1, lang: 'es-ES' });
    s.cancel();
    await expect(s.whenIdle()).resolves.toBeUndefined();
  });

  it('elige por defecto una voz de España, masculina y natural si existe', () => {
    const v = (name: string, lang: string) => ({ name, lang, voiceURI: name, localService: true, default: false }) as SpeechSynthesisVoice;
    const voices = [v('Google US English', 'en-US'), v('Microsoft Elvira', 'es-ES'), v('Microsoft Alvaro Online (Natural)', 'es-ES'), v('Paulina', 'es-MX')];
    expect(pickDefaultVoice(voices)!.name).toBe('Microsoft Alvaro Online (Natural)');
    expect(pickDefaultVoice([v('Paulina', 'es-MX')])!.name).toBe('Paulina');
  });
});
