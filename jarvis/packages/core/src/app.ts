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
import { FileMasterKey, SecretVault, type MasterKeyProvider } from './security/vault';
import { AIService, type ProviderFactory, type ProviderId } from './ai/service';
import { ChatEngine } from './ai/engine';
import { ElevenLabsService } from './voice/elevenlabs';
import { ControlConfigStore } from './control/config';
import { controlModule } from './control/module';
import type { Platform } from './control/platform';
import { MemoryStore } from './memory/store';
import { LocalEmbedder, type Embedder } from './memory/embedder';
import { createMemoryTools } from './memory/tools';
import { TaskManager } from './agents/tasks';
import { createAgentTools } from './agents/tools';
import { ConnectorManager, type ConnectorDef } from './connectors/framework';
import { telegramConnector } from './connectors/telegram';
import { githubConnector } from './connectors/github';
import { netlifyConnector } from './connectors/netlify';
import { openshortsConnector } from './connectors/openshorts';
import { whatsappConnector } from './connectors/whatsapp';
import { resolveAuthorized } from './control/paths';
import { getSetting, setSetting } from './storage/db';
import { ConversationBusyError } from './ai/engine';

export const VERSION = '0.10.0';

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
  voice: ElevenLabsService;
  control: ControlConfigStore;
  memory: MemoryStore;
  tasks: TaskManager;
  connectors: ConnectorManager;
  /** Conversar con JARVIS desde un canal externo (Telegram, WhatsApp). */
  converse(text: string, channel: string): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Composición del núcleo: crea los servicios y registra los módulos incorporados. */
export function createJarvis(config: JarvisConfig, opts: { dbFile?: string; extraModules?: JarvisModule[]; providerFactory?: ProviderFactory; providerFactories?: Partial<Record<ProviderId, ProviderFactory>>; voiceBaseUrl?: string; platform?: Platform; masterKey?: MasterKeyProvider; embedder?: Embedder | null; connectors?: ConnectorDef[]; fetch?: typeof fetch } = {}): Jarvis {
  const logger = createLogger(config.logLevel);
  const bus = new EventBus((err, event) => logger.error({ err, event }, 'Error en suscriptor de evento'));
  const db = openDatabase(opts.dbFile ?? path.join(config.dataDir, 'jarvis.db'));
  const audit = new AuditLog(db, bus);
  const permissions = new PermissionEngine(db, audit, bus);
  const tools = new ToolRegistry(db, permissions, audit, bus);
  const modules = new ModuleRegistry(bus, logger);
  const vault = new SecretVault(db, opts.masterKey ?? new FileMasterKey(path.join(config.dataDir, 'vault.key')));
  const ai = new AIService(db, vault, audit, { ...(opts.providerFactory ? { anthropic: opts.providerFactory } : {}), ...opts.providerFactories });
  const voice = new ElevenLabsService(db, vault, audit, opts.voiceBaseUrl);
  ai.engine = new ChatEngine({ store: ai.store, budget: ai.budget, tools, audit, bus, logger, plan: (m) => ai.plan(m), markUnavailable: (c) => ai.markUnavailable(c),
    webSearch: () => { const s = ai.budget.getSettings(); return s.webSearch ? { maxUses: s.webSearchMaxUses } : null; } });
  const tasks = new TaskManager(db, ai, { budget: ai.budget, tools, audit, bus, markUnavailable: (c) => ai.markUnavailable(c) }, permissions, bus, logger);
  // Emergencia: corta cualquier respuesta y tarea de agentes en curso.
  bus.on('emergency.changed', ({ lockdown }) => {
    if (lockdown) {
      ai.engine.stopAll();
      tasks.cancelAll();
    }
  });

  const control = new ControlConfigStore(db, audit);
  modules.register(systemModule);
  modules.register(controlModule(control, config.dataDir, opts.platform));
  const memory = new MemoryStore(db, audit, opts.embedder === undefined ? new LocalEmbedder(config.dataDir) : opts.embedder);
  modules.register({
    manifest: { id: 'memory', name: 'Memoria', version: '0.8.0', description: 'Recuerdos con búsqueda híbrida (palabras, fragmentos y significado local).' },
    start(ctx) {
      for (const t of createMemoryTools(memory)) ctx.tools.register(t);
      for (const t of createAgentTools(tasks)) ctx.tools.register(t);
      memory.purgeExpired();
      const timer = setInterval(() => memory.purgeExpired(), 3600_000);
      timer.unref();
      // Si la búsqueda por significado estaba activada, cargar el modelo en segundo plano.
      if (memory.getSettings().semantic) void memory.enableSemantic().catch((err: unknown) => ctx.logger.warn({ err }, 'No se pudo cargar el modelo de significado'));
    },
  });
  for (const m of opts.extraModules ?? []) modules.register(m);

  // Canales externos: cada canal tiene su propia conversación persistente.
  async function converse(text: string, channel: string): Promise<string> {
    const key = `channel.${channel}.conversation`;
    let conversationId = getSetting(db, key);
    if (conversationId && !ai.store.exists(conversationId)) conversationId = undefined;
    let out = '';
    let approvals = 0;
    try {
      await ai.engine.run({ conversationId, message: text }, (e) => {
        if (e.type === 'start') setSetting(db, key, e.conversationId);
        else if (e.type === 'text') out += e.delta;
        else if (e.type === 'message_end') out += '\n';
        else if (e.type === 'approval_required') approvals++;
        else if (e.type === 'error') out += `\n⚠️ ${e.message}`;
      });
    } catch (err) {
      return err instanceof ConversationBusyError ? 'Sigo con tu mensaje anterior; espera a que termine.' : `⚠️ ${(err as Error).message}`;
    }
    const reply = out.replace(/\n{3,}/g, '\n\n').trim() || '(sin respuesta)';
    return approvals ? `${reply}\n\n(Hubo ${approvals} acción(es) que necesitaban tu confirmación en la app de JARVIS.)` : reply;
  }

  const connectors = new ConnectorManager(db, vault, audit, tools, logger, {
    logger, dataDir: config.dataDir, converse,
    secret: (name) => vault.get(name),
    lockdown: () => permissions.isLockdown(),
    resolvePath: (p, folderId) => resolveAuthorized(control.get().folders, p, folderId).abs,
    fetch: opts.fetch ?? ((...a) => fetch(...a)),
  });
  for (const c of opts.connectors ?? [whatsappConnector(), telegramConnector(), githubConnector(), netlifyConnector(), openshortsConnector()]) connectors.register(c);

  const core = { kind: 'core', id: 'kernel' } as const;
  return {
    version: VERSION, config, logger, bus, db, audit, permissions, tools, modules, vault, ai, voice, control, memory, tasks, connectors, converse,
    async start() {
      audit.append({ principal: core, action: 'core.start', outcome: 'success', details: { version: VERSION } });
      await modules.startAll({ config, logger, bus, db, tools, permissions, audit });
      await connectors.startEnabled();
      bus.emit('assistant.state', { state: 'idle' });
    },
    async stop() {
      await connectors.stopAll();
      await modules.stopAll();
      audit.append({ principal: core, action: 'core.stop', outcome: 'success' });
      db.close();
    },
  };
}
