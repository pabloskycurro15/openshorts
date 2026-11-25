/**
 * Capa de abstracción de proveedores de IA (se implementa en la Fase 3).
 * Todo el núcleo habla con esta interfaz, nunca con un SDK concreto, para poder
 * cambiar de proveedor o modelo sin reconstruir la aplicación.
 */
import type { ToolDescriptor } from '@jarvis/shared';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDescriptor[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: string };

export interface AIProvider {
  readonly id: string; // "anthropic", "google", "openai", "ollama"...
  readonly displayName: string;
  listModels(): Promise<string[]>;
  chat(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
  /** Comprueba credenciales y conectividad sin generar coste apreciable. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
