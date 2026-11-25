import { randomUUID } from 'node:crypto';
import type { PermissionScope, PolicyDecision, Principal, RiskLevel } from '@jarvis/shared';
import { PermissionScope as ScopeSchema } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { AuditLog } from './audit';
import type { EventBus } from '../kernel/events';

export interface Grant {
  id: string;
  principal: Principal;
  scope: PermissionScope;
  mode: 'allow' | 'ask';
  grantedAt: string;
}

export interface PermissionCheck {
  principal: Principal;
  scopes: PermissionScope[];
  risk: RiskLevel;
  sideEffects: boolean;
}

export interface PermissionVerdict {
  decision: PolicyDecision;
  reason: string;
}

/**
 * ¿La concesión `granted` cubre el ámbito `requested`?
 *  - Coincidencia exacta.
 *  - Comodín final en la acción: "fs.*" cubre "fs.read:/x" y "fs.write".
 *  - Comodín final en el recurso: "fs.read:/home/a/*" cubre "fs.read:/home/a/b/c".
 * El recurso debe venir ya normalizado por la herramienta (rutas absolutas, sin "..").
 */
export function scopeMatches(granted: string, requested: string): boolean {
  if (granted === requested) return true;
  const [gAction, gRes] = splitScope(granted);
  const [rAction, rRes] = splitScope(requested);
  if (gRes === undefined) {
    // Concesión sin recurso: solo comodín de acción, cubre cualquier recurso.
    return gAction.endsWith('.*') && (rAction + '.').startsWith(gAction.slice(0, -1));
  }
  if (gAction !== rAction || rRes === undefined) return false;
  return gRes.endsWith('*') && rRes.startsWith(gRes.slice(0, -1));
}

function splitScope(s: string): [string, string | undefined] {
  const i = s.indexOf(':');
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

const LOCKDOWN_KEY = 'security.lockdown';

/**
 * Motor de permisos (mínimo privilegio):
 *  1. En modo emergencia (lockdown), toda operación con efectos se deniega.
 *  2. El usuario, actuando directamente, puede todo, pero lo de riesgo alto o
 *     crítico requiere confirmación explícita.
 *  3. Cualquier otro principal (agente, módulo, conector, automatización)
 *     necesita una concesión explícita para CADA ámbito; si falta alguna, se deniega.
 *  4. Aunque exista concesión "allow", el riesgo alto o crítico siempre pide confirmación.
 *  5. Solo el usuario puede conceder o revocar: nadie amplía sus propios permisos.
 */
export class PermissionEngine {
  constructor(private db: Database, private audit: AuditLog, private bus: EventBus) {}

  check(req: PermissionCheck): PermissionVerdict {
    if (req.sideEffects && this.isLockdown()) {
      return { decision: 'deny', reason: 'Modo emergencia activo: operaciones con efectos bloqueadas' };
    }
    if (req.principal.kind === 'user') {
      return req.risk === 'high' || req.risk === 'critical'
        ? { decision: 'ask', reason: `Operación de riesgo ${req.risk}: requiere confirmación` }
        : { decision: 'allow', reason: 'Acción directa del usuario' };
    }
    const grants = this.listGrants(req.principal);
    const highRisk = req.risk === 'high' || req.risk === 'critical';
    let needsAsk = highRisk;
    for (const scope of req.scopes) {
      const g = grants.find((gr) => scopeMatches(gr.scope, scope));
      if (!g) return { decision: 'deny', reason: `Sin permiso para "${scope}"` };
      if (g.mode === 'ask') needsAsk = true;
    }
    return needsAsk
      ? { decision: 'ask', reason: highRisk ? `Operación de riesgo ${req.risk}: requiere confirmación` : 'Concesión en modo "preguntar"' }
      : { decision: 'allow', reason: 'Concesión explícita' };
  }

  grant(by: Principal, to: Principal, scope: string, mode: 'allow' | 'ask' = 'allow'): Grant {
    this.assertUser(by, 'conceder permisos');
    ScopeSchema.parse(scope);
    if (to.kind === 'user') throw new Error('El usuario no necesita concesiones');
    const grant: Grant = { id: randomUUID(), principal: to, scope, mode, grantedAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO permission_grants (id, principal_kind, principal_id, scope, mode, granted_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(principal_kind, principal_id, scope) DO UPDATE SET mode = excluded.mode, granted_at = excluded.granted_at`,
      )
      .run(grant.id, to.kind, to.id, scope, mode, grant.grantedAt);
    this.audit.append({ principal: by, action: 'permission.grant', target: `${to.kind}:${to.id}`, outcome: 'success', details: { scope, mode } });
    return grant;
  }

  revoke(by: Principal, to: Principal, scope?: string): number {
    this.assertUser(by, 'revocar permisos');
    const res = scope
      ? this.db.prepare('DELETE FROM permission_grants WHERE principal_kind = ? AND principal_id = ? AND scope = ?').run(to.kind, to.id, scope)
      : this.db.prepare('DELETE FROM permission_grants WHERE principal_kind = ? AND principal_id = ?').run(to.kind, to.id);
    this.audit.append({ principal: by, action: 'permission.revoke', target: `${to.kind}:${to.id}`, outcome: 'success', details: { scope: scope ?? '*', removed: res.changes } });
    return res.changes;
  }

  /** Revoca todas las concesiones de todos los principales (panel de emergencia). */
  revokeAll(by: Principal): number {
    this.assertUser(by, 'revocar permisos');
    const res = this.db.prepare('DELETE FROM permission_grants').run();
    this.audit.append({ principal: by, action: 'permission.revoke_all', outcome: 'success', details: { removed: res.changes } });
    return res.changes;
  }

  listGrants(principal?: Principal): Grant[] {
    const rows = (principal
      ? this.db.prepare('SELECT * FROM permission_grants WHERE principal_kind = ? AND principal_id = ?').all(principal.kind, principal.id)
      : this.db.prepare('SELECT * FROM permission_grants ORDER BY granted_at').all()) as {
      id: string; principal_kind: Principal['kind']; principal_id: string; scope: string; mode: 'allow' | 'ask'; granted_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, principal: { kind: r.principal_kind, id: r.principal_id }, scope: r.scope, mode: r.mode, grantedAt: r.granted_at }));
  }

  isLockdown(): boolean {
    return getSetting(this.db, LOCKDOWN_KEY) === 'true';
  }

  setLockdown(by: Principal, lockdown: boolean): void {
    this.assertUser(by, 'cambiar el modo emergencia');
    setSetting(this.db, LOCKDOWN_KEY, String(lockdown));
    this.audit.append({ principal: by, action: 'security.lockdown', outcome: 'success', details: { lockdown } });
    this.bus.emit('emergency.changed', { lockdown, by });
  }

  private assertUser(by: Principal, what: string) {
    if (by.kind !== 'user') {
      this.audit.append({ principal: by, action: 'permission.escalation_attempt', outcome: 'denied', details: { what } });
      throw new Error(`Solo el usuario puede ${what}`);
    }
  }
}
