import type {
  AiSettings,
  AiStatus,
  ChatEvent,
  ChatMessageView,
  ConversationSummary,
  ElevenLabsSettings,
  AgentInfo,
  ConnectorInfo,
  AutomationView,
  AutomationRunView,
  BackupSettings,
  BackupStatus,
  BackupView,
  DiagnosticsReport,
  SecurityAlert,
  TaskView,
  Memory,
  MemoryHit,
  MemoryInput,
  MemoryLink,
  MemorySettings,
  SemanticStatus,
  ElevenLabsVoice,
  VoiceStatus,
  ApprovalRequest,
  AuditEntry,
  GrantInfo,
  HealthResponse,
  Principal,
  ToolDescriptor,
  ToolResult,
} from '@jarvis/shared';
import { readStore, writeStore } from './storage';
import { desktop } from './desktop';
import { isNative } from './platform';

const TOKEN_KEY = 'jarvis.token';
const CORE_URL_KEY = 'jarvis.coreUrl';

export interface DeviceInfo { id: string; name: string; platform: string; createdAt: string; lastSeenAt: string | null; lastIp: string | null; push: boolean }
export interface RemoteStatus { mode: 'off' | 'lan'; port: number; listening: boolean; error: string | null; addresses: string[]; urls: string[]; publicUrl: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Cliente de la API del núcleo. El token local se guarda en este navegador.
 * En la app de escritorio (Fase 5) lo inyectará Electron y no habrá que escribirlo.
 */
export class CoreClient {
  // En la app de escritorio el token llega por el preload (nunca se guarda en el navegador).
  // En la app nativa la interfaz no la sirve el núcleo: su dirección se guarda al vincular.
  constructor(private base = isNative() ? readStore<string>(CORE_URL_KEY, '') : '', private token: string | null = desktop()?.token ?? readStore<string | null>(TOKEN_KEY, null)) {}

  get hasToken() {
    return !!this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (!desktop()) writeStore(TOKEN_KEY, token);
  }

  get baseUrl() {
    return this.base;
  }

  /** Dirección del núcleo (solo app nativa o pruebas); vacía = mismo origen. */
  setBase(url: string) {
    this.base = url.replace(/\/+$/, '');
    writeStore(CORE_URL_KEY, this.base);
  }

  eventsUrl(): string {
    const q = `/api/events?token=${encodeURIComponent(this.token ?? '')}`;
    if (/^https?:\/\//.test(this.base)) return `${this.base.replace(/^http/, 'ws')}${q}`;
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}${this.base}${q}`;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.body) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, 'No se puede contactar con el núcleo');
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* cuerpo vacío */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  }

  ping = () => this.req<{ pong: boolean; api: string }>('/api/ping');
  health = () => this.req<HealthResponse>('/api/health');
  tools = () => this.req<ToolDescriptor[]>('/api/tools');
  invoke = (tool: string, args: unknown = {}) =>
    this.req<ToolResult>('/api/tools/invoke', { method: 'POST', body: JSON.stringify({ tool, args }) });
  approvals = (status?: ApprovalRequest['status']) =>
    this.req<ApprovalRequest[]>(`/api/approvals${status ? `?status=${status}` : ''}`);
  resolveApproval = (id: string, decision: 'approved' | 'approved_always' | 'denied') =>
    this.req<ToolResult>(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
  grants = () => this.req<GrantInfo[]>('/api/permissions');
  revoke = (principal: Principal, scope?: string) =>
    this.req<{ removed: number }>('/api/permissions/revoke', { method: 'POST', body: JSON.stringify({ principal, scope }) });
  revokeAll = () => this.req<{ removed: number }>('/api/permissions/revoke-all', { method: 'POST', body: '{}' });
  audit = (limit = 50, before?: number) =>
    this.req<AuditEntry[]>(`/api/audit?limit=${limit}${before ? `&before=${before}` : ''}`);
  verifyAudit = () => this.req<{ ok: true; count: number } | { ok: false; brokenAt: number }>('/api/audit/verify');
  emergency = (lockdown: boolean) =>
    this.req<{ lockdown: boolean; cancelledApprovals: number }>('/api/emergency', {
      method: 'POST',
      body: JSON.stringify({ lockdown }),
    });

  // ── Cerebro IA ──
  aiStatus = () => this.req<AiStatus>('/api/ai/status');
  aiSettings = (patch: Partial<AiSettings>) => this.req<AiSettings>('/api/ai/settings', { method: 'PUT', body: JSON.stringify(patch) });
  setApiKey = (apiKey: string) => this.req<{ configured: boolean }>('/api/ai/key', { method: 'PUT', body: JSON.stringify({ apiKey }) });
  deleteApiKey = () => this.req<{ deleted: boolean }>('/api/ai/key', { method: 'DELETE' });
  setProviderKey = (provider: string, apiKey: string) => this.req<{ configured: boolean }>(`/api/ai/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ apiKey }) });
  deleteProviderKey = (provider: string) => this.req<{ deleted: boolean }>(`/api/ai/keys/${provider}`, { method: 'DELETE' });
  testProvider = (provider: string) => this.req<{ ok: boolean; detail: string }>(`/api/ai/test/${provider}`, { method: 'POST', body: '{}' });
  testAi = () => this.req<{ ok: boolean; detail: string }>('/api/ai/test', { method: 'POST', body: '{}' });
  conversations = () => this.req<ConversationSummary[]>('/api/conversations');
  conversation = (id: string) =>
    this.req<{ conversation: ConversationSummary; messages: ChatMessageView[]; active: boolean }>(`/api/conversations/${id}`);
  deleteConversation = (id: string) => this.req<{ deleted: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' });
  // ── Agentes y tareas ──
  agents = () => this.req<AgentInfo[]>('/api/agents');
  setAgentEnabled = (id: string, enabled: boolean) => this.req<{ enabled: boolean }>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  tasks = () => this.req<TaskView[]>('/api/tasks');
  createTask = (goal: string) => this.req<TaskView>('/api/tasks', { method: 'POST', body: JSON.stringify({ goal }) });
  cancelTask = (id: string) => this.req<{ cancelled: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST', body: '{}' });
  deleteTask = (id: string) => this.req<{ deleted: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });

  // ── Conectores ──
  connectors = () => this.req<ConnectorInfo[]>('/api/connectors');
  configureConnector = (id: string, values: Record<string, string>) => this.req<ConnectorInfo>(`/api/connectors/${id}`, { method: 'PUT', body: JSON.stringify(values) });
  enableConnector = (id: string) => this.req<{ ok: boolean; detail: string }>(`/api/connectors/${id}/enable`, { method: 'POST', body: '{}' });
  disableConnector = (id: string) => this.req<{ ok: boolean }>(`/api/connectors/${id}/disable`, { method: 'POST', body: '{}' });
  testConnector = (id: string) => this.req<{ ok: boolean; detail: string }>(`/api/connectors/${id}/test`, { method: 'POST', body: '{}' });
  deleteConnectorCredentials = (id: string) => this.req<{ ok: boolean }>(`/api/connectors/${id}/credentials`, { method: 'DELETE' });
  connectorAction = (id: string, action: string, body: Record<string, unknown> = {}) => this.req<Record<string, unknown>>(`/api/connectors/${id}/actions/${action}`, { method: 'POST', body: JSON.stringify(body) });

  // ── Dispositivos, push y acceso remoto ──
  me = () => this.req<{ kind: 'local' | 'device'; device: DeviceInfo | null }>('/api/me');
  pairStart = () => this.req<{ code: string; expiresAt: string; link: string | null; qr: string | null }>('/api/pair/start', { method: 'POST', body: '{}' });
  pairCancel = () => this.req<{ ok: boolean }>('/api/pair/cancel', { method: 'POST', body: '{}' });
  pairComplete = (code: string, name: string, platform: string) => this.req<{ deviceId: string; token: string }>('/api/pair/complete', { method: 'POST', body: JSON.stringify({ code, name, platform }) });
  devices = () => this.req<DeviceInfo[]>('/api/devices');
  revokeDevice = (id: string) => this.req<{ revoked: boolean }>(`/api/devices/${id}`, { method: 'DELETE' });
  pushKey = () => this.req<{ publicKey: string; subscriptions: number }>('/api/push/key');
  pushSubscribe = (sub: PushSubscriptionJSON) => this.req<{ subscribed: boolean }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
  pushUnsubscribe = (endpoint: string) => this.req<{ removed: boolean }>('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
  pushTest = () => this.req<{ sent: number; removed: number; failed: number }>('/api/push/test', { method: 'POST', body: '{}' });
  remote = () => this.req<RemoteStatus>('/api/remote');
  setRemote = (patch: Partial<Pick<RemoteStatus, 'mode' | 'port' | 'publicUrl'>>) => this.req<RemoteStatus>('/api/remote', { method: 'PUT', body: JSON.stringify(patch) });

  // ── Mantenimiento y seguridad avanzada ──
  backups = () => this.req<BackupStatus>('/api/backups');
  backupSettings = (patch: Partial<BackupSettings>) => this.req<BackupSettings>('/api/backups/settings', { method: 'PUT', body: JSON.stringify(patch) });
  backupPassphrase = (passphrase: string) => this.req<{ ok: boolean }>('/api/backups/passphrase', { method: 'PUT', body: JSON.stringify({ passphrase }) });
  backupSupabaseKey = (key: string | null) => this.req<{ ok: boolean }>('/api/backups/supabase-key', { method: 'PUT', body: JSON.stringify({ key }) });
  backupSupabaseTest = () => this.req<{ ok: boolean; detail: string }>('/api/backups/supabase-test', { method: 'POST', body: '{}' });
  createBackup = () => this.req<BackupView>('/api/backups', { method: 'POST', body: '{}' });
  verifyBackup = (id: string) => this.req<BackupView>(`/api/backups/${id}/verify`, { method: 'POST', body: '{}' });
  restoreBackup = (id: string, passphrase?: string) => this.req<{ detail: string; createdAt: string; jarvisVersion: string }>(`/api/backups/${id}/restore`, { method: 'POST', body: JSON.stringify(passphrase ? { passphrase } : {}) });
  cancelRestore = () => this.req<{ ok: boolean }>('/api/backups/restore/cancel', { method: 'POST', body: '{}' });
  deleteBackup = (id: string) => this.req<{ deleted: boolean }>(`/api/backups/${id}`, { method: 'DELETE' });
  diagnostics = () => this.req<DiagnosticsReport>('/api/diagnostics');
  cleanup = (vacuum: boolean) => this.req<Record<string, number>>('/api/maintenance/cleanup', { method: 'POST', body: JSON.stringify({ vacuum }) });
  updates = () => this.req<{ current: string; latest: string | null; newer: boolean; url: string | null; notes: string | null; detail: string }>('/api/updates');
  alerts = () => this.req<{ alerts: SecurityAlert[]; unacknowledged: number; autoLockdown: boolean }>('/api/security/alerts');
  ackAlerts = (id?: string) => this.req<{ acknowledged: number }>('/api/security/alerts/ack', { method: 'POST', body: JSON.stringify(id ? { id } : {}) });
  setAutoLockdown = (on: boolean) => this.req<{ autoLockdown: boolean }>('/api/security/auto-lockdown', { method: 'PUT', body: JSON.stringify({ on }) });

  // ── Automatizaciones ──
  automations = () => this.req<AutomationView[]>('/api/automations');
  automationRuns = (id: string) => this.req<AutomationRunView[]>(`/api/automations/${id}/runs`);
  automationScopes = (input: unknown) => this.req<{ scopes: string[] }>('/api/automations/scopes', { method: 'POST', body: JSON.stringify(input) });
  createAutomation = (input: unknown, enable = false) => this.req<AutomationView>('/api/automations', { method: 'POST', body: JSON.stringify({ ...(input as object), enable }) });
  updateAutomation = (id: string, input: unknown) => this.req<AutomationView>(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  setAutomationEnabled = (id: string, enabled: boolean) => this.req<AutomationView>(`/api/automations/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) });
  runAutomation = (id: string) => this.req<AutomationRunView | { started: true }>(`/api/automations/${id}/run`, { method: 'POST', body: '{}' });
  deleteAutomation = (id: string) => this.req<{ deleted: boolean }>(`/api/automations/${id}`, { method: 'DELETE' });

  // ── Memoria ──
  memories = (o: { q?: string; category?: string; status?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
    return this.req<{ items: MemoryHit[]; counts: Record<string, number> }>(`/api/memory?${p.toString()}`);
  };
  memory = (id: string) => this.req<{ memory: Memory; links: MemoryLink[] }>(`/api/memory/${id}`);
  createMemory = (m: MemoryInput) => this.req<Memory>('/api/memory', { method: 'POST', body: JSON.stringify(m) });
  updateMemory = (id: string, m: Partial<MemoryInput>) => this.req<Memory>(`/api/memory/${id}`, { method: 'PATCH', body: JSON.stringify(m) });
  confirmMemory = (id: string) => this.req<Memory>(`/api/memory/${id}/confirm`, { method: 'POST', body: '{}' });
  deleteMemory = (id: string) => this.req<{ deleted: boolean }>(`/api/memory/${id}`, { method: 'DELETE' });
  linkMemory = (fromId: string, toId: string, relation: string) => this.req<MemoryLink>('/api/memory/links', { method: 'POST', body: JSON.stringify({ fromId, toId, relation }) });
  unlinkMemory = (fromId: string, toId: string, relation: string) => this.req<{ removed: boolean }>('/api/memory/links', { method: 'DELETE', body: JSON.stringify({ fromId, toId, relation }) });
  memorySettings = () => this.req<{ settings: MemorySettings; semantic: SemanticStatus }>('/api/memory/settings');
  setMemorySettings = (p: Partial<MemorySettings>) => this.req<{ settings: MemorySettings; semantic: SemanticStatus }>('/api/memory/settings', { method: 'PUT', body: JSON.stringify(p) });
  loadSemantic = () => this.req<SemanticStatus>('/api/memory/semantic/load', { method: 'POST', body: '{}' });

  // ── Control del equipo ──
  control = () => this.req<{ folders: { id: string; label: string; path: string; access: 'read' | 'readwrite' }[]; apps: { id: string; name: string; command: string; args: string[]; processName?: string }[]; commands: { id: string; name: string; description: string; command: string; args: string[]; cwdFolderId?: string; timeoutSec: number }[] }>('/api/control/config');
  setControl = (cfg: unknown) => this.req<Awaited<ReturnType<CoreClient['control']>>>('/api/control/config', { method: 'PUT', body: JSON.stringify(cfg) });
  voiceEvent = (event: 'mic_on' | 'mic_off' | 'mic_denied' | 'handsfree_on' | 'handsfree_off' | 'wake_on' | 'wake_off' | 'wake_detected', processor?: string) =>
    this.req<{ ok: boolean }>('/api/voice/event', { method: 'POST', body: JSON.stringify({ event, processor }) });
  voiceStatus = () => this.req<VoiceStatus>('/api/voice/status');
  setElevenLabsKey = (apiKey: string) => this.req<{ configured: boolean }>('/api/voice/elevenlabs/key', { method: 'PUT', body: JSON.stringify({ apiKey }) });
  deleteElevenLabsKey = () => this.req<{ deleted: boolean }>('/api/voice/elevenlabs/key', { method: 'DELETE' });
  elevenLabsSettings = (patch: Partial<ElevenLabsSettings>) =>
    this.req<ElevenLabsSettings>('/api/voice/elevenlabs/settings', { method: 'PUT', body: JSON.stringify(patch) });
  elevenLabsVoices = () => this.req<ElevenLabsVoice[]>('/api/voice/elevenlabs/voices');
  stopChat = (id: string) => this.req<{ stopped: boolean }>(`/api/chat/${id}/stop`, { method: 'POST', body: '{}' });

  /** Envía un mensaje y entrega cada evento de la respuesta según llega (NDJSON). */
  async chat(body: { conversationId?: string; message: string }, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = res.statusText;
      try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* vacío */ }
      throw new ApiError(res.status, msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onEvent(JSON.parse(line) as ChatEvent);
      }
    }
  }
}

export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `${n.toFixed(4)} $` : `${n.toFixed(2)} $`;
}

export const core = new CoreClient();

/** Resultado de system.info (contrato de la herramienta). */
export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  cpu: { model: string; cores: number; usagePercent?: number; loadAvg: number[] };
  memory: { totalBytes: number; freeBytes: number };
  uptimeSec: number;
}

export function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d} d`, h && `${h} h`, `${m} min`].filter(Boolean).join(' ');
}
