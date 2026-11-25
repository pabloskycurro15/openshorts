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
