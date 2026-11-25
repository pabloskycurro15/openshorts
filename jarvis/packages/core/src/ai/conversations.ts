import { randomUUID } from 'node:crypto';
import type { ChatMessageView, ConversationSummary } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { ChatMessage, ContentBlock } from './provider';

/** Persistencia de conversaciones. Los mensajes son de solo inserción (el historial no se reescribe). */
export class ConversationStore {
  constructor(private db: Database) {}

  create(title: string): ConversationSummary {
    const now = new Date().toISOString();
    const c = { id: randomUUID(), title: title.slice(0, 80) || 'Conversación', createdAt: now, updatedAt: now, costUsd: 0 };
    this.db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(c.id, c.title, now, now);
    return c;
  }

  exists(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id);
  }

  get(id: string): ConversationSummary | undefined {
    return this.list().find((c) => c.id === id);
  }

  list(): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.created_at, c.updated_at,
                COALESCE((SELECT SUM(cost_usd) FROM ai_usage u WHERE u.conversation_id = c.id), 0) AS cost
         FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`,
      )
      .all() as { id: string; title: string; created_at: string; updated_at: string; cost: number }[];
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, costUsd: r.cost }));
  }

  append(conversationId: string, msg: ChatMessage): number {
    const now = new Date().toISOString();
    const info = this.db
      .prepare('INSERT INTO messages (conversation_id, role, content, raw, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(conversationId, msg.role, JSON.stringify(msg.content), msg.raw ? JSON.stringify(msg.raw) : null, now);
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
    return Number(info.lastInsertRowid);
  }

  /** Historial completo para el proveedor (con contenido original). */
  history(conversationId: string): ChatMessage[] {
    const rows = this.db.prepare('SELECT role, content, raw FROM messages WHERE conversation_id = ? ORDER BY seq').all(conversationId) as {
      role: 'user' | 'assistant'; content: string; raw: string | null;
    }[];
    return rows.map((r) => ({
      role: r.role,
      content: JSON.parse(r.content) as ContentBlock[],
      raw: r.raw ? (JSON.parse(r.raw) as ChatMessage['raw']) : null,
    }));
  }

  /** Vista para la interfaz (sin contenido interno del proveedor). */
  view(conversationId: string): ChatMessageView[] {
    const rows = this.db.prepare('SELECT seq, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY seq').all(conversationId) as {
      seq: number; role: 'user' | 'assistant'; content: string; created_at: string;
    }[];
    return rows.map((r) => ({ seq: r.seq, role: r.role, content: JSON.parse(r.content) as ContentBlock[], createdAt: r.created_at }));
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  }
}
