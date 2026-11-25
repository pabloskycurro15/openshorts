import { randomUUID } from 'node:crypto';
import type { Memory, MemoryCategory, MemoryHit, MemoryInput, MemoryLink, MemorySettings, Principal, SemanticStatus } from '@jarvis/shared';
import { MemorySettings as SettingsSchema } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { AuditLog } from '../security/audit';
import { isSensitive } from '../ai/router';
import { cosine, type Embedder } from './embedder';

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { autoSuggest: true, personalUse: 'on_request', semantic: false, shortTermHours: 24 };
const SETTINGS_KEY = 'memory.settings';

type Row = {
  id: string; category: MemoryCategory; title: string; content: string; project: string | null; tags: string; source: string;
  confidence: number; status: 'confirmed' | 'suggested'; sensitive: number; created_at: string; updated_at: string; expires_at: string | null;
  embedding: Uint8Array | null;
};

const toMemory = (r: Row): Memory => ({
  id: r.id, category: r.category, title: r.title, content: r.content, project: r.project, tags: JSON.parse(r.tags) as string[],
  source: r.source, confidence: r.confidence, status: r.status, sensitive: !!r.sensitive, createdAt: r.created_at, updatedAt: r.updated_at,
  expiresAt: r.expires_at, hasEmbedding: !!r.embedding,
});

/** Texto normalizado (minúsculas, sin tildes) para el índice de trigramas. */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (q: string) => fold(q).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 2);
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'en', 'y', 'o', 'a', 'mi', 'me', 'es', 'por', 'para', 'con', 'se', 'lo', 'al', 'su', 'mis', 'tu', 'yo', 'como', 'donde', 'cual', 'quien']);

export interface SearchOptions {
  query?: string;
  categories?: MemoryCategory[];
  project?: string;
  includePersonal?: boolean;
  includeSuggested?: boolean;
  limit?: number;
}

/**
 * Memoria de JARVIS: recuerdos con categoría, origen, fecha, confianza, estado y
 * relaciones. Búsqueda híbrida: palabras (FTS5, sin tildes) + fragmentos (trigramas,
 * tolera errores y palabras a medias) + significado (vectores locales), fusionados con
 * RRF y ajustados por confianza, estado y antigüedad.
 */
export class MemoryStore {
  constructor(private db: Database, private audit: AuditLog, private embedder: Embedder | null = null) {}

  // ── Ajustes ──
  getSettings(): MemorySettings {
    const raw = getSetting(this.db, SETTINGS_KEY);
    const p = SettingsSchema.safeParse({ ...DEFAULT_MEMORY_SETTINGS, ...(raw ? (JSON.parse(raw) as object) : {}) });
    return p.success ? p.data : { ...DEFAULT_MEMORY_SETTINGS };
  }

  updateSettings(by: Principal, patch: Partial<MemorySettings>): MemorySettings {
    if (by.kind !== 'user') throw new Error('Solo el usuario cambia los ajustes de memoria');
    const next = SettingsSchema.parse({ ...this.getSettings(), ...patch });
    setSetting(this.db, SETTINGS_KEY, JSON.stringify(next));
    this.audit.append({ principal: by, action: 'memory.settings', outcome: 'success', details: next });
    if (next.semantic) void this.enableSemantic().catch(() => undefined);
    return next;
  }

  // ── Escritura ──
  create(by: Principal, input: MemoryInput, opts: { source: string; status: 'confirmed' | 'suggested' }): Memory {
    const now = new Date();
    const id = randomUUID();
    const expires = input.category === 'short_term' ? new Date(now.getTime() + this.getSettings().shortTermHours * 3600_000).toISOString() : null;
    const sensitive = isSensitive(`${input.title} ${input.content}`);
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO memories (id, category, title, content, project, tags, source, confidence, status, sensitive, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.category, input.title, input.content, input.project ?? null, JSON.stringify(input.tags ?? []), opts.source,
        input.confidence ?? (opts.status === 'confirmed' ? 1 : 0.6), opts.status, sensitive ? 1 : 0, now.toISOString(), now.toISOString(), expires);
      this.index(id, input.title, input.content, input.tags ?? []);
    })();
    // Auditoría sin contenido (privacidad): solo metadatos.
    this.audit.append({ principal: by, action: 'memory.create', target: id, outcome: 'success', details: { category: input.category, status: opts.status, sensitive } });
    void this.embedOne(id);
    return this.get(id)!;
  }

  update(by: Principal, id: string, patch: Partial<MemoryInput>): Memory {
    const cur = this.get(id);
    if (!cur) throw new Error('Recuerdo inexistente');
    const next = { ...cur, ...patch, tags: patch.tags ?? cur.tags, project: patch.project === undefined ? cur.project : patch.project };
    const sensitive = isSensitive(`${next.title} ${next.content}`);
    this.db.transaction(() => {
      this.db.prepare('UPDATE memories SET category = ?, title = ?, content = ?, project = ?, tags = ?, confidence = ?, sensitive = ?, updated_at = ?, embedding = NULL WHERE id = ?')
        .run(next.category, next.title, next.content, next.project ?? null, JSON.stringify(next.tags), next.confidence, sensitive ? 1 : 0, new Date().toISOString(), id);
      this.index(id, next.title, next.content, next.tags);
    })();
    this.audit.append({ principal: by, action: 'memory.update', target: id, outcome: 'success', details: { fields: Object.keys(patch) } });
    void this.embedOne(id);
    return this.get(id)!;
  }

  confirm(by: Principal, id: string): Memory {
    if (by.kind !== 'user') throw new Error('Solo el usuario confirma recuerdos');
    this.db.prepare("UPDATE memories SET status = 'confirmed', confidence = MAX(confidence, 0.9), updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    this.audit.append({ principal: by, action: 'memory.confirm', target: id, outcome: 'success' });
    return this.get(id)!;
  }

  delete(by: Principal, id: string): boolean {
    const ok = this.db.transaction(() => {
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM memories_tri WHERE id = ?').run(id);
      return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
    })();
    if (ok) this.audit.append({ principal: by, action: 'memory.delete', target: id, outcome: 'success' });
    return ok;
  }

  link(by: Principal, fromId: string, toId: string, relation: string): MemoryLink {
    if (fromId === toId) throw new Error('Un recuerdo no se relaciona consigo mismo');
    if (!this.get(fromId) || !this.get(toId)) throw new Error('Recuerdo inexistente');
    const at = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO memory_links (from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?)').run(fromId, toId, relation.trim().slice(0, 60) || 'relacionado', at);
    this.audit.append({ principal: by, action: 'memory.link', target: fromId, outcome: 'success', details: { toId, relation } });
    return { fromId, toId, relation, createdAt: at };
  }

  unlink(by: Principal, fromId: string, toId: string, relation: string): boolean {
    const ok = this.db.prepare('DELETE FROM memory_links WHERE from_id = ? AND to_id = ? AND relation = ?').run(fromId, toId, relation).changes > 0;
    if (ok) this.audit.append({ principal: by, action: 'memory.unlink', target: fromId, outcome: 'success', details: { toId, relation } });
    return ok;
  }

  // ── Lectura ──
  get(id: string): Memory | undefined {
    const r = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined;
    return r ? toMemory(r) : undefined;
  }

  links(id: string): MemoryLink[] {
    const rows = this.db.prepare(
      `SELECT l.from_id, l.to_id, l.relation, l.created_at, m.title AS other
       FROM memory_links l JOIN memories m ON m.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
       WHERE l.from_id = ? OR l.to_id = ? ORDER BY l.created_at`,
    ).all(id, id, id) as { from_id: string; to_id: string; relation: string; created_at: string; other: string }[];
    return rows.map((r) => ({ fromId: r.from_id, toId: r.to_id, relation: r.relation, createdAt: r.created_at, otherTitle: r.other }));
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare("SELECT category, status, COUNT(*) AS n FROM memories WHERE expires_at IS NULL OR expires_at > ? GROUP BY category, status").all(new Date().toISOString()) as { category: string; status: string; n: number }[];
    const out: Record<string, number> = { total: 0, suggested: 0 };
    for (const r of rows) {
      out[r.category] = (out[r.category] ?? 0) + r.n;
      out.total! += r.n;
      if (r.status === 'suggested') out.suggested! += r.n;
    }
    return out;
  }

  /** Borra recuerdos de corto plazo caducados. */
  purgeExpired(): number {
    const ids = (this.db.prepare('SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?').all(new Date().toISOString()) as { id: string }[]).map((r) => r.id);
    for (const id of ids) this.delete({ kind: 'core', id: 'memoria' }, id);
    return ids.length;
  }

  async search(o: SearchOptions): Promise<MemoryHit[]> {
    const limit = Math.min(Math.max(o.limit ?? 10, 1), 100);
    const where: string[] = ['(m.expires_at IS NULL OR m.expires_at > ?)'];
    const params: (string | number)[] = [new Date().toISOString()];
    if (o.categories?.length) {
      where.push(`m.category IN (${o.categories.map(() => '?').join(',')})`);
      params.push(...o.categories);
    }
    if (!o.includePersonal) where.push("m.category <> 'personal'");
    if (o.includeSuggested === false) where.push("m.status = 'confirmed'");
    if (o.project) {
      where.push('m.project = ?');
      params.push(o.project);
    }
    const base = `SELECT m.* FROM memories m WHERE ${where.join(' AND ')}`;
    const pool = new Map((this.db.prepare(base).all(...params) as Row[]).map((r) => [r.id, r]));
    if (!pool.size) return [];

    const q = (o.query ?? '').trim();
    if (!q) {
      return [...pool.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit)
        .map((r) => ({ ...toMemory(r), score: 0, matchedBy: ['reciente'] }));
    }

    const ranked: { by: MemoryHit['matchedBy'][number]; ids: string[] }[] = [];
    const terms = words(q).filter((w) => !STOP.has(w));
    // 1) Palabras (BM25), con prefijo: «diseñ*» encuentra «diseñador».
    if (terms.length) {
      const match = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
      try {
        const ids = (this.db.prepare('SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts, 0, 3, 1, 2) LIMIT 200').all(match) as { id: string }[]).map((r) => r.id).filter((id) => pool.has(id));
        ranked.push({ by: 'texto', ids });
      } catch { /* consulta FTS no válida: se ignora */ }
    }
    // 2) Fragmentos (trigramas): tolera palabras incompletas o mal escritas.
    const grams = terms.filter((t) => t.length >= 3);
    if (grams.length) {
      const match = grams.map((t) => `"${t}"`).join(' OR ');
      try {
        const ids = (this.db.prepare('SELECT id FROM memories_tri WHERE memories_tri MATCH ? ORDER BY rank LIMIT 200').all(match) as { id: string }[]).map((r) => r.id).filter((id) => pool.has(id));
        ranked.push({ by: 'parcial', ids });
      } catch { /* sin coincidencias */ }
    }
    // 3) Significado (vectores locales), si está activado y listo.
    if (this.embedder?.ready && this.getSettings().semantic) {
      const [qv] = await this.embedder.embed([q]);
      const sims: { id: string; s: number }[] = [];
      for (const r of pool.values()) {
        if (!r.embedding) continue;
        const v = new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength));
        const s = cosine(qv!, v);
        if (s > 0.12) sims.push({ id: r.id, s });
      }
      sims.sort((a, b) => b.s - a.s);
      // Solo lo razonablemente cercano al mejor resultado: evita «ruido» semántico.
      const cut = Math.max(0.15, (sims[0]?.s ?? 0) * 0.6);
      ranked.push({ by: 'significado', ids: sims.filter((x) => x.s >= cut).slice(0, 50).map((x) => x.id) });
    }

    // Fusión RRF + ajustes por confianza y estado.
    const score = new Map<string, { s: number; by: Set<MemoryHit['matchedBy'][number]> }>();
    for (const list of ranked) {
      list.ids.forEach((id, rank) => {
        const e = score.get(id) ?? { s: 0, by: new Set() };
        e.s += 1 / (60 + rank);
        e.by.add(list.by);
        score.set(id, e);
      });
    }
    return [...score.entries()]
      .map(([id, e]) => {
        const r = pool.get(id)!;
        const adj = (0.6 + 0.4 * r.confidence) * (r.status === 'confirmed' ? 1 : 0.8);
        return { ...toMemory(r), score: Math.round(e.s * adj * 10000) / 10000, matchedBy: [...e.by] };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Significado ──
  async enableSemantic(): Promise<void> {
    if (!this.embedder) throw new Error('Sin motor de significado');
    await this.embedder.load();
    await this.reindex();
  }

  async reindex(): Promise<number> {
    if (!this.embedder?.ready) return 0;
    const rows = this.db.prepare('SELECT id, title, content, tags FROM memories WHERE embedding IS NULL OR embedding_model IS NOT ?').all(this.embedder.model) as { id: string; title: string; content: string; tags: string }[];
    for (let i = 0; i < rows.length; i += 16) {
      const batch = rows.slice(i, i + 16);
      const vecs = await this.embedder.embed(batch.map((r) => `${r.title}. ${r.content}`.slice(0, 2000)));
      batch.forEach((r, k) => this.db.prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?').run(new Uint8Array(vecs[k]!.buffer), this.embedder!.model, r.id));
    }
    return rows.length;
  }

  semanticStatus(): SemanticStatus {
    const s = this.embedder?.status() ?? { state: 'error' as const, model: '-', error: 'Sin motor' };
    const t = this.db.prepare('SELECT COUNT(*) AS total, SUM(embedding IS NOT NULL) AS indexed FROM memories').get() as { total: number; indexed: number | null };
    return { ...s, state: this.getSettings().semantic ? s.state : 'off', indexed: t.indexed ?? 0, total: t.total };
  }

  private async embedOne(id: string) {
    if (!this.embedder?.ready || !this.getSettings().semantic) return;
    const m = this.get(id);
    if (!m) return;
    try {
      const [v] = await this.embedder.embed([`${m.title}. ${m.content}`.slice(0, 2000)]);
      this.db.prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?').run(new Uint8Array(v!.buffer), this.embedder.model, id);
    } catch { /* se reintentará en reindex */ }
  }

  private index(id: string, title: string, content: string, tags: string[]) {
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM memories_tri WHERE id = ?').run(id);
    this.db.prepare('INSERT INTO memories_fts (id, title, content, tags) VALUES (?, ?, ?, ?)').run(id, title, content, tags.join(' '));
    this.db.prepare('INSERT INTO memories_tri (id, text) VALUES (?, ?)').run(id, fold(`${title} ${content} ${tags.join(' ')}`));
  }
}
