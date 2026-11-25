import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { AiStatus } from '@jarvis/shared';
import { core } from '../lib/api';
import { useConnection } from '../lib/connection';

const SHORT: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5',
  'gpt-6.1-terra': 'GPT Terra', 'gemini-3.5-flash-lite': 'Gemini Lite', 'gemini-3.8-flash': 'Gemini Flash',
};

/** Selector rápido: «Automático» (repartidor) o un modelo concreto con clave configurada. */
export function ModelSwitch({ onChange }: { onChange?: (s: AiStatus) => void }) {
  const { status, revision } = useConnection();
  const [st, setSt] = useState<AiStatus | null>(null);
  useEffect(() => {
    if (status === 'online') void core.aiStatus().then(setSt).catch(() => undefined);
  }, [status, revision]);
  if (!st?.configured) return null;
  // Tolerante con núcleos anteriores que no informan de proveedores (solo Anthropic).
  const ok = new Set((st.providers ?? [{ id: 'anthropic', configured: true }]).filter((p) => p.configured).map((p) => p.id as string));
  return (
    <label className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-0.5 pr-1 pl-2 text-xs text-accent" title="Automático: JARVIS reparte las tareas entre modelos gratis y de pago según su dificultad">
      <Cpu size={12} aria-hidden />
      <span className="sr-only">Modelo de IA</span>
      <select value={st.settings.model} onChange={async (e) => { await core.aiSettings({ model: e.target.value }); const n = await core.aiStatus(); setSt(n); onChange?.(n); }}
        className="cursor-pointer bg-transparent text-xs text-accent outline-none [&>option]:bg-navy-900 [&>option]:text-ink">
        <option value="auto">Automático</option>
        {st.models.filter((m) => ok.has(m.provider ?? 'anthropic')).map((m) => <option key={m.id} value={m.id}>{SHORT[m.id] ?? m.label} · {m.price.input === 0 ? 'gratis' : `${m.price.input}/${m.price.output} $`}</option>)}
      </select>
    </label>
  );
}

export const modelShortName = (id: string) => SHORT[id] ?? id;
