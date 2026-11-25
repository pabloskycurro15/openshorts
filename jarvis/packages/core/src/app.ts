import path from 'node:path';
import { EventBus } from './kernel/events';
import { ModuleRegistry, type JarvisModule } from './kernel/modules';
import { createLogger, type Logger } from './kernel/logger';
import type { JarvisConfig } from './kernel/config';
import { openDatabase, type Database } from './storage/db';
import { AuditLog } from './security/audit';
import { PermissionEngine } from './security/permissions';
import { ToolRegistry } from './tools/registry';
import { systemModule } from './tools/builtin/system';
import { FileMasterKey, SecretVault } from './security/vault';
import { AIService, type ProviderFactory } from './ai/service';
import { ChatEngine } from './ai/engine';

export const VERSION = '0.3.0';

export interface Jarvis {
  version: string;
  config: JarvisConfig;
  logger: Logger;
  bus: EventBus;
  db: Database;
  audit: AuditLog;
  permissions: PermissionEngine;
  tools: ToolRegistry;
  modules: ModuleRegistry;
  vault: SecretVault;
  ai: AIService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Composición del núcleo: crea los servicios y registra los módulos incorporados. */
export function createJarvis(config: JarvisConfig, opts: { dbFile?: string; extraModules?: JarvisModule[]; providerFactory?: ProviderFactory } = {}): Jarvis {
  const logger = createLogger(config.logLevel);
  const bus = new EventBus((err, event) => logger.error({ err, event }, 'Error en suscriptor de evento'));
  const db = openDatabase(opts.dbFile ?? path.join(config.dataDir, 'jarvis.db'));
  const audit = new AuditLog(db, bus);
  const permissions = new PermissionEngine(db, audit, bus);
  const tools = new ToolRegistry(db, permissions, audit, bus);
  const modules = new ModuleRegistry(bus, logger);
  const vault = new SecretVault(db, new FileMasterKey(path.join(config.dataDir, 'vault.key')));
  const ai = new AIService(db, vault, audit, opts.providerFactory);
  ai.engine = new ChatEngine({ store: ai.store, budget: ai.budget, tools, audit, bus, logger, getProvider: () => ai.getProvider() });
  // Emergencia: corta cualquier respuesta en curso.
  bus.on('emergency.changed', ({ lockdown }) => {
    if (lockdown) ai.engine.stopAll();
  });

  modules.register(systemModule);
  for (const m of opts.extraModules ?? []) modules.register(m);

  const core = { kind: 'core', id: 'kernel' } as const;
  return {
    version: VERSION, config, logger, bus, db, audit, permissions, tools, modules, vault, ai,
    async start() {
      audit.append({ principal: core, action: 'core.start', outcome: 'success', details: { version: VERSION } });
      await modules.startAll({ config, logger, bus, db, tools, permissions, audit });
      bus.emit('assistant.state', { state: 'idle' });
    },
    async stop() {
      await modules.stopAll();
      audit.append({ principal: core, action: 'core.stop', outcome: 'success' });
      db.close();
    },
  };
}
