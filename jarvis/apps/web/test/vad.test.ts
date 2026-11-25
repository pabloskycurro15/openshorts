import { describe, expect, it } from 'vitest';
import { EnergyVad, parseWake, rms } from '../src/voice/vad';

const chunk = (amp: number, n = 1600) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 3));
const silence = () => Float32Array.from({ length: 1600 }, () => (Math.random() - 0.5) * 0.002);

describe('detector de voz (VAD)', () => {
  it('ignora el silencio y entrega una frase completa con margen', () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 20; i++) expect(vad.push(silence())).toBeNull();
    for (let i = 0; i < 10; i++) expect(vad.push(chunk(0.2))).toBeNull(); // 1 s de voz
    let seg: Float32Array | null = null;
    for (let i = 0; i < 10 && !seg; i++) seg = vad.push(silence());
    expect(seg).not.toBeNull();
    // 1 s de voz + margen previo (0,3 s) + silencio de cierre (0,7 s)
    expect(seg!.length / 16000).toBeGreaterThanOrEqual(1.6);
    expect(seg!.length / 16000).toBeLessThanOrEqual(2.2);
  });

  it('descarta ruidos demasiado cortos', () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 10; i++) vad.push(silence());
    vad.push(chunk(0.3)); // 0,1 s: un golpe
    let seg: Float32Array | null = null;
    for (let i = 0; i < 10; i++) seg = vad.push(silence()) ?? seg;
    expect(seg).toBeNull();
  });

  it('corta frases demasiado largas', () => {
    const vad = new EnergyVad({ maxSpeechMs: 2000 });
    for (let i = 0; i < 5; i++) vad.push(silence());
    let seg: Float32Array | null = null;
    for (let i = 0; i < 40 && !seg; i++) seg = vad.push(chunk(0.2));
    expect(seg).not.toBeNull();
    expect(seg!.length / 16000).toBeLessThanOrEqual(2.1);
  });

  it('se adapta a un ruido constante y sigue detectando la voz por encima', () => {
    const vad = new EnergyVad();
    const hum = () => chunk(0.02);
    for (let i = 0; i < 400; i++) vad.push(hum()); // ventilador: tras adaptarse, deja de ser «voz»
    expect(vad.isSpeaking).toBe(false);
    let late: Float32Array | null = null;
    for (let i = 0; i < 50; i++) late = vad.push(hum()) ?? late;
    expect(late).toBeNull();
    for (let i = 0; i < 10; i++) vad.push(chunk(0.25)); // alguien habla por encima
    let seg: Float32Array | null = null;
    for (let i = 0; i < 12 && !seg; i++) seg = vad.push(hum());
    expect(seg).not.toBeNull();
    expect(rms(chunk(0.2))).toBeGreaterThan(0.1);
  });
});

describe('palabra de activación', () => {
  it.each([
    ['Jarvis que horas', true, 'que horas'],
    ['¿Jarvis, qué hora es?', true, 'qué hora es?'],
    ['Oye Jarvis, abre el bloc de notas.', true, 'abre el bloc de notas.'],
    ['Yarvis', true, ''],
    ['Hey Jarvis.', true, ''],
    ['jarbis pon música', true, 'pon música'],
    ['Hoy hace un día muy bonito en la playa.', false, ''],
    ['El jarvisito', false, ''],
    ['Le dije a Jarvis que viniera', false, ''],
  ])('«%s» → activa=%s, orden=«%s»', (text, wake, command) => {
    expect(parseWake(text)).toEqual({ wake, command });
  });
});
