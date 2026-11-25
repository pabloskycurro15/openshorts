import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { AuditLog } from './audit';

/** Sin caracteres ambiguos (0/O, 1/I/L) para dictarlo o teclearlo en el móvil. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

export interface DeviceView { id: string; name: string; platform: string; createdAt: string; lastSeenAt: string | null; lastIp: string | null; push: boolean }

type DeviceRow = { id: string; name: string; platform: string; token_hash: string; created_at: string; last_seen_at: string | null; last_ip: string | null; revoked_at: string | null };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Dispositivos vinculados (iPhone, PWA, otro navegador). Vincular exige un código de un
 * solo uso que solo se ve en un dispositivo ya autorizado (10 min, 5 intentos).
 * Cada dispositivo recibe su propio token (se guarda solo su huella SHA-256) y puede
 * revocarse por separado. No hay contraseñas que adivinar.
 */
export class DeviceRegistry {
  private pending: { code: string; expires: number; attempts: number } | null = null;
  private seenAt = new Map<string, number>();

  constructor(private db: Database, private audit: AuditLog) {}

  startPairing(by: Principal): { code: string; expiresAt: string } {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede vincular dispositivos');
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    this.pending = { code, expires: Date.now() + CODE_TTL_MS, attempts: 0 };
    this.audit.append({ principal: by, action: 'device.pairing_started', outcome: 'success' });
    return { code, expiresAt: new Date(this.pending.expires).toISOString() };
  }

  cancelPairing() {
    this.pending = null;
  }

  pairingActive(): boolean {
    return !!this.pending && this.pending.expires > Date.now();
  }

  completePairing(input: { code: string; name: string; platform: string; ip: string }): { deviceId: string; token: string } {
    const p = this.pending;
    const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!p || p.expires < Date.now()) {
      this.audit.append({ principal: { kind: 'core', id: 'pairing' }, action: 'device.pair', outcome: 'denied', details: { reason: 'sin código activo', ip: input.ip } });
      throw new Error('No hay ningún código de vinculación activo. Genera uno en JARVIS → Seguridad → Dispositivos.');
    }
    if (code !== p.code) {
      p.attempts++;
      if (p.attempts >= MAX_CODE_ATTEMPTS) this.pending = null;
      this.audit.append({ principal: { kind: 'core', id: 'pairing' }, action: 'device.pair', outcome: 'denied', details: { reason: 'código incorrecto', ip: input.ip, attempts: p.attempts } });
      throw new Error(p.attempts >= MAX_CODE_ATTEMPTS ? 'Demasiados intentos: genera un código nuevo.' : 'Código incorrecto.');
    }
    this.pending = null;
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const name = input.name.trim().slice(0, 60) || 'Dispositivo';
    this.db.prepare('INSERT INTO devices (id, name, platform, token_hash, created_at, last_ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, input.platform.slice(0, 40), hash(token), new Date().toISOString(), input.ip);
    this.audit.append({ principal: { kind: 'user', id: 'owner' }, action: 'device.paired', target: id, outcome: 'success', details: { name, platform: input.platform, ip: input.ip } });
    return { deviceId: id, token };
  }

  /** Devuelve el dispositivo si el token es válido y no está revocado. */
  authenticate(token: string, ip: string): DeviceView | null {
    const r = this.db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(hash(token)) as DeviceRow | undefined;
    if (!r) return null;
    const now = Date.now();
    if ((this.seenAt.get(r.id) ?? 0) < now - 60_000) {
      this.seenAt.set(r.id, now);
      this.db.prepare('UPDATE devices SET last_seen_at = ?, last_ip = ? WHERE id = ?').run(new Date(now).toISOString(), ip, r.id);
    }
    return this.toView(r);
  }

  list(): DeviceView[] {
    return (this.db.prepare('SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at').all() as DeviceRow[]).map((r) => this.toView(r));
  }

  revoke(by: Principal, id: string): boolean {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede revocar dispositivos');
    const res = this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), id);
    this.db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?').run(id);
    if (res.changes) this.audit.append({ principal: by, action: 'device.revoked', target: id, outcome: 'success' });
    return res.changes > 0;
  }

  revokeAll(by: Principal): number {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede revocar dispositivos');
    const res = this.db.prepare('UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
    this.db.prepare("DELETE FROM push_subscriptions WHERE device_id IS NOT NULL").run();
    this.audit.append({ principal: by, action: 'device.revoked_all', outcome: 'success', details: { removed: res.changes } });
    return res.changes;
  }

  private toView(r: DeviceRow): DeviceView {
    const push = !!this.db.prepare('SELECT 1 FROM push_subscriptions WHERE device_id = ?').get(r.id);
    return { id: r.id, name: r.name, platform: r.platform, createdAt: r.created_at, lastSeenAt: r.last_seen_at, lastIp: r.last_ip, push };
  }
}

/** Freno contra fuerza bruta: demasiados fallos de autenticación desde una IP → 429 temporal. */
export class AuthThrottle {
  private fails = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 10 * 60_000) {}
  blocked(ip: string): boolean {
    const now = Date.now();
    const list = (this.fails.get(ip) ?? []).filter((t) => t > now - this.windowMs);
    this.fails.set(ip, list);
    return list.length >= this.max;
  }
  fail(ip: string) {
    const list = this.fails.get(ip) ?? [];
    list.push(Date.now());
    this.fails.set(ip, list);
    if (this.fails.size > 10_000) this.fails.clear();
  }
}
