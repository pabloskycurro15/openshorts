import path from 'node:path';
import type { SemanticStatus } from '@jarvis/shared';

/** Convierte textos en vectores para la búsqueda por significado. */
export interface Embedder {
  readonly model: string;
  readonly ready: boolean;
  status(): Pick<SemanticStatus, 'state' | 'model' | 'error'>;
  load(): Promise<void>;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const SEMANTIC_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/**
 * Modelo de embeddings multilingüe ejecutado en local (transformers.js + ONNX Runtime).
 * Se descarga una vez (~120 MB) a la carpeta de datos de JARVIS. Los textos nunca salen del equipo.
 */
export class LocalEmbedder implements Embedder {
  readonly model = SEMANTIC_MODEL;
  private extractor: ((texts: string[], o: object) => Promise<{ tolist(): number[][] }>) | null = null;
  private loading: Promise<void> | null = null;
  private state: SemanticStatus['state'] = 'idle';
  private error: string | null = null;

  constructor(private cacheDir: string) {}

  get ready() {
    return this.state === 'ready';
  }

  status() {
    return { state: this.state, model: this.model, error: this.error };
  }

  load(): Promise<void> {
    this.loading ??= (async () => {
      this.state = 'loading';
      try {
        const t = await import('@huggingface/transformers');
        t.env.cacheDir = path.join(this.cacheDir, 'models');
        t.env.allowLocalModels = false;
        const pipe = await t.pipeline('feature-extraction', this.model, { dtype: 'q8' });
        this.extractor = pipe as unknown as typeof this.extractor;
        this.state = 'ready';
      } catch (err) {
        this.state = 'error';
        this.error = err instanceof Error ? err.message : String(err);
        this.loading = null;
        throw err;
      }
    })();
    return this.loading;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) throw new Error('El modelo de significado no está cargado');
    const out = await this.extractor(texts, { pooling: 'mean', normalize: true });
    return out.tolist().map((v) => Float32Array.from(v));
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s; // vectores normalizados
}
