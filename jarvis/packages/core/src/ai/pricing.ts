import type { ModelInfo, Usage } from './provider';

/**
 * Precios públicos de Anthropic (USD por millón de tokens), consultados el 2026-11-25.
 * Escritura en caché = 1,25 × entrada (caché de 5 minutos). Si cambian, actualizar aquí.
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'El más capaz: razonamiento, planificación y uso de herramientas.',
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Muy capaz y más rápido, a la mitad de precio.',
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    description: 'Respuestas inmediatas para tareas sencillas. Muy económico.',
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  },
];

export function costUsd(model: ModelInfo | undefined, u: Usage): number {
  if (!model) return 0;
  const p = model.price;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

/** OpenAI (consultado el 2026-11-25 en developers.openai.com). Escritura en caché: 1,25 × entrada. */
export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-6.1-terra',
    label: 'GPT-6.1 Terra',
    description: 'Intermedio de OpenAI: buena calidad a precio bajo.',
    price: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
  },
];

/**
 * Google Gemini en el nivel GRATUITO de AI Studio: coste 0 (con límites diarios; Google
 * puede usar estos datos para mejorar sus productos). Si el proyecto tiene facturación,
 * el uso se cobra a los precios de Google y este contador no lo reflejaría.
 */
export const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite (gratis)',
    description: 'Gratis con límite diario amplio. Para tareas sencillas.',
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (gratis)',
    description: 'Gratis con límite diario muy bajo. Respaldo del anterior.',
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

export const ALL_MODELS: (ModelInfo & { provider: string })[] = [
  ...ANTHROPIC_MODELS.map((m) => ({ ...m, provider: 'anthropic' })),
  ...OPENAI_MODELS.map((m) => ({ ...m, provider: 'openai' })),
  ...GOOGLE_MODELS.map((m) => ({ ...m, provider: 'google' })),
];
