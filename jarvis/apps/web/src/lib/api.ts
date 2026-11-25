import type {
  ApprovalRequest,
  AuditEntry,
  GrantInfo,
  HealthResponse,
  Principal,
  ToolDescriptor,
  ToolResult,
} from '@jarvis/shared';
import { readStore, writeStore } from './storage';

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
  constructor(private base = '', private token: string | null = readStore<string | null>(TOKEN_KEY, null)) {}

  get hasToken() {
    return !!this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    writeStore(TOKEN_KEY, token);
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
  resolveApproval = (id: string, decision: 'approved' | 'denied') =>
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
}

export const core = new CoreClient();

/** Resultado de system.info (contrato de la herramienta). */
export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  cpu: { model: string; cores: number; loadAvg: number[] };
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
