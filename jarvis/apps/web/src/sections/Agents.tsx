import { Bot, KeyRound } from 'lucide-react';
import { Badge, Empty, ErrorNote, Panel } from '../components/ui';
import { core, formatUsd } from '../lib/api';
import { useCoreData } from '../lib/connection';

const TIER: Record<string, string> = { simple: 'Modelo económico', medium: 'Modelo intermedio', complex: 'Modelo más capaz' };

export function AgentsSection() {
  const { data: agents, error, refresh } = useCoreData(() => core.agents(), [], 5000);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!agents) return <Empty>Cargando…</Empty>;
  return (
    <div className="mx-auto max-w-6xl">
      <p className="mb-4 rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs text-muted">
        Cada agente actúa con su propia identidad y solo con sus herramientas. Sus permisos empiezan vacíos: cuando necesita uno te lo pide, y nunca puede ampliárselos él mismo. Puedes revocarlos en Seguridad.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <Panel key={a.id} className={a.enabled ? '' : 'opacity-60'}>
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${a.stats.active ? 'border-accent bg-accent/15 shadow-[0_0_18px_var(--accent)]' : 'border-navy-600 bg-navy-900'}`}>
                <Bot size={18} className={a.stats.active ? 'pulse-dot text-accent' : 'text-accent'} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-ink">{a.name}</h3>
                  {a.stats.active > 0 && <Badge tone="accent">Trabajando</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted">{a.description}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
                <input type="checkbox" className="accent-[var(--accent)]" checked={a.enabled} aria-label={`Activar ${a.name}`}
                  onChange={async (e) => { await core.setAgentEnabled(a.id, e.target.checked); void refresh(); }} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              <Badge tone="muted">{TIER[a.tier]}</Badge>
              {a.availableNote && <Badge tone="warn">{a.availableNote}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">{a.tools.map((t) => <span key={t} className="rounded bg-navy-800 px-1.5 py-0.5 font-mono text-[10px] text-dim">{t}</span>)}</div>
            <div className="mt-3 grid grid-cols-4 gap-2 border-t border-navy-700 pt-2 text-center">
              {[['Tareas', a.stats.subtasks], ['Hechas', a.stats.done], ['Fallos', a.stats.failed], ['Coste', formatUsd(a.stats.costUsd)]].map(([k, v]) => (
                <div key={k as string}><div className="font-mono text-sm text-ink">{v}</div><div className="text-[10px] text-dim uppercase">{k}</div></div>
              ))}
            </div>
            <div className="mt-2 flex items-start gap-1 text-[11px] text-dim">
              <KeyRound size={11} className="mt-0.5 shrink-0" aria-hidden />
              {a.grants.length ? <span className="font-mono">{a.grants.join(', ')}</span> : <span>Sin permisos permanentes</span>}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
