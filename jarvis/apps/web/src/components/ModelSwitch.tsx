import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { AiStatus } from '@jarvis/shared';
import { core } from '../lib/api';
import { useConnection } from '../lib/connection';

const SHORT: Record<string, string> = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };

/** Selector rápido de modelo: Opus para lo complejo, Sonnet/Haiku para lo sencillo y barato. */
export function ModelSwitch({ onChange }: { onChange?: (s: AiStatus) => void }) {
  const { status, revision } = useConnection();
  const [st, setSt] = useState<AiStatus | null>(null);
  useEffect(() => {
    if (status === 'online') void core.aiStatus().then(setSt).catch(() => undefined);
  }, [status, revision]);
  if (!st?.configured) return null;
  return (
    <label className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-0.5 pr-1 pl-2 text-xs text-accent" title="Modelo: Opus (más capaz) · Sonnet (mitad de precio) · Haiku (muy barato, tareas sencillas)">
      <Cpu size={12} aria-hidden />
      <span className="sr-only">Modelo de IA</span>
      <select value={st.settings.model} onChange={async (e) => { await core.aiSettings({ model: e.target.value }); const n = await core.aiStatus(); setSt(n); onChange?.(n); }}
        className="cursor-pointer bg-transparent text-xs text-accent outline-none [&>option]:bg-navy-900 [&>option]:text-ink">
        {st.models.map((m) => <option key={m.id} value={m.id}>{SHORT[m.id] ?? m.label} · {m.price.input}/{m.price.output} $</option>)}
      </select>
    </label>
  );
}
