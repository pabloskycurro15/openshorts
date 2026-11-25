import type { AiSettings } from '@jarvis/shared';
import { AiSettings as AiSettingsSchema } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { Usage } from './provider';

/** Valores por defecto decididos con el usuario: Opus 5.5 y 5 USD al mes (su recarga inicial). */
export const DEFAULT_AI_SETTINGS: AiSettings = { model: 'claude-opus-5-5', effort: 'medium', monthlyLimitUsd: 5 };
export const WARN_RATIO = 0.8;
const KEY = 'ai.settings';

/** Inicio del mes natural en hora local, en ISO. */
export function monthStart(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Control de gasto: registra el consumo real de cada llamada (tokens devueltos por
 * el proveedor × precio público) y bloquea nuevas llamadas al superar el límite.
 * El coste es una estimación local; la factura oficial está en la consola de Anthropic.
 */
export class Budget {
  constructor(private db: Database) {}

  getSettings(): AiSettings {
    const raw = getSetting(this.db, KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = AiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, ...(JSON.parse(raw) as object) });
    return parsed.success ? parsed.data : { ...DEFAULT_AI_SETTINGS };
  }

  updateSettings(patch: Partial<AiSettings>): AiSettings {
    const next = AiSettingsSchema.parse({ ...this.getSettings(), ...patch });
    setSetting(this.db, KEY, JSON.stringify(next));
    return next;
  }

  record(entry: { conversationId: string | null; provider: string; model: string; usage: Usage; costUsd: number }): void {
    const u = entry.usage;
    this.db
      .prepare(
        `INSERT INTO ai_usage (ts, conversation_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(new Date().toISOString(), entry.conversationId, entry.provider, entry.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, entry.costUsd);
  }

  monthSpend(now = new Date()): number {
    const r = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_usage WHERE ts >= ?').get(monthStart(now)) as { s: number };
    return r.s;
  }

  state(now = new Date()) {
    const limit = this.getSettings().monthlyLimitUsd;
    const spent = this.monthSpend(now);
    const ratio = limit > 0 ? spent / limit : 1;
    return { spent, limit, ratio, warn: ratio >= WARN_RATIO, blocked: ratio >= 1 };
  }
}
