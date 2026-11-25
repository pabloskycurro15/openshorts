import type {
  AiSettings,
  AiStatus,
  ChatEvent,
  ChatMessageView,
  ConversationSummary,
  ElevenLabsSettings,
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

const TOKEN_KEY = 'jarvis.token';

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
  constructor(private base = '', private token: string | null = desktop()?.token ?? readStore<string | null>(TOKEN_KEY, null)) {}

  get hasToken() {
    return !!this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (!desktop()) writeStore(TOKEN_KEY, token);
  }

  eventsUrl(): string {
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}${this.base}/api/events?token=${encodeURIComponent(this.token ?? '')}`;
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
  testAi = () => this.req<{ ok: boolean; detail: string }>('/api/ai/test', { method: 'POST', body: '{}' });
  conversations = () => this.req<ConversationSummary[]>('/api/conversations');
  conversation = (id: string) =>
    this.req<{ conversation: ConversationSummary; messages: ChatMessageView[]; active: boolean }>(`/api/conversations/${id}`);
  deleteConversation = (id: string) => this.req<{ deleted: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' });
  // ── Control del equipo ──
  control = () => this.req<{ folders: { id: string; label: string; path: string; access: 'read' | 'readwrite' }[]; apps: { id: string; name: string; command: string; args: string[]; processName?: string }[]; commands: { id: string; name: string; description: string; command: string; args: string[]; cwdFolderId?: string; timeoutSec: number }[] }>('/api/control/config');
  setControl = (cfg: unknown) => this.req<Awaited<ReturnType<CoreClient['control']>>>('/api/control/config', { method: 'PUT', body: JSON.stringify(cfg) });
  voiceEvent = (event: 'mic_on' | 'mic_off' | 'mic_denied' | 'handsfree_on' | 'handsfree_off', processor?: string) =>
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
