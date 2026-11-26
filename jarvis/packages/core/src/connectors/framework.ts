import type { ConnectorInfo, Principal, SecurityAlert } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { SecretVault } from '../security/vault';
import type { AuditLog } from '../security/audit';
import type { Logger } from '../kernel/logger';
import type { ToolDefinition, ToolRegistry } from '../tools/registry';
import type { EventBus } from '../kernel/events';

export interface FieldDef { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string; default?: string }

/** Servicios que el núcleo ofrece a cada conector. */
export interface ConnectorCtx {
  id: string;
  get(field: string): string | undefined;
  /** Secreto de otro módulo (p. ej. la clave de Gemini para OpenShorts). */
  secret(name: string): string | null;
  set(field: string, value: string): void;
  /** Secretos propios del conector que no son campos (p. ej. el token de actualización OAuth). */
  getSecret(key: string): string | null;
  setSecret(key: string, value: string | null): void;
  /** Dirección local del núcleo (para redirecciones OAuth). */
  baseUrl(): string;
  log(operation: string, outcome: 'ok' | 'error' | 'info', detail: string): void;
  logger: Logger;
  dataDir: string;
  /** Conversar con JARVIS desde un canal externo (Telegram, WhatsApp). Devuelve la respuesta. */
  converse(text: string, channel: string, onEvent?: (e: import('@jarvis/shared').ChatEvent) => void): Promise<string>;
  lockdown(): boolean;
  /** Publica un evento del conector (p. ej. WhatsApp recibido) para las automatizaciones. */
  emit(event: string, data: Record<string, unknown>): void;
  /** Resolver una ruta dentro de las carpetas autorizadas. */
  resolvePath(path: string, folderId?: string): string;
  /** Igual, pero exige una carpeta con escritura. */
  resolveWritable(path: string, folderId?: string): string;
  fetch: typeof fetch;
}

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  /** API oficial y admitida por el servicio. */
  official: boolean;
  warning?: string;
  docsUrl: string;
  fields: FieldDef[];
  tools(ctx: ConnectorCtx): ToolDefinition[];
  test(ctx: ConnectorCtx): Promise<{ ok: boolean; detail: string }>;
  start?(ctx: ConnectorCtx): Promise<void>;
  stop?(): Promise<void>;
  status?(ctx: ConnectorCtx): Record<string, unknown>;
  /** Acciones del usuario desde la interfaz (emparejar, autorizar un chat, cerrar sesión...). */
  actions?: Record<string, (ctx: ConnectorCtx, body: Record<string, unknown>) => Promise<unknown>>;
  /** Secretos extra que se borran con «Borrar credenciales». */
  secretKeys?: string[];
  /** Vuelta del navegador tras autorizar (OAuth). Devuelve un mensaje para el usuario. */
  oauthCallback?(ctx: ConnectorCtx, query: Record<string, string>): Promise<string>;
  /** Reacción a una alerta de seguridad (p. ej. llamar por teléfono si es crítica). */
  onSecurityAlert?(ctx: ConnectorCtx, alert: SecurityAlert): Promise<void>;
}

/** Nombre corto de la operación para el registro («github.repos» → «repos»; «gmail.send» en google → «gmail.send»). */
export const opName = (connectorId: string, tool: string) => (tool.startsWith(`${connectorId}.`) ? tool.slice(connectorId.length + 1) : tool);

/**
 * Centro de conectores: cada conector es una extensión con su manifiesto, campos de
 * configuración (los secretos, cifrados en el almacén), herramientas que solo existen
 * mientras está activado, y registro de actividad y errores. Solo el usuario los
 * configura y activa (la activación es su aprobación explícita).
 */
export class ConnectorManager {
  private defs = new Map<string, ConnectorDef>();
  private running = new Set<string>();
  private url: string;

  constructor(
    private db: Database,
    private vault: SecretVault,
    private audit: AuditLog,
    private tools: ToolRegistry,
    private logger: Logger,
    private base: Omit<ConnectorCtx, 'id' | 'get' | 'set' | 'log' | 'secret' | 'getSecret' | 'setSecret' | 'baseUrl' | 'emit'> & { secret(name: string): string | null; port: number; bus: EventBus },
  ) {
    this.url = `http://127.0.0.1:${base.port}`;
  }

  /** La fija el servidor al escuchar (el puerto real puede ser efímero). */
  setBaseUrl(url: string) {
    this.url = url.replace('://0.0.0.0', '://127.0.0.1').replace('://localhost', '://127.0.0.1').replace(/\/+$/, '');
  }

  register(def: ConnectorDef) {
    if (this.defs.has(def.id)) throw new Error(`Conector duplicado: ${def.id}`);
    this.defs.set(def.id, def);
    const ctx = this.ctx(def);
    for (const t of def.tools(ctx)) {
      const op = opName(def.id, t.name);
      this.tools.register({
        ...t,
        available: () => this.isEnabled(def.id),
        execute: async (args, tctx) => {
          try {
            const out = await t.execute(args, tctx);
            this.log(def.id, op, 'ok', `${tctx.principal.kind}:${tctx.principal.id}`);
            return out;
          } catch (err) {
            this.log(def.id, op, 'error', err instanceof Error ? err.message : String(err));
            throw err;
          }
        },
      });
    }
  }

  private ctx(def: ConnectorDef): ConnectorCtx {
    return {
      ...this.base,
      id: def.id,
      get: (field) => {
        const f = def.fields.find((x) => x.key === field);
        if (f?.secret) return this.vault.get(`connector.${def.id}.${field}`) ?? undefined;
        return this.config(def.id)[field] ?? f?.default;
      },
      set: (field, value) => this.setConfig(def.id, { [field]: value }),
      getSecret: (key) => this.vault.get(`connector.${def.id}.${key}`),
      setSecret: (key, value) => { if (value === null) this.vault.delete(`connector.${def.id}.${key}`); else this.vault.set(`connector.${def.id}.${key}`, value); },
      baseUrl: () => this.url,
      log: (op, outcome, detail) => this.log(def.id, op, outcome, detail),
      emit: (event, data) => this.base.bus.emit('connector.event', { connector: def.id, event, data }),
    };
  }

  private config(id: string): Record<string, string> {
    const raw = getSetting(this.db, `connector.${id}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }

  private setConfig(id: string, patch: Record<string, string>) {
    setSetting(this.db, `connector.${id}`, JSON.stringify({ ...this.config(id), ...patch }));
  }

  isEnabled(id: string): boolean {
    return this.config(id).__enabled === 'true';
  }

  configure(by: Principal, id: string, values: Record<string, string>) {
    if (by.kind !== 'user') throw new Error('Solo el usuario configura conectores');
    const def = this.get(id);
    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const f = def.fields.find((x) => x.key === k);
      if (!f) throw new Error(`Campo desconocido: ${k}`);
      const val = String(v).trim();
      if (f.secret) {
        if (val) this.vault.set(`connector.${id}.${k}`, val);
      } else plain[k] = val;
    }
    this.setConfig(id, plain);
    this.audit.append({ principal: by, action: 'connector.configure', target: id, outcome: 'success', details: { fields: Object.keys(values) } });
  }

  async enable(by: Principal, id: string): Promise<{ ok: boolean; detail: string }> {
    if (by.kind !== 'user') throw new Error('Solo el usuario activa conectores');
    const def = this.get(id);
    const ctx = this.ctx(def);
    const missing = def.fields.filter((f) => f.required && !ctx.get(f.key));
    if (missing.length) return { ok: false, detail: `Faltan datos: ${missing.map((f) => f.label).join(', ')}` };
    const t = await def.test(ctx).catch((err: Error) => ({ ok: false, detail: err.message }));
    if (!t.ok) {
      this.log(id, 'activar', 'error', t.detail);
      return t;
    }
    this.setConfig(id, { __enabled: 'true' });
    this.audit.append({ principal: by, action: 'connector.enable', target: id, outcome: 'success', details: { official: def.official } });
    this.log(id, 'activar', 'info', t.detail);
    await this.startOne(def);
    return t;
  }

  async disable(by: Principal, id: string) {
    if (by.kind !== 'user' && by.kind !== 'core') throw new Error('Solo el usuario desactiva conectores');
    const def = this.get(id);
    this.setConfig(id, { __enabled: 'false' });
    if (this.running.has(id)) {
      this.running.delete(id);
      await def.stop?.().catch(() => undefined);
    }
    this.audit.append({ principal: by, action: 'connector.disable', target: id, outcome: 'success' });
    this.log(id, 'desactivar', 'info', 'Desactivado');
  }

  async disableAll(by: Principal) {
    for (const id of this.defs.keys()) if (this.isEnabled(id)) await this.disable(by, id);
  }

  async deleteCredentials(by: Principal, id: string) {
    if (by.kind !== 'user') throw new Error('Solo el usuario borra credenciales');
    const def = this.get(id);
    await this.disable(by, id);
    for (const f of def.fields) if (f.secret) this.vault.delete(`connector.${id}.${f.key}`);
    for (const k of def.secretKeys ?? []) this.vault.delete(`connector.${id}.${k}`);
    this.audit.append({ principal: by, action: 'connector.credentials.delete', target: id, outcome: 'success' });
  }

  /** Arranca los conectores que estaban activados (al iniciar JARVIS). */
  async startEnabled() {
    for (const def of this.defs.values()) if (this.isEnabled(def.id)) await this.startOne(def);
  }

  async stopAll() {
    for (const id of [...this.running]) await this.defs.get(id)?.stop?.().catch(() => undefined);
    this.running.clear();
  }

  private async startOne(def: ConnectorDef) {
    if (!def.start || this.running.has(def.id)) return;
    this.running.add(def.id);
    try {
      await def.start(this.ctx(def));
    } catch (err) {
      this.running.delete(def.id);
      this.log(def.id, 'arrancar', 'error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Acción solicitada por el usuario desde la interfaz. */
  async action(by: Principal, id: string, name: string, body: Record<string, unknown>): Promise<unknown> {
    if (by.kind !== 'user') throw new Error('Solo el usuario ejecuta acciones de conectores');
    const def = this.get(id);
    const fn = def.actions?.[name];
    if (!fn) throw new Error(`Acción desconocida: ${name}`);
    this.audit.append({ principal: by, action: `connector.action.${name}`, target: id, outcome: 'success' });
    return fn(this.ctx(def), body);
  }

  /** Vuelta de OAuth: sin token de JARVIS (la hace el navegador), protegida por «state» de un solo uso. */
  async oauthCallback(id: string, query: Record<string, string>): Promise<string> {
    const def = this.get(id);
    if (!def.oauthCallback) throw new Error('Este conector no usa OAuth');
    try {
      const msg = await def.oauthCallback(this.ctx(def), query);
      this.audit.append({ principal: { kind: 'user', id: 'owner' }, action: 'connector.oauth', target: id, outcome: 'success' });
      this.log(id, 'autorizar', 'info', msg);
      return msg;
    } catch (err) {
      this.log(id, 'autorizar', 'error', (err as Error).message);
      throw err;
    }
  }

  /** Reparte una alerta de seguridad a los conectores activados que la atienden. */
  notifyAlert(alert: SecurityAlert) {
    for (const def of this.defs.values()) {
      if (def.onSecurityAlert && this.isEnabled(def.id)) void def.onSecurityAlert(this.ctx(def), alert).catch(() => undefined);
    }
  }

  async test(id: string) {
    const def = this.get(id);
    return def.test(this.ctx(def)).catch((err: Error) => ({ ok: false, detail: err.message }));
  }

  log(id: string, operation: string, outcome: 'ok' | 'error' | 'info', detail: string) {
    this.db.prepare('INSERT INTO connector_log (ts, connector, operation, outcome, detail) VALUES (?, ?, ?, ?, ?)').run(new Date().toISOString(), id, operation, outcome, detail.slice(0, 500));
  }

  list(): ConnectorInfo[] {
    return [...this.defs.values()].map((def) => {
      const ctx = this.ctx(def);
      const tools = def.tools(ctx);
      const ops = tools.map((t) => opName(def.id, t.name));
      // Estadísticas de uso: solo operaciones de herramientas (no activaciones ni conexiones).
      const st = this.db.prepare(`SELECT COUNT(*) AS calls, SUM(outcome = 'error') AS errors, MAX(ts) AS last FROM connector_log WHERE connector = ? AND operation IN (${ops.map(() => '?').join(',') || "''"})`).get(def.id, ...ops) as { calls: number; errors: number | null; last: string | null };
      const recent = this.db.prepare('SELECT ts, operation, outcome, detail FROM connector_log WHERE connector = ? ORDER BY id DESC LIMIT 8').all(def.id) as ConnectorInfo['recent'];
      return {
        id: def.id, name: def.name, description: def.description, official: def.official, warning: def.warning ?? null, docsUrl: def.docsUrl,
        fields: def.fields.map((f) => ({ key: f.key, label: f.label, secret: f.secret, required: f.required, placeholder: f.placeholder, help: f.help, configured: !!ctx.get(f.key), ...(f.secret ? {} : { value: ctx.get(f.key) ?? '' }) })),
        enabled: this.isEnabled(def.id),
        status: def.status?.(ctx) ?? {},
        operations: tools.map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
        stats: { calls: st.calls, errors: st.errors ?? 0, lastUsed: st.last },
        recent,
      };
    });
  }

  private get(id: string): ConnectorDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`Conector desconocido: ${id}`);
    return d;
  }
}
