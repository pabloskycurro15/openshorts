import http from 'node:http';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { AuditLog } from '../security/audit';
import type { Logger } from '../kernel/logger';

export interface RemoteStatus {
  mode: 'off' | 'lan';
  port: number;
  listening: boolean;
  error: string | null;
  /** Direcciones de este equipo en la red local. */
  addresses: string[];
  urls: string[];
  /** Dirección HTTPS opcional (p. ej. Tailscale) que se usa en el QR de vinculación. */
  publicUrl: string | null;
}

export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * Acceso desde otros dispositivos. Por defecto el núcleo solo escucha en 127.0.0.1.
 * «Red local» abre un segundo puerto en todas las interfaces (mismo servidor y misma
 * autenticación: token o dispositivo vinculado). Para usarlo fuera de casa con HTTPS,
 * se recomienda Tailscale (`tailscale serve`), que no expone nada a Internet.
 */
export class RemoteAccess {
  private server: http.Server | null = null;
  private error: string | null = null;

  constructor(private app: FastifyInstance, private db: Database, private audit: AuditLog, private logger: Logger, private defaultPort: number) {}

  status(): RemoteStatus {
    const mode = (getSetting(this.db, 'remote.mode') as 'off' | 'lan' | undefined) ?? 'off';
    const port = Number(getSetting(this.db, 'remote.port') ?? this.defaultPort);
    const addresses = lanAddresses();
    return { mode, port, listening: !!this.server?.listening, error: this.error, addresses, urls: mode === 'lan' ? addresses.map((a) => `http://${a}:${port}`) : [], publicUrl: getSetting(this.db, 'remote.publicUrl') || null };
  }

  /** URL que se pone en el QR de vinculación (HTTPS pública si existe; si no, la de red local). */
  pairingBase(): string | null {
    const s = this.status();
    return s.publicUrl ?? s.urls[0] ?? null;
  }

  async configure(by: Principal, patch: { mode?: 'off' | 'lan'; port?: number; publicUrl?: string | null }): Promise<RemoteStatus> {
    if (by.kind !== 'user') throw new Error('Solo el usuario configura el acceso remoto');
    if (patch.publicUrl !== undefined) {
      if (patch.publicUrl && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(patch.publicUrl)) throw new Error('La dirección pública debe ser https://nombre (p. ej. la de Tailscale)');
      setSetting(this.db, 'remote.publicUrl', patch.publicUrl ? patch.publicUrl.replace(/\/$/, '') : '');
    }
    if (patch.port !== undefined) {
      if (!Number.isInteger(patch.port) || patch.port < 1024 || patch.port > 65535) throw new Error('Puerto no válido (1024-65535)');
      setSetting(this.db, 'remote.port', String(patch.port));
    }
    if (patch.mode) setSetting(this.db, 'remote.mode', patch.mode);
    this.audit.append({ principal: by, action: 'remote.configure', outcome: 'success', details: { mode: this.status().mode, port: this.status().port, publicUrl: !!this.status().publicUrl } });
    await this.apply();
    return this.status();
  }

  /** Aplica la configuración guardada (al arrancar y tras cambiarla). */
  async apply(): Promise<void> {
    await this.close();
    const { mode, port } = this.status();
    if (mode !== 'lan') return;
    const server = http.createServer((req, res) => this.app.routing(req, res));
    // WebSocket de eventos: la actualización de protocolo la atiende el servidor principal.
    server.on('upgrade', (req, socket, head) => this.app.server.emit('upgrade', req, socket, head));
    await new Promise<void>((resolve) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        this.error = err.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado` : err.message;
        this.logger.warn({ err }, 'No se pudo abrir el acceso en red local');
        resolve();
      });
      server.listen(port, '0.0.0.0', () => {
        this.error = null;
        this.server = server;
        this.logger.info({ port }, 'Acceso en red local activado');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => { s.close(() => r()); s.closeAllConnections(); });
  }
}
