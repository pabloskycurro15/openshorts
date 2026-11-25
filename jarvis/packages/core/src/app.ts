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
import { googleConnector } from './connectors/google';
import { spotifyConnector } from './connectors/spotify';
import { vintedConnector } from './connectors/vinted';
import { AdobeBridge } from './connectors/adobe';
import { resolveAuthorized } from './control/paths';
import { getSetting, setSetting } from './storage/db';
import { ConversationBusyError } from './ai/engine';
import { AutomationManager } from './automations/manager';
import { createAutomationTools } from './automations/tools';
import { DeviceRegistry } from './security/devices';
import { PushService, type PushSender } from './notify/push';
import type { RemoteAccess } from './server/remote';
import { BackupManager, applyPendingRestore } from './maintenance/backup';
import { SecurityMonitor } from './security/monitor';
import { VideoStudio, createProgramTools } from './video/studio';
import { nodePlatform } from './control/platform';

export const VERSION = '0.15.0';

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
  automations: AutomationManager;
  devices: DeviceRegistry;
  push: PushService;
  backups: BackupManager;
  monitor: SecurityMonitor;
  video: VideoStudio;
  adobe: AdobeBridge;
  /** true si al arrancar se aplicó una restauración de copia de seguridad. */
  restored: boolean;
  /** Lo crea el servidor al escuchar (no existe en pruebas sin servidor). */
  remote?: RemoteAccess;
  /** Conversar con JARVIS desde un canal externo (Telegram, WhatsApp). */
  converse(text: string, channel: string): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Composición del núcleo: crea los servicios y registra los módulos incorporados. */
export function createJarvis(config: JarvisConfig, opts: { dbFile?: string; extraModules?: JarvisModule[]; providerFactory?: ProviderFactory; providerFactories?: Partial<Record<ProviderId, ProviderFactory>>; voiceBaseUrl?: string; platform?: Platform; masterKey?: MasterKeyProvider; embedder?: Embedder | null; connectors?: ConnectorDef[]; fetch?: typeof fetch; pushSender?: PushSender; pushAnyHost?: boolean } = {}): Jarvis {
  const logger = createLogger(config.logLevel);
  const bus = new EventBus((err, event) => logger.error({ err, event }, 'Error en suscriptor de evento'));
  const dbFile = opts.dbFile ?? path.join(config.dataDir, 'jarvis.db');
  const keys = opts.masterKey ?? new FileMasterKey(path.join(config.dataDir, 'vault.key'));
  // Restauración preparada desde Mantenimiento: se aplica antes de abrir la base de datos.
  const restored = dbFile !== ':memory:' && applyPendingRestore(config.dataDir, dbFile, keys, logger);
  const db = openDatabase(dbFile);
  const audit = new AuditLog(db, bus);
  const permissions = new PermissionEngine(db, audit, bus);
  const tools = new ToolRegistry(db, permissions, audit, bus);
  const modules = new ModuleRegistry(bus, logger);
  const vault = new SecretVault(db, keys);
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
    logger, dataDir: config.dataDir, converse, port: config.port, bus,
    secret: (name) => vault.get(name),
    lockdown: () => permissions.isLockdown(),
    resolvePath: (p, folderId) => resolveAuthorized(control.get().folders, p, folderId).abs,
    resolveWritable: (p, folderId) => {
      const r = resolveAuthorized(control.get().folders, p, folderId);
      if (r.folder.access !== 'readwrite') throw new Error(`La carpeta «${r.folder.label}» es de solo lectura`);
      return r.abs;
    },
    fetch: opts.fetch ?? ((...a) => fetch(...a)),
  });
  const automations = new AutomationManager(db, tools, permissions, audit, bus, ai, { budget: ai.budget, tools, audit, bus, markUnavailable: (c) => ai.markUnavailable(c) }, logger);
  for (const t of createAutomationTools(automations, bus)) tools.register(t);
  bus.on('emergency.changed', ({ lockdown }) => { if (lockdown) automations.cancelAll(); });
  const devices = new DeviceRegistry(db, audit);
  const push = new PushService(db, vault, logger, opts.pushSender, opts.pushAnyHost);
  // Avisos al móvil: notificaciones de automatizaciones y confirmaciones pendientes (solo título y herramienta).
  bus.on('notification', (n) => { void push.sendAll({ title: n.title, body: n.body, url: '/#/notificaciones', tag: 'aviso' }).catch(() => undefined); });
  bus.on('approval.requested', (a) => { void push.sendAll({ title: 'JARVIS necesita tu confirmación', body: `${a.tool} (riesgo ${a.risk})`, url: '/#/seguridad', tag: `aprobacion-${a.id}` }).catch(() => undefined); });
  const backups = new BackupManager(db, vault, keys, audit, bus, logger, config.dataDir, VERSION, opts.fetch);
  const monitor = new SecurityMonitor(db, bus, audit, permissions, tools);
  const video = new VideoStudio(db, () => control.get(), opts.platform ?? nodePlatform);
  for (const t of [...video.tools(), ...createProgramTools(video, opts.platform ?? nodePlatform)]) tools.register(t);
  const adobe = new AdobeBridge();
  for (const c of opts.connectors ?? [googleConnector(), spotifyConnector(), whatsappConnector(), telegramConnector(), githubConnector(), netlifyConnector(), openshortsConnector(), vintedConnector(), adobe.def()]) connectors.register(c);

  const core = { kind: 'core', id: 'kernel' } as const;
  return {
    version: VERSION, config, logger, bus, db, audit, permissions, tools, modules, vault, ai, voice, control, memory, tasks, connectors, automations, devices, push, backups, monitor, video, adobe, restored, converse,
    async start() {
      audit.append({ principal: core, action: 'core.start', outcome: 'success', details: { version: VERSION } });
      await modules.startAll({ config, logger, bus, db, tools, permissions, audit });
      await connectors.startEnabled();
      automations.start();
      backups.start();
      monitor.start();
      if (restored) audit.append({ principal: core, action: 'backup.restored', outcome: 'success' });
      bus.emit('assistant.state', { state: 'idle' });
    },
    async stop() {
      await this.remote?.close();
      automations.stop();
      backups.stop();
      monitor.stop();
      await connectors.stopAll();
      await modules.stopAll();
      audit.append({ principal: core, action: 'core.stop', outcome: 'success' });
      db.close();
    },
  };
}
