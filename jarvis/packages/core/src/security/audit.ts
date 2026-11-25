import { createHash } from 'node:crypto';
import type { AuditEntry, Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { EventBus } from '../kernel/events';

const GENESIS = '0'.repeat(64);

interface Row {
  seq: number;
  ts: string;
  principal_kind: string;
  principal_id: string;
  action: string;
  target: string | null;
  outcome: string;
  details: string;
  prev_hash: string;
  hash: string;
}

function computeHash(prev: string, r: Omit<Row, 'seq' | 'hash' | 'prev_hash'>): string {
  const canonical = JSON.stringify([prev, r.ts, r.principal_kind, r.principal_id, r.action, r.target, r.outcome, r.details]);
  return createHash('sha256').update(canonical).digest('hex');
}

function toEntry(r: Row): AuditEntry {
  return {
    seq: r.seq,
    ts: r.ts,
    principal: { kind: r.principal_kind as Principal['kind'], id: r.principal_id },
    action: r.action,
    target: r.target,
    outcome: r.outcome as AuditEntry['outcome'],
    details: JSON.parse(r.details) as unknown,
    hash: r.hash,
  };
}

/**
 * Registro de auditoría de solo inserción con encadenado de hashes:
 * cada entrada incluye el hash de la anterior, de modo que cualquier
 * modificación posterior de la base de datos es detectable con verify().
 */
export class AuditLog {
  constructor(private db: Database, private bus?: EventBus) {}

  append(input: {
    principal: Principal;
    action: string;
    target?: string | null;
    outcome: AuditEntry['outcome'];
    details?: unknown;
  }): AuditEntry {
    return this.db.transaction(() => {
      const last = this.db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
        | { hash: string }
        | undefined;
      const prev = last?.hash ?? GENESIS;
      const base = {
        ts: new Date().toISOString(),
        principal_kind: input.principal.kind,
        principal_id: input.principal.id,
        action: input.action,
        target: input.target ?? null,
        outcome: input.outcome,
        details: JSON.stringify(input.details ?? null),
      };
      const hash = computeHash(prev, base);
      const info = this.db
        .prepare(
          `INSERT INTO audit_log (ts, principal_kind, principal_id, action, target, outcome, details, prev_hash, hash)
           VALUES (@ts, @principal_kind, @principal_id, @action, @target, @outcome, @details, @prev_hash, @hash)`,
        )
        .run({ ...base, prev_hash: prev, hash });
      const entry = toEntry({ ...base, seq: Number(info.lastInsertRowid), prev_hash: prev, hash });
      this.bus?.emit('audit.appended', entry);
      return entry;
    })();
  }

  list(opts: { limit?: number; beforeSeq?: number } = {}): AuditEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT ?')
      .all(opts.beforeSeq ?? Number.MAX_SAFE_INTEGER, limit) as Row[];
    return rows.map(toEntry);
  }

  /** Recorre la cadena completa. Devuelve la primera secuencia corrupta, si la hay. */
  verify(): { ok: true; count: number } | { ok: false; brokenAt: number } {
    let prev = GENESIS;
    let count = 0;
    for (const r of this.db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').iterate() as Iterable<Row>) {
      if (r.prev_hash !== prev || computeHash(prev, r) !== r.hash) return { ok: false, brokenAt: r.seq };
      prev = r.hash;
      count++;
    }
    return { ok: true, count };
  }
}
