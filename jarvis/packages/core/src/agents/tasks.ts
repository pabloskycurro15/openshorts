import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentInfo, ChatEvent, Principal, SubtaskLogEntry, SubtaskStatus, SubtaskView, TaskStatus, TaskView } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { EventBus } from '../kernel/events';
import type { Logger } from '../kernel/logger';
import type { PermissionEngine } from '../security/permissions';
import type { AIService } from '../ai/service';
import { runAgentLoop, type LoopDeps } from '../ai/loop';
import type { ChatMessage } from '../ai/provider';
import { AGENTS, COORDINATOR_ID, allowsTool, type AgentDef } from './definitions';

const MAX_SUBTASKS = 6;
const SUBTASK_STEPS = 10;

const PlanSchema = z.object({
  subtasks: z.array(z.object({
    agent: z.string(),
    title: z.string().min(1).max(120),
    instructions: z.string().min(1).max(3000),
  })).min(1).max(MAX_SUBTASKS),
});

/** Extrae el primer objeto JSON de un texto (el modelo a veces añade explicación o bloques ```). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1]! : text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('El plan no contiene JSON');
  return JSON.parse(src.slice(start, end + 1));
}

type TaskRow = { id: string; title: string; goal: string; status: TaskStatus; result: string | null; error: string | null; cost_usd: number; created_at: string; updated_at: string; finished_at: string | null };
type SubRow = { id: string; task_id: string; idx: number; agent_id: string; title: string; instructions: string; status: SubtaskStatus; result: string | null; error: string | null; model: string | null; cost_usd: number; log: string; started_at: string | null; finished_at: string | null };

const toSub = (r: SubRow): SubtaskView => ({
  id: r.id, index: r.idx, agentId: r.agent_id, title: r.title, instructions: r.instructions, status: r.status, result: r.result, error: r.error,
  model: r.model, costUsd: r.cost_usd, log: JSON.parse(r.log) as SubtaskLogEntry[], startedAt: r.started_at, finishedAt: r.finished_at,
});

/**
 * Sistema multiagente: un coordinador descompone el objetivo en subtareas, cada
 * agente especializado las ejecuta con SUS herramientas y SU identidad de permisos
 * (agent:<id>; nunca puede ampliarlos), y el coordinador sintetiza el resultado.
 */
export class TaskManager {
  private running = new Map<string, AbortController>();

  constructor(
    private db: Database,
    private ai: AIService,
    private loopDeps: LoopDeps,
    private permissions: PermissionEngine,
    private bus: EventBus,
    private logger: Logger,
  ) {
    // Tareas que quedaron a medias por un reinicio: se marcan como fallidas.
    this.db.prepare("UPDATE tasks SET status = 'failed', error = 'Interrumpida por un reinicio de JARVIS', finished_at = ? WHERE status IN ('planning','running')").run(new Date().toISOString());
    this.db.prepare("UPDATE subtasks SET status = 'cancelled' WHERE status IN ('pending','running','waiting_approval')").run();
  }

  // ── Agentes ──
  isEnabled(id: string): boolean {
    const r = this.db.prepare('SELECT enabled FROM agent_settings WHERE agent_id = ?').get(id) as { enabled: number } | undefined;
    return r ? !!r.enabled : true;
  }

  setEnabled(by: Principal, id: string, enabled: boolean): void {
    if (by.kind !== 'user') throw new Error('Solo el usuario activa o desactiva agentes');
    if (!AGENTS.some((a) => a.id === id)) throw new Error('Agente desconocido');
    this.db.prepare('INSERT INTO agent_settings (agent_id, enabled) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET enabled = excluded.enabled').run(id, enabled ? 1 : 0);
  }

  agents(): AgentInfo[] {
    const stats = this.db.prepare(`SELECT agent_id, COUNT(*) AS n, SUM(status = 'done') AS done, SUM(status = 'failed') AS failed, SUM(cost_usd) AS cost,
      SUM(status IN ('running','waiting_approval')) AS active FROM subtasks GROUP BY agent_id`).all() as { agent_id: string; n: number; done: number; failed: number; cost: number; active: number }[];
    const by = new Map(stats.map((s) => [s.agent_id, s]));
    const grants = this.permissions.listGrants();
    return AGENTS.map((a) => {
      const s = by.get(a.id);
      return {
        id: a.id, name: a.name, description: a.description, tools: a.tools, tier: a.tier, enabled: this.isEnabled(a.id), availableNote: a.availableNote ?? null,
        stats: { subtasks: s?.n ?? 0, done: s?.done ?? 0, failed: s?.failed ?? 0, costUsd: s?.cost ?? 0, active: s?.active ?? 0 },
        grants: grants.filter((g) => g.principal.kind === 'agent' && g.principal.id === a.id).map((g) => g.scope),
      };
    });
  }

  // ── Tareas ──
  list(): TaskView[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all() as TaskRow[];
    return rows.map((r) => this.view(r));
  }

  get(id: string): TaskView | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return r ? this.view(r) : undefined;
  }

  activeCount(): number {
    return this.running.size;
  }

  /** Crea una tarea y la ejecuta en segundo plano. */
  start(goal: string): TaskView {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO tasks (id, title, goal, status, created_at, updated_at) VALUES (?, ?, ?, 'planning', ?, ?)")
      .run(id, goal.replace(/\s+/g, ' ').trim().slice(0, 80), goal, now, now);
    const ctrl = new AbortController();
    this.running.set(id, ctrl);
    this.changed(id);
    void this.execute(id, goal, ctrl.signal)
      .catch((err: unknown) => {
        this.logger.error({ err, task: id }, 'Fallo en la tarea');
        this.finish(id, ctrl.signal.aborted ? 'cancelled' : 'failed', null, err instanceof Error ? err.message : String(err));
      })
      .finally(() => this.running.delete(id));
    return this.get(id)!;
  }

  cancel(id: string): boolean {
    const c = this.running.get(id);
    c?.abort();
    return !!c;
  }

  cancelAll(): number {
    for (const c of this.running.values()) c.abort();
    return this.running.size;
  }

  /** Espera a que termine (para pruebas y para el uso desde la conversación). */
  async waitFor(id: string, timeoutMs = 600_000): Promise<TaskView> {
    const t0 = Date.now();
    while (this.running.has(id) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 50));
    return this.get(id)!;
  }

  delete(id: string): boolean {
    if (this.running.has(id)) throw new Error('Detén la tarea antes de borrarla');
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  private async execute(id: string, goal: string, signal: AbortSignal) {
    const enabled = AGENTS.filter((a) => this.isEnabled(a.id));
    if (!enabled.length) throw new Error('No hay agentes activados');

    // 1) Plan del coordinador
    const agentsList = enabled.map((a) => `- ${a.id}: ${a.description}${a.availableNote ? ` (${a.availableNote})` : ''}`).join('\n');
    const planText = await this.ask(id, `Eres el coordinador de un equipo de agentes de JARVIS. Descompón el objetivo del usuario en entre 1 y ${MAX_SUBTASKS} subtareas, en orden, asignando cada una al agente más adecuado. Cada agente recibirá los resultados de los anteriores.
Agentes disponibles:
${agentsList}

Responde SOLO con JSON, sin texto adicional, con esta forma:
{"subtasks":[{"agent":"<id>","title":"<título breve>","instructions":"<instrucciones concretas y autosuficientes>"}]}`, `Objetivo: ${goal}`, 'complex', signal);
    let plan: z.infer<typeof PlanSchema>;
    try {
      plan = PlanSchema.parse(extractJson(planText));
    } catch {
      // Plan ilegible: una sola subtarea con el agente más general.
      plan = { subtasks: [{ agent: enabled.some((a) => a.id === 'analista') ? 'analista' : enabled[0]!.id, title: goal.slice(0, 80), instructions: goal }] };
    }
    const subs = plan.subtasks.map((s, i) => {
      const def = enabled.find((a) => a.id === s.agent) ?? enabled.find((a) => a.id === 'analista') ?? enabled[0]!;
      return { id: randomUUID(), idx: i, def, title: s.title, instructions: s.instructions };
    });
    this.db.transaction(() => {
      for (const s of subs) this.db.prepare("INSERT INTO subtasks (id, task_id, idx, agent_id, title, instructions, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')").run(s.id, id, s.idx, s.def.id, s.title, s.instructions);
      this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    })();
    this.changed(id);

    // 2) Ejecución en orden; cada agente ve los resultados anteriores
    const done: { title: string; agent: string; result: string }[] = [];
    for (const s of subs) {
      if (signal.aborted) break;
      const result = await this.runSubtask(id, s.id, s.def, goal, s.instructions, done, signal);
      done.push({ title: s.title, agent: s.def.name, result });
    }
    if (signal.aborted) {
      this.db.prepare("UPDATE subtasks SET status = 'cancelled' WHERE task_id = ? AND status IN ('pending','running','waiting_approval')").run(id);
      return this.finish(id, 'cancelled', null, 'Cancelada por el usuario');
    }

    // 3) Síntesis del coordinador
    const summary = await this.ask(id, 'Eres el coordinador de JARVIS. Redacta para el usuario, en español de España y de forma clara, el resultado final del objetivo a partir de los resultados de los agentes. Señala con honestidad lo que no se pudo hacer y por qué.',
      `Objetivo: ${goal}\n\nResultados:\n${done.map((d, i) => `${i + 1}. ${d.title} (${d.agent}):\n${d.result}`).join('\n\n')}`, 'medium', signal);
    const failed = (this.db.prepare("SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ? AND status = 'failed'").get(id) as { n: number }).n;
    this.finish(id, failed === subs.length ? 'failed' : 'done', summary, failed ? `${failed} subtarea(s) fallaron` : null);
  }

  /** Llamada de texto del coordinador (sin herramientas). */
  private async ask(taskId: string, system: string, user: string, tier: 'simple' | 'medium' | 'complex', signal: AbortSignal): Promise<string> {
    const plan = this.ai.planTier(tier);
    if (!plan.candidates.length) throw new Error('No hay ningún modelo configurado (añade una clave en Configuración)');
    const history: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: user }] }];
    const r = await runAgentLoop(this.loopDeps, {
      plan, principal: { kind: 'agent', id: COORDINATOR_ID }, system, signal, maxSteps: 1, allowTool: () => false,
      history: { get: () => history, append: (m) => { history.push(m); } }, usageTag: `tarea:${taskId}`, emit: () => {}, context: {},
    });
    this.addCost(taskId, r.costUsd);
    if (r.stopReason === 'budget') throw new Error('Límite de gasto mensual alcanzado');
    return r.finalText;
  }

  private async runSubtask(taskId: string, subId: string, def: AgentDef, goal: string, instructions: string, prev: { title: string; agent: string; result: string }[], signal: AbortSignal): Promise<string> {
    const log: SubtaskLogEntry[] = [];
    const push = (kind: SubtaskLogEntry['kind'], text: string, approvalId?: string) => {
      log.push({ ts: new Date().toISOString(), kind, text, ...(approvalId ? { approvalId } : {}) });
      this.db.prepare('UPDATE subtasks SET log = ? WHERE id = ?').run(JSON.stringify(log.slice(-200)), subId);
      this.changed(taskId, subId);
    };
    const setStatus = (status: SubtaskStatus) => {
      this.db.prepare('UPDATE subtasks SET status = ? WHERE id = ?').run(status, subId);
      this.changed(taskId, subId, status);
    };
    this.db.prepare("UPDATE subtasks SET status = 'running', started_at = ? WHERE id = ?").run(new Date().toISOString(), subId);
    this.changed(taskId, subId, 'running');

    const ai = this.ai.budget.getSettings();
    const plan = this.ai.planTier(def.tier, { web: def.web, action: def.action });
    if (!plan.candidates.length) {
      this.db.prepare("UPDATE subtasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run('Sin modelo configurado', new Date().toISOString(), subId);
      return 'No se pudo ejecutar: no hay ningún modelo configurado.';
    }
    const context = prev.length ? `\n\nResultados previos del equipo:\n${prev.map((p) => `- ${p.title} (${p.agent}): ${p.result.slice(0, 3000)}`).join('\n')}` : '';
    const history: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: `Objetivo general: ${goal}\n\nTu subtarea: ${instructions}${context}` }] }];
    const emit = (e: ChatEvent) => {
      if (e.type === 'route') {
        this.db.prepare('UPDATE subtasks SET model = ? WHERE id = ?').run(e.model, subId);
        push('route', `${e.label}`);
      } else if (e.type === 'tool_call') push('tool', `${e.tool}`);
      else if (e.type === 'tool_result') push('tool', `${e.tool}: ${e.summary}`);
      else if (e.type === 'approval_required') { setStatus('waiting_approval'); push('approval', `Necesita tu permiso para ${e.tool}`, e.approvalId); }
      else if (e.type === 'warning') push('warning', e.message);
      else if (e.type === 'error') push('error', e.message);
      if (e.type === 'tool_result') setStatus('running');
    };
    try {
      const r = await runAgentLoop(this.loopDeps, {
        plan, principal: { kind: 'agent', id: def.id }, system: def.prompt, signal, maxSteps: SUBTASK_STEPS,
        allowTool: (name) => allowsTool(def, name),
        webSearch: def.web && ai.webSearch ? { maxUses: ai.webSearchMaxUses } : null,
        history: { get: () => history, append: (m) => { history.push(m); } }, usageTag: `tarea:${taskId}`, emit, context: { lastUserText: instructions },
      });
      this.addCost(taskId, r.costUsd, subId);
      const ok = r.stopReason !== 'budget' && r.stopReason !== 'refusal' && r.stopReason !== 'cancelled';
      const result = r.finalText || '(sin resultado)';
      this.db.prepare('UPDATE subtasks SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?')
        .run(signal.aborted ? 'cancelled' : ok ? 'done' : 'failed', result, ok ? null : r.stopReason, new Date().toISOString(), subId);
      this.changed(taskId, subId);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.prepare('UPDATE subtasks SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(signal.aborted ? 'cancelled' : 'failed', msg, new Date().toISOString(), subId);
      push('error', msg);
      return `No se pudo completar: ${msg}`;
    }
  }

  private addCost(taskId: string, usd: number, subId?: string) {
    this.db.prepare('UPDATE tasks SET cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?').run(usd, new Date().toISOString(), taskId);
    if (subId) this.db.prepare('UPDATE subtasks SET cost_usd = cost_usd + ? WHERE id = ?').run(usd, subId);
  }

  private finish(id: string, status: TaskStatus, result: string | null, error: string | null) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE tasks SET status = ?, result = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?').run(status, result, error, now, now, id);
    this.changed(id);
  }

  private changed(taskId: string, subtaskId?: string, subtaskStatus?: string) {
    const t = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined;
    this.bus.emit('task.updated', { taskId, status: t?.status ?? 'unknown', ...(subtaskId ? { subtaskId } : {}), ...(subtaskStatus ? { subtaskStatus } : {}) });
  }

  private view(r: TaskRow): TaskView {
    const subs = (this.db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY idx').all(r.id) as SubRow[]).map(toSub);
    return { id: r.id, title: r.title, goal: r.goal, status: r.status, result: r.result, error: r.error, costUsd: r.cost_usd, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at, subtasks: subs };
  }
}
