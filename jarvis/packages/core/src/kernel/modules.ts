import type { ModuleInfo, ModuleStatus } from '@jarvis/shared';
import type { EventBus } from './events';
import type { Logger } from './logger';
import type { JarvisConfig } from './config';
import type { Database } from '../storage/db';
import type { ToolRegistry } from '../tools/registry';
import type { PermissionEngine } from '../security/permissions';
import type { AuditLog } from '../security/audit';

export interface ModuleManifest {
  /** Identificador estable, en minúsculas: "system", "memory", "voice"... */
  id: string;
  name: string;
  version: string;
  description: string;
  /** Ids de módulos que deben arrancar antes que este. */
  dependsOn?: string[];
}

/** Servicios del núcleo disponibles para cada módulo. */
export interface ModuleContext {
  config: JarvisConfig;
  logger: Logger;
  bus: EventBus;
  db: Database;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  audit: AuditLog;
}

/** Contrato que implementa cualquier módulo (interno o extensión). */
export interface JarvisModule {
  manifest: ModuleManifest;
  start(ctx: ModuleContext): Promise<void> | void;
  stop?(): Promise<void> | void;
}

interface Entry {
  mod: JarvisModule;
  status: ModuleStatus;
  error: string | null;
}

export class ModuleRegistry {
  private entries = new Map<string, Entry>();
  private startOrder: string[] = [];

  constructor(private bus: EventBus, private logger: Logger) {}

  register(mod: JarvisModule): void {
    const { id } = mod.manifest;
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`Id de módulo no válido: "${id}"`);
    if (this.entries.has(id)) throw new Error(`Módulo duplicado: "${id}"`);
    this.entries.set(id, { mod, status: 'registered', error: null });
  }

  /** Orden topológico; lanza error ante dependencias ausentes o circulares. */
  resolveOrder(): string[] {
    const order: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, chain: string[]) => {
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`Dependencia ausente: "${id}" (requerida por ${chain.at(-1) ?? '?'})`);
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'visiting') throw new Error(`Dependencia circular: ${[...chain, id].join(' → ')}`);
      state.set(id, 'visiting');
      for (const dep of entry.mod.manifest.dependsOn ?? []) visit(dep, [...chain, id]);
      state.set(id, 'done');
      order.push(id);
    };
    for (const id of [...this.entries.keys()].sort()) visit(id, []);
    return order;
  }

  async startAll(ctx: ModuleContext): Promise<void> {
    this.startOrder = this.resolveOrder();
    for (const id of this.startOrder) {
      const entry = this.entries.get(id)!;
      const failedDep = (entry.mod.manifest.dependsOn ?? []).find((d) => this.entries.get(d)?.status !== 'running');
      if (failedDep) {
        this.setStatus(id, 'failed', `Dependencia no disponible: ${failedDep}`);
        continue;
      }
      this.setStatus(id, 'starting');
      try {
        await entry.mod.start({ ...ctx, logger: ctx.logger.child({ module: id }) });
        this.setStatus(id, 'running');
      } catch (err) {
        this.logger.error({ err, module: id }, 'Fallo al arrancar módulo');
        this.setStatus(id, 'failed', err instanceof Error ? err.message : String(err));
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.startOrder].reverse()) {
      const entry = this.entries.get(id)!;
      if (entry.status !== 'running') continue;
      try {
        await entry.mod.stop?.();
        this.setStatus(id, 'stopped');
      } catch (err) {
        this.logger.error({ err, module: id }, 'Fallo al detener módulo');
        this.setStatus(id, 'failed', err instanceof Error ? err.message : String(err));
      }
    }
  }

  list(): ModuleInfo[] {
    return [...this.entries.values()].map(({ mod, status, error }) => ({
      id: mod.manifest.id,
      name: mod.manifest.name,
      version: mod.manifest.version,
      description: mod.manifest.description,
      dependsOn: mod.manifest.dependsOn ?? [],
      status,
      error,
    }));
  }

  private setStatus(id: string, status: ModuleStatus, error: string | null = null) {
    const entry = this.entries.get(id)!;
    entry.status = status;
    entry.error = error;
    this.bus.emit('module.status', { id, status, error });
  }
}
