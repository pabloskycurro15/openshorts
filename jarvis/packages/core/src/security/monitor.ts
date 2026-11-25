import { randomUUID } from 'node:crypto';
import type { AuditEntry, Principal, SecurityAlert } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { EventBus } from '../kernel/events';
import type { AuditLog } from './audit';
import type { PermissionEngine } from './permissions';
import type { ToolRegistry } from '../tools/registry';

type Row = { id: string; ts: string; level: SecurityAlert['level']; rule: string; title: string; detail: string; action: string | null; acknowledged: number };
const toAlert = (r: Row): SecurityAlert => ({ id: r.id, ts: r.ts, level: r.level, rule: r.rule, title: r.title, detail: r.detail, action: r.action, acknowledged: !!r.acknowledged });

/** Ventana deslizante de marcas de tiempo por clave. */
class Window {
  private m = new Map<string, number[]>();
  constructor(private ms: number) {}
  hit(key: string, now = Date.now()): number {
    const list = (this.m.get(key) ?? []).filter((t) => t > now - this.ms);
    list.push(now);
    this.m.set(key, list);
    return list.length;
  }
}

/**
 * Vigilancia de actividad sospechosa. Reglas sencillas y explicables:
 *  - Ráfaga de acciones con efectos de un agente o automatización (≥ 20/min) → crítica: modo emergencia automático.
 *  - Muchas denegaciones a un mismo principal (≥ 6 en 5 min) → aviso (puede estar «tanteando» permisos).
 *  - Intentos de escalada de privilegios → aviso.
 *  - Fallos de autenticación repetidos desde una IP (≥ 5 en 10 min) → aviso; ≥ 20 → crítica.
 *  - Envíos de mensajes/correos en volumen (≥ 10 en 10 min) → aviso.
 *  - Dispositivo nuevo vinculado / acceso en red local activado → información.
 *  - Registro de auditoría manipulado (comprobación cada hora) → crítica.
 * Cada alerta se guarda, se notifica (app, escritorio y push) y se puede revisar en Seguridad.
 */
export class SecurityMonitor {
  private burst = new Window(60_000);
  private denials = new Window(5 * 60_000);
  private authFails = new Window(10 * 60_000);
  private sends = new Window(10 * 60_000);
  private cooldown = new Map<string, number>();
  private offs: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private db: Database, private bus: EventBus, private audit: AuditLog, private permissions: PermissionEngine, private tools: ToolRegistry) {}

  autoLockdown(): boolean {
    return getSetting(this.db, 'security.autoLockdown') !== 'false';
  }

  setAutoLockdown(by: Principal, on: boolean) {
    if (by.kind !== 'user') throw new Error('Solo el usuario cambia esta opción');
    setSetting(this.db, 'security.autoLockdown', String(on));
    this.audit.append({ principal: by, action: 'security.auto_lockdown', outcome: 'success', details: { on } });
  }

  start(verifyEveryMs = 3600_000) {
    this.offs.push(this.bus.on('tool.invoked', (e) => this.onTool(e.tool, e.principal, e.outcome)));
    this.offs.push(this.bus.on('audit.appended', (e) => this.onAudit(e)));
    this.offs.push(this.bus.on('security.auth_failed', (e) => this.onAuthFail(e.ip)));
    this.timer = setInterval(() => this.checkAudit(), verifyEveryMs);
    this.timer.unref();
  }

  stop() {
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearInterval(this.timer);
  }

  list(limit = 100): SecurityAlert[] {
    return (this.db.prepare('SELECT * FROM security_alerts ORDER BY ts DESC LIMIT ?').all(limit) as Row[]).map(toAlert);
  }

  unacknowledged(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM security_alerts WHERE acknowledged = 0').get() as { n: number }).n;
  }

  acknowledge(by: Principal, id?: string): number {
    if (by.kind !== 'user') throw new Error('Solo el usuario revisa alertas');
    return id
      ? this.db.prepare('UPDATE security_alerts SET acknowledged = 1 WHERE id = ?').run(id).changes
      : this.db.prepare('UPDATE security_alerts SET acknowledged = 1 WHERE acknowledged = 0').run().changes;
  }

  checkAudit(): boolean {
    const v = this.audit.verify();
    if (!v.ok) this.raise('audit.tampered', 'critical', 'El registro de auditoría ha sido manipulado', `La cadena de integridad se rompe en el registro ${String((v as { brokenAt?: number }).brokenAt ?? '?')}. Alguien ha modificado la base de datos fuera de JARVIS.`, true);
    return v.ok;
  }

  private onTool(tool: string, p: Principal, outcome: string) {
    if (p.kind === 'user' || p.kind === 'core') return;
    const who = `${p.kind}:${p.id}`;
    if (outcome === 'denied' && this.denials.hit(who) >= 6) {
      this.raise(`denials:${who}`, 'warning', 'Muchas acciones denegadas', `${who} ha recibido 6 o más denegaciones en 5 minutos (la última: ${tool}). Puede estar intentando hacer algo que no debe.`);
    }
    const def = this.tools.get(tool);
    if (outcome === 'ok' && def?.sideEffects) {
      if (this.burst.hit(who) >= 20) {
        this.raise(`burst:${who}`, 'critical', 'Ráfaga de acciones con efectos', `${who} ha hecho 20 o más acciones con efectos en un minuto (la última: ${tool}).`, true);
      }
      if (/^(whatsapp|gmail|telegram)\.send$/.test(tool) && this.sends.hit('sends') >= 10) {
        this.raise('sends', 'warning', 'Muchos mensajes enviados', 'Se han enviado 10 o más mensajes/correos en 10 minutos.');
      }
    }
  }

  private onAudit(e: AuditEntry) {
    if (e.action === 'permission.escalation_attempt') {
      this.raise(`escalation:${e.principal.kind}:${e.principal.id}`, 'warning', 'Intento de ampliar permisos', `${e.principal.kind}:${e.principal.id} intentó una acción reservada al usuario (${JSON.stringify(e.details ?? {}).slice(0, 120)}).`);
    } else if (e.action === 'device.paired') {
      this.raise(`device:${e.target}`, 'info', 'Nuevo dispositivo vinculado', `«${String((e.details as { name?: string } | null)?.name ?? '?')}» desde ${String((e.details as { ip?: string } | null)?.ip ?? '?')}. Si no has sido tú, retíralo en Dispositivos.`);
    } else if (e.action === 'remote.configure' && (e.details as { mode?: string } | null)?.mode === 'lan') {
      this.raise('remote.lan', 'info', 'Acceso desde la red local activado', 'Otros dispositivos de tu Wi-Fi pueden intentar conectarse (necesitan estar vinculados).');
    }
  }

  private onAuthFail(ip: string) {
    const n = this.authFails.hit(ip);
    if (n === 5) this.raise(`auth:${ip}`, 'warning', 'Intentos de acceso fallidos', `5 intentos fallidos desde ${ip} en 10 minutos.`);
    if (n === 20) this.raise(`auth20:${ip}`, 'critical', 'Posible ataque de fuerza bruta', `20 intentos fallidos desde ${ip} en 10 minutos. La IP está bloqueada temporalmente.`);
  }

  /** Registra la alerta (una por regla cada 10 min) y, si es crítica y está permitido, activa el modo emergencia. */
  raise(rule: string, level: SecurityAlert['level'], title: string, detail: string, lockdown = false): SecurityAlert | null {
    const now = Date.now();
    if ((this.cooldown.get(rule) ?? 0) > now - 10 * 60_000) return null;
    this.cooldown.set(rule, now);
    let action: string | null = null;
    if (lockdown && level === 'critical' && this.autoLockdown() && !this.permissions.isLockdown()) {
      this.permissions.setLockdown({ kind: 'user', id: 'owner' }, true);
      action = 'Modo emergencia activado automáticamente';
    }
    const a: SecurityAlert = { id: randomUUID(), ts: new Date(now).toISOString(), level, rule: rule.split(':')[0]!, title, detail, action, acknowledged: false };
    this.db.prepare('INSERT INTO security_alerts (id, ts, level, rule, title, detail, action) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a.id, a.ts, a.level, a.rule, a.title, a.detail, a.action);
    this.bus.emit('security.alert', a);
    if (level !== 'info') this.bus.emit('notification', { title: `⚠ ${title}`, body: action ? `${detail} ${action}.` : detail, source: 'security' });
    return a;
  }
}
