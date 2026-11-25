/// <reference lib="webworker" />
/**
 * Whisper en un Web Worker (transformers.js + ONNX Runtime en WebAssembly).
 * Se ejecuta en el equipo del usuario: el audio nunca sale de aquí. La primera vez
 * descarga el modelo (~80 MB) de Hugging Face y lo guarda en la caché del navegador.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
// Motor WebAssembly servido por el propio JARVIS (sin CDN externa).
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<void> | null = null;

type Msg = { type: 'load'; model: string } | { type: 'transcribe'; id: number; audio: Float32Array; language: string };

async function load(model: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  asr = (await pipeline('automatic-speech-recognition', model, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        postMessage({ type: 'progress', loaded, total });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;
  // Calentamiento: la primera inferencia compila el grafo.
  await asr(new Float32Array(16000), { language: 'spanish', task: 'transcribe' });
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      loading ??= load(m.model);
      await loading;
      postMessage({ type: 'ready' });
    } else if (m.type === 'transcribe') {
      if (!asr) throw new Error('Modelo no cargado');
      const t0 = performance.now();
      const r = (await asr(m.audio, { language: m.language, task: 'transcribe' })) as { text: string };
      postMessage({ type: 'result', id: m.id, text: r.text.trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    loading = null;
    postMessage({ type: 'error', id: (m as { id?: number }).id, message: err instanceof Error ? err.message : String(err) });
  }
};
