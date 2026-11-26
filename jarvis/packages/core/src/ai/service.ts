import type { AiProviderStatus, AiStatus, Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import type { SecretVault } from '../security/vault';
import type { AuditLog } from '../security/audit';
import { Budget } from './budget';
import { ConversationStore } from './conversations';
import type { ChatEngine } from './engine';
import type { AIProvider, ModelInfo } from './provider';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { ALL_MODELS, GOOGLE_MODELS } from './pricing';
import { chainForTier, route, type RouteCandidate, type RouteDecision, type Tier } from './router';

export type ProviderId = 'anthropic' | 'openai' | 'google';
export type ProviderFactory = (apiKey: string) => AIProvider;

interface ProviderDef { name: string; secret: string; pattern: RegExp; hint: string; keyUrl: string; factory: ProviderFactory }

const DEFS: Record<ProviderId, Omit<ProviderDef, 'factory'> & { factory: ProviderFactory }> = {
  anthropic: { name: 'Anthropic (Claude)', secret: 'ai.anthropic.apiKey', pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, hint: 'empieza por «sk-ant-»', keyUrl: 'https://platform.claude.com/settings/keys', factory: (k) => new AnthropicProvider(k) },
  openai: { name: 'OpenAI (GPT)', secret: 'ai.openai.apiKey', pattern: /^sk-[A-Za-z0-9_-]{20,}$/, hint: 'empieza por «sk-»', keyUrl: 'https://platform.openai.com/api-keys', factory: (k) => new OpenAIProvider(k) },
  google: { name: 'Google (Gemini, gratis)', secret: 'ai.google.apiKey', pattern: /^(AIza[A-Za-z0-9_-]{30,40}|AQ\.[A-Za-z0-9_.-]{30,200})$/, hint: 'empieza por «AIza…» o «AQ.…»', keyUrl: 'https://aistudio.google.com/apikey', factory: (k) => new GeminiProvider(k) },
};
export const ANTHROPIC_KEY_SECRET = DEFS.anthropic.secret;
const COOLDOWN_MS = 10 * 60_000;

export interface PlannedCandidate { provider: AIProvider; model: ModelInfo & { provider: string } }
export interface Plan { decision: RouteDecision | null; candidates: PlannedCandidate[]; auto: boolean }

/** Punto de entrada de la IA: claves (cifradas), proveedores, repartidor, presupuesto y conversaciones. */
export class AIService {
  readonly budget: Budget;
  readonly store: ConversationStore;
  engine!: ChatEngine;
  private cache = new Map<ProviderId, { stamp: string; provider: AIProvider }>();
  private cooldown = new Map<string, number>();
  private factories: Record<ProviderId, ProviderFactory>;

  constructor(db: Database, private vault: SecretVault, private audit: AuditLog, factories: Partial<Record<ProviderId, ProviderFactory>> = {}) {
    this.budget = new Budget(db);
    this.store = new ConversationStore(db);
    this.factories = { anthropic: factories.anthropic ?? DEFS.anthropic.factory, openai: factories.openai ?? DEFS.openai.factory, google: factories.google ?? DEFS.google.factory };
  }

  getProvider(id: ProviderId = 'anthropic'): AIProvider | null {
    const stamp = this.vault.updatedAt(DEFS[id].secret);
    if (!stamp) return null;
    const c = this.cache.get(id);
    if (c?.stamp === stamp) return c.provider;
    const key = this.vault.get(DEFS[id].secret);
    if (!key) return null;
    const provider = this.factories[id](key);
    this.cache.set(id, { stamp, provider });
    return provider;
  }

  configured(): Set<string> {
    return new Set((Object.keys(DEFS) as ProviderId[]).filter((id) => this.vault.has(DEFS[id].secret)));
  }

  /** Un modelo falló por cupo, saldo o caída: se aparta un rato y el repartidor usa el siguiente. */
  markUnavailable(c: RouteCandidate) {
    this.cooldown.set(`${c.provider}/${c.model}`, Date.now() + COOLDOWN_MS);
  }

  private cooling = (c: RouteCandidate) => (this.cooldown.get(`${c.provider}/${c.model}`) ?? 0) > Date.now();

  /** Decide qué modelo(s) responderán a un mensaje. */
  plan(message: string): Plan {
    const settings = this.budget.getSettings();
    const toPlanned = (c: RouteCandidate): PlannedCandidate | null => {
      const provider = this.getProvider(c.provider as ProviderId);
      const model = ALL_MODELS.find((m) => m.id === c.model && m.provider === c.provider);
      return provider && model ? { provider, model } : null;
    };
    if (settings.model !== 'auto') {
      const m = ALL_MODELS.find((x) => x.id === settings.model);
      const p = m ? toPlanned({ provider: m.provider, model: m.id }) : null;
      return { decision: null, candidates: p ? [p] : [], auto: false };
    }
    const decision = route(message, { settings, configured: this.configured(), freeModels: GOOGLE_MODELS.map((m) => m.id), coolingDown: this.cooling });
    return { decision, candidates: decision.chain.map(toPlanned).filter((x): x is PlannedCandidate => !!x), auto: true };
  }

  /** Plan para un agente: nivel conocido; respeta un modelo fijado por el usuario. */
  planTier(tier: Tier, o: { web?: boolean; action?: boolean } = {}): Plan {
    const settings = this.budget.getSettings();
    if (settings.model !== 'auto') return this.plan('');
    const chain = chainForTier(tier, { settings, configured: this.configured(), freeModels: GOOGLE_MODELS.map((m) => m.id), coolingDown: this.cooling, ...o });
    const candidates = chain.map((c) => {
      const provider = this.getProvider(c.provider as ProviderId);
      const model = ALL_MODELS.find((m) => m.id === c.model && m.provider === c.provider);
      return provider && model ? { provider, model } : null;
    }).filter((x): x is PlannedCandidate => !!x);
    return { decision: { tier, reason: 'asignado por el coordinador', sensitive: false, action: !!o.action, web: !!o.web, chain }, candidates, auto: true };
  }

  setApiKey(by: Principal, apiKey: string, provider: ProviderId = 'anthropic'): void {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede configurar credenciales');
    const d = DEFS[provider];
    const key = apiKey.trim();
    if (!d.pattern.test(key)) throw new Error(`No parece una clave de ${d.name} (${d.hint})`);
    this.vault.set(d.secret, key);
    this.cache.delete(provider);
    this.audit.append({ principal: by, action: 'ai.key.set', target: provider, outcome: 'success', details: { suffix: key.slice(-4) } });
  }

  deleteApiKey(by: Principal, provider: ProviderId = 'anthropic'): boolean {
    if (by.kind !== 'user') throw new Error('Solo el usuario puede borrar credenciales');
    const ok = this.vault.delete(DEFS[provider].secret);
    this.cache.delete(provider);
    this.audit.append({ principal: by, action: 'ai.key.delete', target: provider, outcome: 'success' });
    return ok;
  }

  async test(provider: ProviderId): Promise<{ ok: boolean; detail: string }> {
    const p = this.getProvider(provider);
    if (!p) return { ok: false, detail: 'No hay clave configurada.' };
    return p.healthCheck(p.models[0]!.id);
  }

  status(): AiStatus {
    const b = this.budget.state();
    const providers: AiProviderStatus[] = (Object.keys(DEFS) as ProviderId[]).map((id) => ({
      id, name: DEFS[id].name, configured: this.vault.has(DEFS[id].secret), keyUpdatedAt: this.vault.updatedAt(DEFS[id].secret), keyUrl: DEFS[id].keyUrl,
    }));
    return {
      provider: 'multi',
      configured: providers.some((p) => p.configured),
      providers,
      keyUpdatedAt: providers[0]!.keyUpdatedAt,
      settings: this.budget.getSettings(),
      models: ALL_MODELS,
      spentMonthUsd: b.spent,
      budgetRatio: b.ratio,
      warn: b.warn,
      blocked: b.blocked,
      activeConversations: this.engine?.activeConversations() ?? [],
    };
  }
}
