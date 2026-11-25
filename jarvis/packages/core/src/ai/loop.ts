import type { ChatEvent, Principal, ToolResult } from '@jarvis/shared';
import type { EventBus } from '../kernel/events';
import type { AuditLog } from '../security/audit';
import type { ToolRegistry } from '../tools/registry';
import type { Budget } from './budget';
import { costUsd } from './pricing';
import { ProviderError, type ChatMessage, type ContentBlock, type TurnResult } from './provider';
import type { Plan } from './service';

/** Fallos por los que tiene sentido pasar al siguiente modelo. */
const RETRYABLE = new Set(['rate_limit', 'credit', 'auth', 'overloaded', 'network']);
const MAX_RESULT_CHARS = 50_000;

export function summarize(r: ToolResult): string {
  switch (r.status) {
    case 'ok': return 'Completado';
    case 'denied': return `Denegado: ${r.reason}`;
    case 'error': return `Error: ${r.error}`;
    case 'pending_approval': return 'Esperando confirmación';
  }
}

export function toResultBlock(id: string, r: ToolResult): ContentBlock {
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

export interface LoopDeps {
  budget: Budget;
  tools: ToolRegistry;
  audit: AuditLog;
  bus: EventBus;
  markUnavailable: (c: { provider: string; model: string }) => void;
}

export interface LoopOptions {
  plan: Plan;
  principal: Principal;
  system: string;
  history: { get(): ChatMessage[]; append(m: ChatMessage): void };
  /** Etiqueta para el consumo (id de conversación o «tarea:<id>»). */
  usageTag: string;
  emit: (e: ChatEvent) => void;
  signal: AbortSignal;
  maxSteps: number;
  /** Herramientas que puede usar (por defecto, todas). */
  allowTool?: (name: string) => boolean;
  /** Búsqueda web (solo si el usuario la ha activado). */
  webSearch?: { maxUses: number } | null;
  context: { lastUserText?: string; conversationId?: string };
  /** Emitir los estados del núcleo visual (solo la conversación principal). */
  visualState?: boolean;
}

export interface LoopResult {
  stopReason: string;
  /** Texto de la última respuesta del modelo. */
  finalText: string;
  costUsd: number;
  model: string;
}

/**
 * Bucle de razonamiento con herramientas, común a la conversación y a los agentes.
 * Presupuesto antes de cada llamada; respaldo entre modelos; cada herramienta por
 * ToolRegistry con la identidad (principal) de quien actúa; historial siempre válido.
 */
export async function runAgentLoop(d: LoopDeps, o: LoopOptions): Promise<LoopResult> {
  const { budget, tools, bus } = d;
  let ci = 0;
  let total = 0;
  let finalText = '';
  const state = (s: 'thinking' | 'speaking' | 'executing' | 'idle', detail?: string) => { if (o.visualState) bus.emit('assistant.state', { state: s, detail }); };
  const announce = () => {
    const c = o.plan.candidates[ci]!;
    o.emit({ type: 'route', provider: c.provider.id, model: c.model.id, label: c.model.label, tier: o.plan.decision?.tier ?? 'fijo', reason: o.plan.decision?.reason ?? 'elegido por ti', auto: o.plan.auto });
  };
  announce();
  const offered = () => tools.describe().filter((t) => !o.allowTool || o.allowTool(t.name));

  for (let step = 0; ; step++) {
    if (step >= o.maxSteps) {
      o.emit({ type: 'warning', message: `He alcanzado el máximo de ${o.maxSteps} pasos. Pídeme que continúe si hace falta.` });
      return { stopReason: 'max_steps', finalText, costUsd: total, model: o.plan.candidates[ci]!.model.id };
    }
    const b = budget.state();
    if (b.blocked) {
      o.emit({ type: 'error', message: `Límite de gasto mensual alcanzado (${b.spent.toFixed(2)} de ${b.limit.toFixed(2)} $). Puedes ampliarlo en Configuración.` });
      return { stopReason: 'budget', finalText, costUsd: total, model: o.plan.candidates[ci]!.model.id };
    }
    const settings = budget.getSettings();
    state('thinking');
    let result: TurnResult | null = null;
    for (;;) {
      const cand = o.plan.candidates[ci]!;
      let wrote = false;
      try {
        result = await cand.provider.runTurn({
          model: cand.model.id,
          effort: settings.effort,
          system: o.system,
          messages: o.history.get(),
          tools: offered(),
          webSearch: cand.provider.id === 'anthropic' ? o.webSearch ?? null : null,
          signal: o.signal,
          onText: (delta) => {
            if (!wrote) { wrote = true; state('speaking'); }
            o.emit({ type: 'text', delta });
          },
        });
        break;
      } catch (err) {
        const canRetry = err instanceof ProviderError && RETRYABLE.has(err.kind) && !wrote && !o.signal.aborted && ci + 1 < o.plan.candidates.length;
        if (!canRetry) throw err;
        d.markUnavailable({ provider: cand.provider.id, model: cand.model.id });
        const next = o.plan.candidates[ci + 1]!;
        o.emit({ type: 'warning', message: `${cand.model.label} no está disponible: ${(err as ProviderError).message.replace(/\.$/, '')}. Sigo con ${next.model.label}.` });
        ci++;
        announce();
      }
    }
    if (!result) throw new Error('Sin respuesta del modelo');
    const provider = o.plan.candidates[ci]!.provider;
    result.message.raw = result.message.raw ? { ...result.message.raw, model: result.servedModel } : { provider: provider.id, model: result.servedModel, blocks: [] };

    const model = provider.models.find((m) => m.id === result.servedModel) ?? o.plan.candidates[ci]!.model;
    const cost = costUsd(model, result.usage) + (result.usage.webSearches ?? 0) * 0.01;
    total += cost;
    const wasWarn = b.warn;
    budget.record({ conversationId: o.usageTag, provider: provider.id, model: result.servedModel, usage: result.usage, costUsd: cost });
    const after = budget.state();
    o.emit({ type: 'usage', model: result.servedModel, costUsd: cost, monthUsd: after.spent, limitUsd: after.limit });
    if (!wasWarn && after.warn) o.emit({ type: 'warning', message: `Has consumido el ${Math.round(after.ratio * 100)} % del límite mensual.` });
    d.audit.append({
      principal: o.principal, action: 'ai.turn', target: o.usageTag, outcome: 'success',
      details: { model: result.servedModel, stop: result.stopReason, ...result.usage, costUsd: Number(cost.toFixed(6)) },
    });
    o.emit({ type: 'message_end' });

    if (result.stopReason === 'refusal') {
      o.emit({ type: 'error', message: `El modelo ha declinado responder${result.refusalDetail ? `: ${result.refusalDetail}` : '.'}` });
      return { stopReason: 'refusal', finalText, costUsd: total, model: result.servedModel };
    }

    o.history.append(result.message);
    const text = result.message.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n').trim();
    if (text) finalText = text;
    const toolUses = result.message.content.filter((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use');

    if (result.stopReason === 'max_tokens' && toolUses.length) {
      o.history.append({ role: 'user', content: toolUses.map((t) => toResultBlock(t.id, { status: 'error', error: 'Entrada truncada por longitud; no se ha ejecutado' })) });
      o.emit({ type: 'error', message: 'La respuesta se cortó por longitud antes de terminar una acción. No se ha ejecutado nada.' });
      return { stopReason: 'max_tokens', finalText, costUsd: total, model: result.servedModel };
    }
    if (result.stopReason === 'pause_turn') continue;
    if (!toolUses.length) return { stopReason: result.stopReason, finalText, costUsd: total, model: result.servedModel };

    state('executing');
    const results: ContentBlock[] = [];
    for (const t of toolUses) {
      let r: ToolResult;
      if (o.signal.aborted) {
        r = { status: 'denied', reason: 'Cancelado por el usuario' };
      } else if (o.allowTool && !o.allowTool(t.name)) {
        r = { status: 'denied', reason: `Esta herramienta no está permitida para ${o.principal.id}` };
      } else {
        o.emit({ type: 'tool_call', id: t.id, tool: t.name, input: t.input });
        r = await tools.invoke(o.principal, t.name, t.input, { interactive: true, signal: o.signal, context: o.context });
        if (r.status === 'pending_approval') {
          const a = tools.getApproval(r.approvalId);
          const def = tools.get(t.name);
          const reason = def ? `${def.description} (permiso: ${a?.scopes.join(', ') ?? '—'})` : (a?.reason ?? '');
          o.emit({ type: 'approval_required', id: t.id, approvalId: r.approvalId, tool: t.name, reason, risk: a?.risk ?? 'medium' });
          state('idle', 'Esperando tu confirmación');
          r = await Promise.race([
            tools.waitForApproval(r.approvalId),
            new Promise<ToolResult>((resolve) => {
              if (o.signal.aborted) resolve({ status: 'denied', reason: 'Cancelado por el usuario' });
              o.signal.addEventListener('abort', () => resolve({ status: 'denied', reason: 'Cancelado por el usuario' }), { once: true });
            }),
          ]);
          state('executing');
        }
      }
      o.emit({ type: 'tool_result', id: t.id, tool: t.name, status: r.status, summary: summarize(r) });
      results.push(toResultBlock(t.id, r));
    }
    o.history.append({ role: 'user', content: results });
    if (o.signal.aborted) return { stopReason: 'cancelled', finalText, costUsd: total, model: result.servedModel };
  }
}
