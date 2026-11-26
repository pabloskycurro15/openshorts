import type { ChatEvent, Principal } from '@jarvis/shared';
import type { EventBus } from '../kernel/events';
import type { Logger } from '../kernel/logger';
import type { AuditLog } from '../security/audit';
import type { ToolRegistry } from '../tools/registry';
import type { Budget } from './budget';
import type { ConversationStore } from './conversations';
import { ProviderError } from './provider';
import { runAgentLoop } from './loop';
import type { Plan } from './service';
import { SYSTEM_PROMPT } from './prompt';

/** Identidad con la que el asistente invoca herramientas. Nunca es el usuario. */
export const JARVIS_PRINCIPAL: Principal = { kind: 'agent', id: 'jarvis' };
export const MAX_STEPS = 15;

export class ConversationBusyError extends Error {}

export interface EngineDeps {
  store: ConversationStore;
  budget: Budget;
  tools: ToolRegistry;
  audit: AuditLog;
  bus: EventBus;
  logger: Logger;
  /** Plan del repartidor: candidatos ordenados (o un único modelo fijado por el usuario). */
  plan: (message: string) => Plan;
  markUnavailable: (c: { provider: string; model: string }) => void;
  /** Búsqueda web activada por el usuario (null = desactivada). */
  webSearch: () => { maxUses: number } | null;
}

/**
 * Motor de conversación: bucle de turnos con uso de herramientas.
 * - Cada llamada al modelo pasa antes por el control de presupuesto.
 * - Cada herramienta pasa por ToolRegistry (validación, permisos, confirmación, auditoría).
 * - El historial es de solo inserción y siempre válido: todo tool_use recibe su tool_result.
 */
export class ChatEngine {
  private active = new Map<string, AbortController>();

  constructor(private d: EngineDeps) {}

  activeConversations(): string[] {
    return [...this.active.keys()];
  }

  stop(conversationId: string): boolean {
    const c = this.active.get(conversationId);
    c?.abort();
    return !!c;
  }

  stopAll(): number {
    for (const c of this.active.values()) c.abort();
    return this.active.size;
  }

  async run(input: { conversationId?: string; message: string; approvalWaitMs?: number }, emit: (e: ChatEvent) => void, outerSignal?: AbortSignal): Promise<void> {
    const { store, bus } = this.d;
    const plan = this.d.plan(input.message);
    if (!plan.candidates.length) {
      emit({ type: 'error', message: plan.decision?.sensitive && plan.auto
        ? 'Tu mensaje parece contener datos sensibles y no lo envío al Gemini gratuito (Google puede usar esos datos para mejorar sus modelos). Añade una clave de pago (Anthropic u OpenAI) o quita los datos sensibles.'
        : plan.auto || !input.message
          ? 'El cerebro no está configurado: añade al menos una clave (Anthropic, OpenAI o Gemini) en Configuración.'
          : 'El modelo elegido no tiene clave configurada. Añádela en Configuración o elige «Automático».' });
      emit({ type: 'done', stopReason: 'not_configured' });
      return;
    }
    if (input.conversationId && this.active.has(input.conversationId)) throw new ConversationBusyError('Esta conversación ya está respondiendo');
    if (input.conversationId && !store.exists(input.conversationId)) throw new Error('Conversación inexistente');

    const conv = input.conversationId ? store.get(input.conversationId)! : store.create(input.message.replace(/\s+/g, ' ').trim().slice(0, 60));
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    this.active.set(conv.id, ctrl);
    emit({ type: 'start', conversationId: conv.id, title: conv.title });

    store.append(conv.id, { role: 'user', content: [{ type: 'text', text: input.message }] });
    let finalState: 'idle' | 'error' = 'idle';
    let stopReason: string;

    try {
      const r = await runAgentLoop(this.d, {
        plan,
        principal: JARVIS_PRINCIPAL,
        system: SYSTEM_PROMPT,
        history: { get: () => store.history(conv.id), append: (m) => { store.append(conv.id, m); } },
        usageTag: conv.id,
        emit,
        signal: ctrl.signal,
        maxSteps: MAX_STEPS,
        webSearch: this.d.webSearch(),
        context: { lastUserText: input.message, conversationId: conv.id },
        visualState: true,
        approvalWaitMs: input.approvalWaitMs,
      });
      stopReason = r.stopReason;
    } catch (err) {
      if (ctrl.signal.aborted) {
        stopReason = 'cancelled';
      } else {
        finalState = 'error';
        stopReason = 'error';
        const message = err instanceof ProviderError ? err.message : 'Error inesperado al generar la respuesta.';
        this.d.logger.error({ err }, 'Fallo en el turno de conversación');
        emit({ type: 'error', message });
      }
    } finally {
      this.active.delete(conv.id);
      outerSignal?.removeEventListener('abort', onOuterAbort);
      bus.emit('assistant.state', { state: finalState });
      if (finalState === 'error') setTimeout(() => bus.emit('assistant.state', { state: 'idle' }), 4000).unref();
    }
    emit({ type: 'done', stopReason });
  }
}
