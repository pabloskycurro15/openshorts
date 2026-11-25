import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  AutomationInput, type AutomationAction, type AutomationRunStatus, type AutomationRunView, type AutomationTrigger,
  type AutomationView, type Principal, type ToolResult,
} from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { EventBus } from '../kernel/events';
import type { Logger } from '../kernel/logger';
import type { AuditLog } from '../security/audit';
import type { PermissionEngine } from '../security/permissions';
import type { ToolRegistry } from '../tools/registry';
import type { AIService } from '../ai/service';
import { runAgentLoop, type LoopDeps } from '../ai/loop';
import type { ChatMessage } from '../ai/provider';

/** Herramientas que cualquier automatización puede usar sin elegirlas (inocuas). */
export const ALWAYS_ALLOWED = ['notify.send', 'system.datetime'];
const AI_MIN_INTERVAL = 30;
const GMAIL_POLL_MS = 5 * 60_000;
const AI_MAX_STEPS = 10;

const AUTOMATION_PROMPT = `Eres JARVIS ejecutando una automatización programada por el usuario, sin que esté delante.
- Cumple las instrucciones con las herramientas disponibles, de forma directa y sin preguntar.
- Si una herramienta es denegada, no la intentes por otra vía: explica en tu resultado qué faltó.
- Nunca envíes mensajes masivos ni publicidad no solicitada.
- Termina con un resumen breve (1-3 frases) de lo que hiciste. Responde en español.`;

type Row = {
  id: string; name: string; description: string; trigger: string; action: string; enabled: number; proposed: number; created_by: string;
  retries: number; max_runs_per_day: number; grants: string; state: string; next_run_at: string | null; created_at: string; updated_at: string;
};
type RunRow = {
  id: string; automation_id: string; attempt: number; trigger_label: string; event: string | null; status: AutomationRunStatus;
  started_at: string; finished_at: string | null; log: string; result: string | null; error: string | null; cost_usd: number;
};
interface State { gmailSeen?: string[]; gmailLastPoll?: number }

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());

/** Próxima ejecución programada (hora local), o null si el disparador no es de tiempo. */
export function computeNextRun(t: AutomationTrigger, now: Date, lastStart?: Date | null): Date | null {
  switch (t.type) {
    case 'daily': {
      const [h, m] = t.time.split(':').map(Number) as [number, number];
      for (let i = 0; i < 8; i++) {
        const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
        if (c > now && t.days.includes(isoDay(c))) return c;
      }
      return null;
    }
    case 'interval': {
      const base = lastStart ?? now;
      const next = new Date(base.getTime() + t.minutes * 60_000);
      return next > now ? next : new Date(now.getTime() + t.minutes * 60_000);
    }
    case 'once': {
      const d = new Date(`${t.at}:00`);
      return d > now ? d : null;
    }
    default:
      return null;
  }
}

export function describeTrigger(t: AutomationTrigger): string {
  const DAYS = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
  switch (t.type) {
    case 'daily': return t.days.length === 7 ? `Cada día a las ${t.time}` : `${t.days.map((d) => DAYS[d]).join(' ')} a las ${t.time}`;
    case 'interval': return t.minutes % 60 === 0 ? `Cada ${t.minutes / 60} h` : `Cada ${t.minutes} min`;
    case 'once': return `Una vez: ${t.at.replace('T', ' ')}`;
    case 'whatsapp': return `WhatsApp recibido${t.from ? ` de «${t.from}»` : ''}${t.contains ? ` que contenga «${t.contains}»` : ''}`;
    case 'gmail': return `Correo nuevo: ${t.query}`;
    case 'condition': return `${t.metric === 'cpu' ? 'CPU' : 'Memoria'} > ${t.above} % durante ${t.forMinutes} min`;
    case 'manual': return 'Solo manual';
  }
}

/** Sustituye {{event.campo}}, {{last}}, {{date}} y {{time}} en los argumentos de los pasos. */
export function renderTemplate(value: unknown, vars: { event: Record<string, unknown> | null; last: string; now: Date }): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g, (_m, key: string) => {
      if (key === 'last') return vars.last;
      if (key === 'date') return `${vars.now.getFullYear()}-${pad(vars.now.getMonth() + 1)}-${pad(vars.now.getDate())}`;
      if (key === 'time') return `${pad(vars.now.getHours())}:${pad(vars.now.getMinutes())}`;
      if (key.startsWith('event.')) {
        const v = vars.event?.[key.slice(6)];
        return v === undefined || v === null ? '' : String(v);
      }
      return '';
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, vars)]));
  return value;
}

const outputText = (r: ToolResult) => (r.status === 'ok' ? (typeof r.output === 'string' ? r.output : JSON.stringify(r.output ?? null)) : '');

/**
 * Automatizaciones: disparadores (hora, intervalo, una vez, WhatsApp, Gmail, condición del equipo)
 * y acciones (instrucciones para la IA o pasos fijos). Cada automatización actúa con su propia
 * identidad (automation:<id>) y solo con los permisos que el usuario le concede al activarla;
 * lo de riesgo alto o crítico pide confirmación igualmente. Historial completo de ejecuciones.
 */
export class AutomationManager {
  private timer: NodeJS.Timeout | null = null;
  private running = new Map<string, AbortController>();
  private cond = new Map<string, { since: number | null; fired: boolean }>();
  private cpuPrev: { idle: number; total: number } | null = null;
  private unsub: (() => void) | null = null;
  retryDelayMs = 60_000;

  constructor(
    private db: Database,
    private tools: ToolRegistry,
    private permissions: PermissionEngine,
    private audit: AuditLog,
    private bus: EventBus,
    private ai: AIService,
    private loopDeps: LoopDeps,
    private logger: Logger,
  ) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE automation_runs SET status = 'error', error = 'Interrumpida por un reinicio de JARVIS', finished_at = ? WHERE status IN ('running','waiting_approval')").run(now);
  }

  // ───────────── ciclo de vida ─────────────

  start(tickMs = 30_000) {
    this.unsub = this.bus.on('connector.event', (e) => { void this.onConnectorEvent(e.connector, e.event, e.data); });
    // Al arrancar se recalcula la próxima ejecución: lo perdido con JARVIS apagado no se recupera en bloque.
    for (const r of this.rows()) if (r.enabled) this.setNext(r.id, computeNextRun(this.parse(r).trigger, new Date()));
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsub?.();
    this.cancelAll();
  }

  cancelAll(): number {
    for (const c of this.running.values()) c.abort();
    return this.running.size;
  }

  // ───────────── CRUD (solo el usuario; JARVIS solo propone) ─────────────

  list(): AutomationView[] {
    return this.rows().map((r) => this.view(r));
  }

  get(id: string): AutomationView | undefined {
    const r = this.row(id);
    return r ? this.view(r) : undefined;
  }

  create(by: Principal, input: unknown): AutomationView {
    const a = this.validate(input);
    const proposed = by.kind !== 'user';
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automations (id, name, description, trigger, action, enabled, proposed, created_by, retries, max_runs_per_day, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .run(id, a.name, a.description, JSON.stringify(a.trigger), JSON.stringify(a.action), proposed ? 1 : 0, `${by.kind}:${by.id}`, a.retries, a.maxRunsPerDay, now, now);
    this.audit.append({ principal: by, action: proposed ? 'automation.propose' : 'automation.create', target: id, outcome: 'success', details: { name: a.name, trigger: a.trigger.type, mode: a.action.mode } });
    return this.get(id)!;
  }

  update(by: Principal, id: string, input: unknown): AutomationView {
    this.assertUser(by);
    const r = this.mustRow(id);
    const a = this.validate(input);
    this.db.prepare('UPDATE automations SET name = ?, description = ?, trigger = ?, action = ?, retries = ?, max_runs_per_day = ?, state = ?, updated_at = ? WHERE id = ?')
      .run(a.name, a.description, JSON.stringify(a.trigger), JSON.stringify(a.action), a.retries, a.maxRunsPerDay, '{}', new Date().toISOString(), id);
    this.audit.append({ principal: by, action: 'automation.update', target: id, outcome: 'success' });
    // Cambiar la automatización retira sus permisos: si estaba activa, se vuelven a conceder los nuevos.
    this.permissions.revoke(by, this.principal(id));
    this.setGrants(id, []);
    if (r.enabled) return this.setEnabled(by, id, true);
    return this.get(id)!;
  }

  /** Activar = el usuario revisa y concede los permisos que necesita. */
  setEnabled(by: Principal, id: string, enabled: boolean): AutomationView {
    this.assertUser(by);
    const r = this.mustRow(id);
    if (enabled && this.permissions.isLockdown()) throw new Error('Modo emergencia activo');
    if (enabled) {
      const scopes = this.requiredScopes(this.parse(r));
      for (const s of scopes) this.permissions.grant(by, this.principal(id), s, 'allow');
      this.setGrants(id, scopes);
      this.db.prepare('UPDATE automations SET enabled = 1, proposed = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      this.setNext(id, computeNextRun(this.parse(r).trigger, new Date()));
    } else {
      this.db.prepare('UPDATE automations SET enabled = 0, next_run_at = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      this.running.get(id)?.abort();
    }
    this.audit.append({ principal: by, action: enabled ? 'automation.enable' : 'automation.disable', target: id, outcome: 'success', details: { name: r.name } });
    return this.get(id)!;
  }

  delete(by: Principal, id: string): boolean {
    this.assertUser(by);
    const r = this.row(id);
    if (!r) return false;
    this.running.get(id)?.abort();
    this.permissions.revoke(by, this.principal(id));
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM automation_runs WHERE automation_id = ?').run(id);
    this.audit.append({ principal: by, action: 'automation.delete', target: id, outcome: 'success', details: { name: r.name } });
    return true;
  }

  runs(id: string, limit = 30): AutomationRunView[] {
    return (this.db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(id, limit) as RunRow[]).map(toRun);
  }

  /** Permisos que se conceden al activar: los de cada herramienta elegida y los del disparador. */
  requiredScopes(a: AutomationInput): string[] {
    const set = new Set<string>();
    const add = (tool: string, args?: unknown) => {
      const def = this.tools.get(tool);
      if (!def) throw new Error(`Herramienta desconocida: ${tool}`);
      if (typeof def.permissions === 'function') {
        try { for (const s of def.permissions(def.parameters.parse(args ?? {}))) set.add(s); } catch { /* se pedirá al ejecutar */ }
      } else for (const s of def.permissions) set.add(s);
    };
    if (a.action.mode === 'steps') for (const s of a.action.steps) add(s.tool, s.args);
    else for (const t of [...a.action.tools, ...ALWAYS_ALLOWED]) add(t);
    if (a.trigger.type === 'gmail') set.add('connector.google.gmail.read');
    return [...set];
  }

  // ───────────── disparadores ─────────────

  /** Comprobación periódica (pública para pruebas). */
  async tick(now = new Date()): Promise<void> {
    if (this.permissions.isLockdown()) return;
    const rows = this.rows().filter((r) => r.enabled);
    const cpu = rows.some((r) => this.parse(r).trigger.type === 'condition') ? this.sampleCpu() : null;
    for (const r of rows) {
      const a = this.parse(r);
      const t = a.trigger;
      if ((t.type === 'daily' || t.type === 'interval' || t.type === 'once') && r.next_run_at && new Date(r.next_run_at) <= now) {
        // Primero la próxima, para no repetir si la ejecución tarda.
        this.setNext(r.id, t.type === 'once' ? null : computeNextRun(t, now, t.type === 'interval' ? now : null));
        const run = this.trigger(r.id, describeTrigger(t), null);
        // «Una vez»: tras dispararse queda desactivada.
        if (t.type === 'once') void run.finally(() => this.db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run(r.id)).catch(() => undefined);
        else void run.catch(() => undefined);
      } else if (t.type === 'gmail') {
        await this.pollGmail(r, t.query, now);
      } else if (t.type === 'condition') {
        const value = t.metric === 'cpu' ? cpu : (1 - os.freemem() / os.totalmem()) * 100;
        if (value === null) continue;
        const c = this.cond.get(r.id) ?? { since: null, fired: false };
        if (value > t.above) {
          c.since ??= now.getTime();
          if (!c.fired && now.getTime() - c.since >= t.forMinutes * 60_000) {
            c.fired = true;
            void this.trigger(r.id, describeTrigger(t), { metric: t.metric, value: Math.round(value) });
          }
        } else {
          c.since = null;
          c.fired = false;
        }
        this.cond.set(r.id, c);
      }
    }
  }

  /** Para pruebas: valor de la métrica de condición inyectable. */
  sampleCpu: () => number | null = () => {
    const t = os.cpus().reduce((acc, c) => { const s = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: acc.idle + c.times.idle, total: acc.total + s }; }, { idle: 0, total: 0 });
    const prev = this.cpuPrev;
    this.cpuPrev = t;
    if (!prev || t.total === prev.total) return null;
    return (1 - (t.idle - prev.idle) / (t.total - prev.total)) * 100;
  };

  private async pollGmail(r: Row, query: string, now: Date) {
    const st = JSON.parse(r.state) as State;
    if (st.gmailLastPoll && now.getTime() - st.gmailLastPoll < GMAIL_POLL_MS) return;
    st.gmailLastPoll = now.getTime();
    const res = await this.tools.invoke(this.principal(r.id), 'gmail.search', { query, limit: 10 });
    if (res.status !== 'ok') {
      this.saveState(r.id, st);
      this.logger.warn({ automation: r.id, res }, 'No se pudo consultar Gmail');
      return;
    }
    const msgs = res.output as { id: string; from: string; subject: string; snippet: string; date: string }[];
    const first = !st.gmailSeen;
    const seen = new Set(st.gmailSeen ?? []);
    const fresh = msgs.filter((m) => !seen.has(m.id));
    st.gmailSeen = [...msgs.map((m) => m.id), ...(st.gmailSeen ?? [])].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 300);
    this.saveState(r.id, st);
    // La primera consulta solo toma nota de lo que ya había (no dispara por correos antiguos).
    if (first) return;
    for (const m of fresh.reverse()) void this.trigger(r.id, `Correo nuevo de ${m.from}`, { id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, date: m.date });
  }

  private async onConnectorEvent(connector: string, event: string, data: Record<string, unknown>) {
    if (connector !== 'whatsapp' || event !== 'message' || this.permissions.isLockdown()) return;
    for (const r of this.rows().filter((x) => x.enabled)) {
      const t = this.parse(r).trigger;
      if (t.type !== 'whatsapp') continue;
      const from = `${String(data.name ?? '')} ${String(data.from ?? '')}`.toLowerCase();
      if (t.from && !from.includes(t.from.toLowerCase())) continue;
      if (t.contains && !String(data.text ?? '').toLowerCase().includes(t.contains.toLowerCase())) continue;
      void this.trigger(r.id, `WhatsApp de ${String(data.name ?? data.from ?? '?')}`, data);
    }
  }

  // ───────────── ejecución ─────────────

  /** Ejecutar ahora (el usuario, desde la interfaz). */
  async runNow(by: Principal, id: string): Promise<AutomationRunView> {
    this.assertUser(by);
    const r = this.mustRow(id);
    if (this.permissions.isLockdown()) throw new Error('Modo emergencia activo');
    if (!r.enabled) throw new Error('Actívala antes para concederle sus permisos');
    return this.trigger(id, 'Ejecución manual', null);
  }

  async trigger(id: string, label: string, event: Record<string, unknown> | null, attempt = 1): Promise<AutomationRunView> {
    const r = this.mustRow(id);
    const runId = randomUUID();
    const now = new Date();
    const insert = (status: AutomationRunStatus, error: string | null) => {
      this.db.prepare('INSERT INTO automation_runs (id, automation_id, attempt, trigger_label, event, status, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(runId, id, attempt, label, event ? JSON.stringify(event) : null, status, now.toISOString(), status === 'running' ? null : now.toISOString(), error);
      this.bus.emit('automation.run', { automationId: id, runId, status, name: r.name });
      return this.run(runId)!;
    };
    if (this.permissions.isLockdown()) return insert('skipped', 'Modo emergencia activo');
    if (!r.enabled) return insert('skipped', 'Automatización desactivada');
    if (this.running.has(id)) return insert('skipped', 'La ejecución anterior aún no ha terminado');
    if (this.runsToday(id) >= r.max_runs_per_day) return insert('skipped', `Límite diario alcanzado (${r.max_runs_per_day})`);

    const ctrl = new AbortController();
    this.running.set(id, ctrl);
    insert('running', null);
    const a = this.parse(r);
    const log: AutomationRunView['log'] = [];
    const push = (level: AutomationRunView['log'][number]['level'], text: string) => {
      log.push({ ts: new Date().toISOString(), level, text: text.slice(0, 1000) });
      this.db.prepare('UPDATE automation_runs SET log = ? WHERE id = ?').run(JSON.stringify(log), runId);
    };
    const setStatus = (s: AutomationRunStatus) => {
      this.db.prepare('UPDATE automation_runs SET status = ? WHERE id = ?').run(s, runId);
      this.bus.emit('automation.run', { automationId: id, runId, status: s, name: r.name });
    };
    let status: AutomationRunStatus = 'ok';
    let result: string | null = null;
    let error: string | null = null;
    let cost = 0;
    let sideEffectsDone = false;
    push('info', `Disparador: ${label}`);
    try {
      if (a.action.mode === 'steps') {
        let last = '';
        for (const [i, step] of a.action.steps.entries()) {
          if (ctrl.signal.aborted) throw new Error('cancelled');
          const args = renderTemplate(step.args, { event, last, now: new Date() });
          push('tool', `Paso ${i + 1}: ${step.tool}`);
          let res = await this.tools.invoke(this.principal(id), step.tool, args, { interactive: true, signal: ctrl.signal });
          if (res.status === 'pending_approval') res = await this.awaitApproval(r.name, res.approvalId, setStatus, push, ctrl.signal);
          if (res.status !== 'ok') {
            status = res.status === 'denied' ? 'denied' : 'error';
            error = `Paso ${i + 1} (${step.tool}): ${res.status === 'denied' ? res.reason : res.status === 'error' ? res.error : 'sin resultado'}`;
            push(status === 'denied' ? 'warn' : 'error', error);
            break;
          }
          if (this.tools.get(step.tool)?.sideEffects) sideEffectsDone = true;
          last = outputText(res);
          push('info', `→ correcto${last ? `: ${last.slice(0, 200)}` : ''}`);
        }
        if (status === 'ok') result = last.slice(0, 4000) || 'Pasos completados';
      } else {
        const r2 = await this.runAi(id, a.action, event, label, ctrl.signal, push, setStatus, () => { sideEffectsDone = true; });
        cost = r2.cost;
        result = r2.text;
        if (r2.denied) { status = 'denied'; error = r2.denied; }
      }
    } catch (err) {
      if (ctrl.signal.aborted) { status = 'cancelled'; error = 'Cancelada'; }
      else { status = 'error'; error = err instanceof Error ? err.message : String(err); push('error', error); }
    } finally {
      this.running.delete(id);
    }
    this.db.prepare('UPDATE automation_runs SET status = ?, finished_at = ?, result = ?, error = ?, cost_usd = ? WHERE id = ?')
      .run(status, new Date().toISOString(), result, error, cost, runId);
    this.bus.emit('automation.run', { automationId: id, runId, status, name: r.name });
    this.audit.append({ principal: this.principal(id), action: 'automation.run', target: id, outcome: status === 'ok' ? 'success' : status === 'denied' ? 'denied' : 'failure', details: { status, attempt, costUsd: cost } });

    // Reintento seguro: solo si falló antes de hacer nada con efectos.
    if (status === 'error' && attempt <= r.retries && !sideEffectsDone && !this.permissions.isLockdown()) {
      const t = setTimeout(() => { void this.trigger(id, `${label} (reintento ${attempt})`, event, attempt + 1).catch(() => undefined); }, this.retryDelayMs * attempt);
      t.unref();
      this.push(runId, 'info', `Se reintentará en ${Math.round((this.retryDelayMs * attempt) / 1000)} s`);
    } else if (status === 'error' && sideEffectsDone) {
      this.push(runId, 'warn', 'Sin reintento: ya se había hecho alguna acción con efectos');
    }
    if (status === 'error' || status === 'denied') this.bus.emit('notification', { title: `Automatización «${r.name}»`, body: error ?? 'Falló', source: 'automation' });
    return this.run(runId)!;
  }

  private push(runId: string, level: 'info' | 'warn', text: string) {
    const run = this.run(runId);
    if (!run) return;
    this.db.prepare('UPDATE automation_runs SET log = ? WHERE id = ?').run(JSON.stringify([...run.log, { ts: new Date().toISOString(), level, text }]), runId);
  }

  private async awaitApproval(name: string, approvalId: string, setStatus: (s: AutomationRunStatus) => void, push: (l: 'warn', t: string) => void, signal: AbortSignal): Promise<ToolResult> {
    setStatus('waiting_approval');
    push('warn', 'Esperando tu confirmación en JARVIS');
    this.bus.emit('notification', { title: `«${name}» necesita tu confirmación`, body: 'Revísala en Seguridad y permisos o en el aviso de confirmación.', source: 'automation' });
    const r = await Promise.race([
      this.tools.waitForApproval(approvalId),
      new Promise<ToolResult>((resolve) => signal.addEventListener('abort', () => resolve({ status: 'denied', reason: 'Cancelada' }), { once: true })),
    ]);
    setStatus('running');
    return r;
  }

  private async runAi(id: string, action: Extract<AutomationAction, { mode: 'ai' }>, event: Record<string, unknown> | null, label: string, signal: AbortSignal,
    push: (l: AutomationRunView['log'][number]['level'], t: string) => void, setStatus: (s: AutomationRunStatus) => void, onSideEffect: () => void) {
    const message = `${action.instructions}\n\n[Disparador: ${label}]${event ? `\n[Datos del evento: ${JSON.stringify(event).slice(0, 4000)}]` : ''}\n[Fecha y hora: ${new Date().toLocaleString('es-ES')}]`;
    const plan = this.ai.plan(message);
    if (!plan.candidates.length) throw new Error('El cerebro no está configurado (falta una clave de IA)');
    const history: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: message }] }];
    const allowed = new Set([...action.tools, ...ALWAYS_ALLOWED]);
    let denied: string | null = null;
    let text = '';
    const r = await runAgentLoop(this.loopDeps, {
      plan, principal: this.principal(id), system: AUTOMATION_PROMPT,
      history: { get: () => history, append: (m) => { history.push(m); } },
      usageTag: `automatizacion:${id}`, signal, maxSteps: AI_MAX_STEPS,
      allowTool: (n) => allowed.has(n), webSearch: null, context: { lastUserText: action.instructions },
      emit: (e) => {
        if (e.type === 'text') text += e.delta;
        else if (e.type === 'message_end') text += '\n';
        else if (e.type === 'tool_call') push('tool', `${e.tool}`);
        else if (e.type === 'approval_required') { setStatus('waiting_approval'); push('warn', `Esperando tu confirmación: ${e.tool}`); this.bus.emit('notification', { title: 'Una automatización necesita tu confirmación', body: e.tool, source: 'automation' }); }
        else if (e.type === 'tool_result') {
          setStatus('running');
          push(e.status === 'ok' ? 'info' : 'warn', `${e.tool} → ${e.summary}`);
          if (e.status === 'ok' && this.tools.get(e.tool)?.sideEffects) onSideEffect();
          if (e.status === 'denied') denied ??= `${e.tool}: ${e.summary}`;
        } else if (e.type === 'warning') push('warn', e.message);
      },
    });
    const finalText = (r.finalText || text).trim();
    push('info', `Modelo ${r.model} · ${r.stopReason}`);
    return { text: finalText.slice(0, 4000) || '(sin texto)', cost: r.costUsd, denied };
  }

  // ───────────── utilidades ─────────────

  private principal(id: string): Principal {
    return { kind: 'automation', id };
  }

  private validate(input: unknown): AutomationInput {
    const a = AutomationInput.parse(input);
    if (a.action.mode === 'ai' && a.trigger.type === 'interval' && a.trigger.minutes < AI_MIN_INTERVAL) {
      throw new Error(`Con IA, el intervalo mínimo es ${AI_MIN_INTERVAL} min (cada ejecución cuesta)`);
    }
    const tools = a.action.mode === 'steps' ? a.action.steps.map((s) => s.tool) : a.action.tools;
    for (const t of tools) if (!this.tools.get(t)) throw new Error(`Herramienta desconocida: ${t}`);
    if (a.action.mode === 'ai' && tools.some((t) => t.startsWith('automations.') || t === 'agents.delegate')) throw new Error('Una automatización no puede crear automatizaciones ni encargar tareas');
    return a;
  }

  private assertUser(by: Principal) {
    if (by.kind !== 'user') {
      this.audit.append({ principal: by, action: 'permission.escalation_attempt', outcome: 'denied', details: { what: 'automations' } });
      throw new Error('Solo el usuario puede activar, cambiar, ejecutar o borrar automatizaciones');
    }
  }

  private rows(): Row[] {
    return this.db.prepare('SELECT * FROM automations ORDER BY created_at').all() as Row[];
  }
  private row(id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Row | undefined;
  }
  private mustRow(id: string): Row {
    const r = this.row(id);
    if (!r) throw new Error('Automatización inexistente');
    return r;
  }
  private run(id: string): AutomationRunView | undefined {
    const r = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as RunRow | undefined;
    return r ? toRun(r) : undefined;
  }
  private parse(r: Row): AutomationInput {
    return { name: r.name, description: r.description, trigger: JSON.parse(r.trigger) as AutomationTrigger, action: JSON.parse(r.action) as AutomationAction, retries: r.retries, maxRunsPerDay: r.max_runs_per_day };
  }
  private setNext(id: string, d: Date | null) {
    this.db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(d ? d.toISOString() : null, id);
  }
  private setGrants(id: string, scopes: string[]) {
    this.db.prepare('UPDATE automations SET grants = ? WHERE id = ?').run(JSON.stringify(scopes), id);
  }
  private saveState(id: string, st: State) {
    this.db.prepare('UPDATE automations SET state = ? WHERE id = ?').run(JSON.stringify(st), id);
  }
  private runsToday(id: string): number {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    return (this.db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE automation_id = ? AND started_at >= ? AND status <> 'skipped'").get(id, start) as { n: number }).n;
  }
  private view(r: Row): AutomationView {
    const last = this.db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(r.id) as RunRow | undefined;
    return {
      ...this.parse(r), id: r.id, enabled: !!r.enabled, proposed: !!r.proposed, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
      grants: JSON.parse(r.grants) as string[], nextRunAt: r.next_run_at, runsToday: this.runsToday(r.id), lastRun: last ? toRun(last) : null,
    };
  }
}

const toRun = (r: RunRow): AutomationRunView => ({
  id: r.id, automationId: r.automation_id, attempt: r.attempt, trigger: r.trigger_label, event: r.event ? (JSON.parse(r.event) as Record<string, unknown>) : null,
  status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, log: JSON.parse(r.log) as AutomationRunView['log'], result: r.result, error: r.error, costUsd: r.cost_usd,
});
