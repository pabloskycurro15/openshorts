import type { ChatEvent, Principal, ToolResult } from '@jarvis/shared';
import type { EventBus } from '../kernel/events';
import type { Logger } from '../kernel/logger';
import type { AuditLog } from '../security/audit';
import type { ToolRegistry } from '../tools/registry';
import type { Budget } from './budget';
import type { ConversationStore } from './conversations';
import { costUsd } from './pricing';
import { ProviderError, type ContentBlock, type TurnResult } from './provider';
import type { Plan } from './service';
import { SYSTEM_PROMPT } from './prompt';

/** Identidad con la que el asistente invoca herramientas. Nunca es el usuario. */
export const JARVIS_PRINCIPAL: Principal = { kind: 'agent', id: 'jarvis' };
export const MAX_STEPS = 15;
const MAX_RESULT_CHARS = 50_000;

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
}

/** Fallos por los que tiene sentido pasar al siguiente modelo. */
const RETRYABLE = new Set(['rate_limit', 'credit', 'auth', 'overloaded', 'network']);

function summarize(r: ToolResult): string {
  switch (r.status) {
    case 'ok': return 'Completado';
    case 'denied': return `Denegado: ${r.reason}`;
    case 'error': return `Error: ${r.error}`;
    case 'pending_approval': return 'Esperando confirmación';
  }
}

function toResultBlock(id: string, r: ToolResult): ContentBlock {
  if (r.status === 'ok') {
    let s = typeof r.output === 'string' ? r.output : JSON.stringify(r.output ?? null);
    if (s.length > MAX_RESULT_CHARS) s = `${s.slice(0, MAX_RESULT_CHARS)}\n[resultado truncado]`;
    return { type: 'tool_result', toolUseId: id, content: s };
  }
  const msg = r.status === 'denied'
    ? `Denegado: ${r.reason}. Respeta la decisión del usuario y no lo intentes por otra vía.`
    : r.status === 'error' ? `Error: ${r.error}` : 'Sin resultado';
  return { type: 'tool_result', toolUseId: id, content: msg, isError: true };
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

  async run(input: { conversationId?: string; message: string }, emit: (e: ChatEvent) => void, outerSignal?: AbortSignal): Promise<void> {
    const { store, budget, tools, bus, audit } = this.d;
    const plan = this.d.plan(input.message);
    if (!plan.candidates.length) {
      emit({ type: 'error', message: plan.auto || !input.message
        ? 'El cerebro no está configurado: añade al menos una clave (Anthropic, OpenAI o Gemini) en Configuración.'
        : 'El modelo elegido no tiene clave configurada. Añádela en Configuración o elige «Automático».' });
      emit({ type: 'done', stopReason: 'not_configured' });
      return;
    }
    let ci = 0; // candidato en uso (se mantiene durante toda la respuesta)
    if (input.conversationId && this.active.has(input.conversationId)) throw new ConversationBusyError('Esta conversación ya está respondiendo');
    if (input.conversationId && !store.exists(input.conversationId)) throw new Error('Conversación inexistente');

    const conv = input.conversationId ? store.get(input.conversationId)! : store.create(input.message.replace(/\s+/g, ' ').trim().slice(0, 60));
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    this.active.set(conv.id, ctrl);
    emit({ type: 'start', conversationId: conv.id, title: conv.title });

    store.append(conv.id, { role: 'user', content: [{ type: 'text', text: input.message }] });
    const announce = () => {
      const c = plan.candidates[ci]!;
      emit({ type: 'route', provider: c.provider.id, model: c.model.id, label: c.model.label, tier: plan.decision?.tier ?? 'fijo', reason: plan.decision?.reason ?? 'elegido por ti', auto: plan.auto });
    };
    announce();
    let finalState: 'idle' | 'error' = 'idle';
    let stopReason: string;

    try {
      for (let step = 0; ; step++) {
        if (step >= MAX_STEPS) {
          emit({ type: 'warning', message: `He alcanzado el máximo de ${MAX_STEPS} pasos en esta respuesta. Pídeme que continúe si hace falta.` });
          stopReason = 'max_steps';
          break;
        }
        const b = budget.state();
        if (b.blocked) {
          emit({ type: 'error', message: `Límite de gasto mensual alcanzado (${b.spent.toFixed(2)} de ${b.limit.toFixed(2)} $). Puedes ampliarlo en Configuración.` });
          stopReason = 'budget';
          break;
        }

        const settings = budget.getSettings();
        bus.emit('assistant.state', { state: 'thinking' });
        let result: TurnResult | null = null;
        // Intentar con el candidato actual; si falla por cupo/saldo/caída antes de escribir nada, pasar al siguiente.
        for (;;) {
          const cand = plan.candidates[ci]!;
          let wrote = false;
          try {
            result = await cand.provider.runTurn({
              model: cand.model.id,
              effort: settings.effort,
              system: SYSTEM_PROMPT,
              messages: store.history(conv.id),
              tools: tools.describe(),
              signal: ctrl.signal,
              onText: (delta) => {
                if (!wrote) {
                  wrote = true;
                  bus.emit('assistant.state', { state: 'speaking' });
                }
                emit({ type: 'text', delta });
              },
            });
            break;
          } catch (err) {
            const canRetry = err instanceof ProviderError && RETRYABLE.has(err.kind) && !wrote && !ctrl.signal.aborted && ci + 1 < plan.candidates.length;
            if (!canRetry) throw err;
            this.d.markUnavailable({ provider: cand.provider.id, model: cand.model.id });
            const next = plan.candidates[ci + 1]!;
            emit({ type: 'warning', message: `${cand.model.label} no está disponible: ${(err as ProviderError).message.replace(/\.$/, '')}. Sigo con ${next.model.label}.` });
            ci++;
            announce();
          }
        }
        if (!result) throw new Error('Sin respuesta del modelo');
        const provider = plan.candidates[ci]!.provider;
        // Siempre se guarda qué modelo respondió; los adaptadores solo reenvían `blocks` si no está vacío.
        result.message.raw = result.message.raw ? { ...result.message.raw, model: result.servedModel } : { provider: provider.id, model: result.servedModel, blocks: [] };

        // Coste real de la llamada (también si luego se descarta por negativa).
        const model = provider.models.find((m) => m.id === result.servedModel) ?? plan.candidates[ci]!.model;
        const cost = costUsd(model, result.usage);
        const wasWarn = b.warn;
        budget.record({ conversationId: conv.id, provider: provider.id, model: result.servedModel, usage: result.usage, costUsd: cost });
        const after = budget.state();
        emit({ type: 'usage', model: result.servedModel, costUsd: cost, monthUsd: after.spent, limitUsd: after.limit });
        if (!wasWarn && after.warn) emit({ type: 'warning', message: `Has consumido el ${Math.round(after.ratio * 100)} % del límite mensual.` });
        audit.append({
          principal: JARVIS_PRINCIPAL, action: 'ai.turn', target: conv.id, outcome: 'success',
          details: { model: result.servedModel, stop: result.stopReason, ...result.usage, costUsd: Number(cost.toFixed(6)) },
        });
        emit({ type: 'message_end' });

        if (result.stopReason === 'refusal') {
          // Respuesta parcial descartada: no entra en el historial.
          emit({ type: 'error', message: `El modelo ha declinado responder${result.refusalDetail ? `: ${result.refusalDetail}` : '.'}` });
          stopReason = 'refusal';
          break;
        }

        store.append(conv.id, result.message);
        const toolUses = result.message.content.filter((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use');

        if (result.stopReason === 'max_tokens' && toolUses.length) {
          store.append(conv.id, { role: 'user', content: toolUses.map((t) => toResultBlock(t.id, { status: 'error', error: 'Entrada truncada por longitud; no se ha ejecutado' })) });
          emit({ type: 'error', message: 'La respuesta se cortó por longitud antes de terminar una acción. No se ha ejecutado nada.' });
          stopReason = 'max_tokens';
          break;
        }
        if (result.stopReason === 'pause_turn') continue;
        if (!toolUses.length) {
          stopReason = result.stopReason;
          break;
        }

        bus.emit('assistant.state', { state: 'executing' });
        const results: ContentBlock[] = [];
        for (const t of toolUses) {
          let r: ToolResult;
          if (ctrl.signal.aborted) {
            r = { status: 'denied', reason: 'Cancelado por el usuario' };
          } else {
            emit({ type: 'tool_call', id: t.id, tool: t.name, input: t.input });
            r = await tools.invoke(JARVIS_PRINCIPAL, t.name, t.input, { interactive: true, signal: ctrl.signal });
            if (r.status === 'pending_approval') {
              const a = tools.getApproval(r.approvalId);
              const def = tools.get(t.name);
              const reason = def ? `${def.description} (permiso: ${a?.scopes.join(', ') ?? '—'})` : (a?.reason ?? '');
              emit({ type: 'approval_required', id: t.id, approvalId: r.approvalId, tool: t.name, reason, risk: a?.risk ?? 'medium' });
              bus.emit('assistant.state', { state: 'idle', detail: 'Esperando tu confirmación' });
              r = await Promise.race([
                tools.waitForApproval(r.approvalId),
                new Promise<ToolResult>((resolve) => {
                  if (ctrl.signal.aborted) resolve({ status: 'denied', reason: 'Cancelado por el usuario' });
                  ctrl.signal.addEventListener('abort', () => resolve({ status: 'denied', reason: 'Cancelado por el usuario' }), { once: true });
                }),
              ]);
              bus.emit('assistant.state', { state: 'executing' });
            }
          }
          emit({ type: 'tool_result', id: t.id, tool: t.name, status: r.status, summary: summarize(r) });
          results.push(toResultBlock(t.id, r));
        }
        store.append(conv.id, { role: 'user', content: results });
        if (ctrl.signal.aborted) {
          stopReason = 'cancelled';
          break;
        }
      }
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
