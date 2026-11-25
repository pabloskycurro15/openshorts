/**
 * Capa de abstracción de proveedores de IA.
 * El motor de conversación solo conoce estos tipos neutros; cada adaptador traduce
 * a/desde el formato de su proveedor. Así se puede cambiar de proveedor o modelo
 * sin reconstruir la aplicación (ADR-009).
 */
import type { ToolDescriptor } from '@jarvis/shared';

/** Bloques de contenido neutros, independientes del proveedor. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  /**
   * Contenido original del proveedor (p. ej. bloques de razonamiento de Claude).
   * Debe reenviarse sin cambios al mismo proveedor: algunos modelos verifican que
   * el historial no se ha editado. Otros proveedores lo ignoran y usan `content`.
   */
  raw?: { provider: string; blocks: unknown[] } | null;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'other';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TurnRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDescriptor[];
  effort: Effort;
  signal?: AbortSignal;
  /** Fragmentos de texto según se generan (para mostrarlos en directo). */
  onText?: (delta: string) => void;
}

export interface TurnResult {
  message: ChatMessage;
  stopReason: StopReason;
  /** Detalle legible de una negativa del modelo, si la hubo. */
  refusalDetail?: string;
  usage: Usage;
  /** Modelo que respondió realmente (puede diferir si hubo respaldo automático). */
  servedModel: string;
}

export type Effort = 'low' | 'medium' | 'high';

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  /** USD por millón de tokens. */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly models: ModelInfo[];
  runTurn(req: TurnRequest): Promise<TurnResult>;
  /** Comprueba credenciales y conectividad sin generar coste. */
  healthCheck(model: string): Promise<{ ok: boolean; detail: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'network' | 'credit' | 'other',
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
