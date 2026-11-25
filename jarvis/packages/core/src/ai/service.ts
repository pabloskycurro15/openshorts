import type { AiStatus, Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { SecretVault } from '../security/vault';
import type { AuditLog } from '../security/audit';
import { Budget } from './budget';
import { ConversationStore } from './conversations';
import type { ChatEngine } from './engine';
import type { AIProvider } from './provider';
import { AnthropicProvider } from './anthropic';
import { ANTHROPIC_MODELS } from './pricing';

export const ANTHROPIC_KEY_SECRET = 'ai.anthropic.apiKey';
export type ProviderFactory = (apiKey: string) => AIProvider;

/** Punto de entrada de la IA: clave (en el almacén cifrado), proveedor, presupuesto y conversaciones. */
export class AIService {
  readonly budget: Budget;
  readonly store: ConversationStore;
  engine!: ChatEngine;
  private cached: { stamp: string; provider: AIProvider } | null = null;

  constructor(
    db: Database,
    private vault: SecretVault,
    private audit: AuditLog,
    private factory: ProviderFactory = (k) => new AnthropicProvider(k),
  ) {
    this.budget = new Budget(db);
    this.store = new ConversationStore(db);
  }

  getProvider(): AIProvider | null {
    const stamp = this.vault.updatedAt(ANTHROPIC_KEY_SECRET);
    if (!stamp) return null;
    if (this.cached?.stamp !== stamp) {
      const key = this.vault.get(ANTHROPIC_KEY_SECRET);
      if (!key) return null;
      this.cached = { stamp, provider: this.factory(key) };
    }
    return this.cached.provider;
  }

  setApiKey(by: Principal, apiKey: string): void {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede configurar credenciales');
    const key = apiKey.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('No parece una clave API de Anthropic (empieza por «sk-ant-»)');
    this.vault.set(ANTHROPIC_KEY_SECRET, key);
    this.cached = null;
    this.audit.append({ principal: by, action: 'ai.key.set', target: 'anthropic', outcome: 'success', details: { suffix: key.slice(-4) } });
  }

  deleteApiKey(by: Principal): boolean {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede borrar credenciales');
    const ok = this.vault.delete(ANTHROPIC_KEY_SECRET);
    this.cached = null;
    this.audit.append({ principal: by, action: 'ai.key.delete', target: 'anthropic', outcome: 'success' });
    return ok;
  }

  status(): AiStatus {
    const b = this.budget.state();
    return {
      provider: 'anthropic',
      configured: this.vault.has(ANTHROPIC_KEY_SECRET),
      keyUpdatedAt: this.vault.updatedAt(ANTHROPIC_KEY_SECRET),
      settings: this.budget.getSettings(),
      models: ANTHROPIC_MODELS,
      spentMonthUsd: b.spent,
      budgetRatio: b.ratio,
      warn: b.warn,
      blocked: b.blocked,
      activeConversations: this.engine?.activeConversations() ?? [],
    };
  }
}
