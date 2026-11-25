import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApprovalRequest, Principal, RiskLevel, ToolDescriptor, ToolResult } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { EventBus } from '../kernel/events';
import type { PermissionEngine } from '../security/permissions';
import type { AuditLog } from '../security/audit';

export interface ToolContext {
  principal: Principal;
  signal: AbortSignal;
}

/** Definición de una herramienta. Toda acción de JARVIS sobre el mundo pasa por aquí. */
export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: S;
  /** Ámbitos necesarios; pueden depender de los argumentos (p. ej. la ruta). */
  permissions: string[] | ((args: z.infer<S>) => string[]);
  risk: RiskLevel;
  /** true si modifica algo fuera de JARVIS (archivos, mensajes, procesos...). */
  sideEffects: boolean;
  /** Riesgos concretos, mostrados al usuario al pedir confirmación. */
  risks: string[];
  /** Qué devuelve, en lenguaje natural. */
  returns: string;
  /**
   * Ámbitos que se conceden con «Aprobar siempre» (por defecto, los mismos que pide).
   * Permite conceder una carpeta entera en lugar de un archivo concreto.
   */
  grantScopes?: (args: z.infer<S>) => string[];
  execute(args: z.infer<S>, ctx: ToolContext): Promise<unknown> | unknown;
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

interface PendingCall {
  tool: ToolDefinition;
  args: unknown;
  scopes: string[];
  principal: Principal;
  timer: NodeJS.Timeout;
}

export interface InvokeOptions {
  signal?: AbortSignal;
  /** El usuario está presente y puede confirmar (conversación). Ver PermissionEngine. */
  interactive?: boolean;
}

export type ApprovalDecision = 'approved' | 'approved_always' | 'denied';

type ApprovalRow = {
  id: string; principal_kind: Principal['kind']; principal_id: string; tool: string; args: string; scopes: string;
  risk: RiskLevel; reason: string; status: ApprovalRequest['status']; created_at: string; resolved_at: string | null;
};

const toApproval = (r: ApprovalRow): ApprovalRequest => ({
  id: r.id,
  principal: { kind: r.principal_kind, id: r.principal_id },
  tool: r.tool,
  args: JSON.parse(r.args) as unknown,
  scopes: JSON.parse(r.scopes) as string[],
  risk: r.risk,
  reason: r.reason,
  status: r.status,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

/**
 * Registro de herramientas con validación de argumentos, comprobación de permisos,
 * cola de aprobaciones y auditoría. Ni la IA ni los agentes llaman a código
 * directamente: siempre invocan una herramienta registrada a través de invoke().
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private pending = new Map<string, PendingCall>();
  private results = new Map<string, ToolResult>();
  private waiters = new Map<string, ((r: ToolResult) => void)[]>();
  /** Aprobaciones ya decididas cuya ejecución aún no ha terminado. */
  private inflight = new Set<string>();

  constructor(
    private db: Database,
    private permissions: PermissionEngine,
    private audit: AuditLog,
    private bus: EventBus,
    private approvalTtlMs = 10 * 60_000,
  ) {
    // Las llamadas pendientes viven en memoria: tras un reinicio ya no se pueden ejecutar.
    this.db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending'`).run(new Date().toISOString());
  }

  register(def: ToolDefinition): void {
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(def.name)) throw new Error(`Nombre de herramienta no válido: "${def.name}"`);
    if (this.tools.has(def.name)) throw new Error(`Herramienta duplicada: "${def.name}"`);
    this.tools.set(def.name, def);
  }

  describe(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.parameters) as Record<string, unknown>,
      permissions: typeof t.permissions === 'function' ? ['(dinámico según argumentos)'] : t.permissions,
      risk: t.risk,
      sideEffects: t.sideEffects,
      risks: t.risks,
      returns: t.returns,
    }));
  }

  /** Busca una herramienta por nombre (para adaptadores de IA que necesitan su esquema). */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async invoke(principal: Principal, name: string, rawArgs: unknown, opts: InvokeOptions = {}): Promise<ToolResult> {
    const signal = opts.signal ?? new AbortController().signal;
    const tool = this.tools.get(name);
    if (!tool) return this.finish(principal, name, null, { status: 'error', error: `Herramienta desconocida: ${name}` });

    const parsed = tool.parameters.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return this.finish(principal, name, rawArgs, { status: 'error', error: `Argumentos no válidos: ${z.prettifyError(parsed.error)}` });
    }
    const args = parsed.data;
    // Calcular ámbitos puede fallar (p. ej. ruta fuera de las carpetas autorizadas): se rechaza sin preguntar.
    let scopes: string[];
    try {
      scopes = typeof tool.permissions === 'function' ? tool.permissions(args) : tool.permissions;
    } catch (err) {
      return this.finish(principal, name, args, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    const verdict = this.permissions.check({ principal, scopes, risk: tool.risk, sideEffects: tool.sideEffects, interactive: opts.interactive });

    if (verdict.decision === 'deny') return this.finish(principal, name, args, { status: 'denied', reason: verdict.reason });
    if (verdict.decision === 'ask') return this.requestApproval(principal, tool, args, scopes, verdict.reason);
    return this.run(principal, tool, args, signal);
  }

  listApprovals(status?: ApprovalRequest['status']): ApprovalRequest[] {
    const rows = (status
      ? this.db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
      : this.db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200').all()) as ApprovalRow[];
    return rows.map(toApproval);
  }

  getApproval(id: string): (ApprovalRequest & { result: ToolResult | null }) | undefined {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
    return row ? { ...toApproval(row), result: this.results.get(id) ?? null } : undefined;
  }

  /**
   * Espera a que una aprobación se resuelva (aprobada y ejecutada, denegada o caducada).
   * La usa la conversación para quedarse esperando mientras el usuario decide.
   */
  waitForApproval(id: string): Promise<ToolResult> {
    const done = this.results.get(id);
    if (done) return Promise.resolve(done);
    if (!this.pending.has(id) && !this.inflight.has(id)) return Promise.resolve({ status: 'denied', reason: 'Aprobación inexistente o caducada' });
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      list.push(resolve);
      this.waiters.set(id, list);
    });
  }

  /**
   * Solo el usuario resuelve aprobaciones. Si se aprueba, la herramienta se ejecuta.
   * "approved_always" además concede permanentemente los ámbitos al principal
   * (las operaciones de riesgo alto o crítico seguirán pidiendo confirmación).
   */
  async resolveApproval(by: Principal, id: string, decision: ApprovalDecision): Promise<ToolResult> {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede resolver aprobaciones');
    const call = this.pending.get(id);
    if (!call) throw new Error('Aprobación inexistente, ya resuelta o caducada');
    clearTimeout(call.timer);
    this.pending.delete(id);
    this.inflight.add(id);
    const approval = this.setApprovalStatus(id, decision === 'denied' ? 'denied' : 'approved');
    this.audit.append({ principal: by, action: `approval.${decision}`, target: call.tool.name, outcome: 'success', details: { approvalId: id } });
    if (decision === 'approved_always' && call.principal.kind !== 'user') {
      const toGrant = call.tool.grantScopes ? call.tool.grantScopes(call.args) : call.scopes;
      for (const scope of toGrant) this.permissions.grant(by, call.principal, scope, 'allow');
    }
    this.bus.emit('approval.resolved', approval);

    let result: ToolResult;
    if (decision === 'denied') {
      result = this.finish(call.principal, call.tool.name, call.args, { status: 'denied', reason: 'Denegado por el usuario' });
    } else {
      // El bloqueo de emergencia prevalece incluso sobre una aprobación concedida antes.
      if (call.tool.sideEffects && this.permissions.isLockdown()) {
        result = this.finish(call.principal, call.tool.name, call.args, { status: 'denied', reason: 'Modo emergencia activo' });
      } else {
        result = await this.run(call.principal, call.tool, call.args, new AbortController().signal);
      }
    }
    this.settle(id, result);
    return result;
  }

  private settle(id: string, result: ToolResult) {
    this.inflight.delete(id);
    this.results.set(id, result);
    for (const w of this.waiters.get(id) ?? []) w(result);
    this.waiters.delete(id);
  }

  /** Cancela todas las aprobaciones pendientes (panel de emergencia). */
  expireAllPending(): number {
    const ids = [...this.pending.keys()];
    for (const id of ids) this.expire(id);
    return ids.length;
  }

  private requestApproval(principal: Principal, tool: ToolDefinition, args: unknown, scopes: string[], reason: string): ToolResult {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO approvals (id, principal_kind, principal_id, tool, args, scopes, risk, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, principal.kind, principal.id, tool.name, JSON.stringify(args), JSON.stringify(scopes), tool.risk, reason, new Date().toISOString());
    const timer = setTimeout(() => this.expire(id), this.approvalTtlMs);
    timer.unref();
    this.pending.set(id, { tool, args, scopes, principal, timer });
    this.bus.emit('approval.requested', this.getApproval(id)!);
    return this.finish(principal, tool.name, args, { status: 'pending_approval', approvalId: id });
  }

  private expire(id: string) {
    const call = this.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
    this.bus.emit('approval.resolved', this.setApprovalStatus(id, 'expired'));
    this.settle(id, { status: 'denied', reason: 'La confirmación caducó o fue cancelada' });
  }

  private setApprovalStatus(id: string, status: ApprovalRequest['status']): ApprovalRequest {
    this.db.prepare('UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return this.getApproval(id)!;
  }

  private async run(principal: Principal, tool: ToolDefinition, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    try {
      const output = await tool.execute(args, { principal, signal });
      return this.finish(principal, tool.name, args, { status: 'ok', output });
    } catch (err) {
      return this.finish(principal, tool.name, args, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  private finish(principal: Principal, name: string, args: unknown, result: ToolResult): ToolResult {
    const outcome = ({ ok: 'success', error: 'failure', denied: 'denied', pending_approval: 'pending' } as const)[result.status];
    this.audit.append({
      principal,
      action: 'tool.invoke',
      target: name,
      outcome,
      details: { args, ...(result.status === 'ok' ? {} : result) },
    });
    this.bus.emit('tool.invoked', { tool: name, principal, outcome: result.status });
    return result;
  }
}
