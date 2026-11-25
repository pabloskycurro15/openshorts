import { useEffect, useState, type FormEvent } from 'react';
import { Brain, ExternalLink, KeyRound } from 'lucide-react';
import type { AiStatus, Effort } from '@jarvis/shared';
import { Badge, Button, ErrorNote, Meter, Panel } from '../components/ui';
import { core, formatUsd } from '../lib/api';
import { useConnection } from '../lib/connection';

const EFFORTS: { v: Effort; label: string; hint: string }[] = [
  { v: 'low', label: 'Rápido', hint: 'Menos razonamiento, más barato' },
  { v: 'medium', label: 'Equilibrado', hint: 'Recomendado' },
  { v: 'high', label: 'Profundo', hint: 'Más razonamiento, más caro' },
];

export function AiSettingsPanel() {
  const { status: link } = useConnection();
  const [s, setS] = useState<AiStatus | null>(null);
  const [key, setKey] = useState('');
  const [limit, setLimit] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const st = await core.aiStatus();
    setS(st);
    setLimit(String(st.settings.monthlyLimitUsd));
  };
  useEffect(() => {
    if (link === 'online') void load().catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [link]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await core.setApiKey(key);
      setKey('');
      const t = await core.testAi();
      return t.ok ? `Clave guardada y verificada. ${t.detail}` : `Clave guardada, pero la verificación falló: ${t.detail}`;
    });
  };

  if (!s) return <Panel title="Cerebro IA" icon={Brain}><p className="text-sm text-muted">Cargando…</p></Panel>;

  return (
    <Panel title="Cerebro IA" icon={Brain}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs tracking-wider text-dim uppercase">Clave API de Anthropic</span>
            {s.configured ? <Badge tone="ok">Configurada</Badge> : <Badge tone="warn">Sin configurar</Badge>}
          </div>
          <form onSubmit={saveKey} className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent">
              <KeyRound size={15} className="text-accent" aria-hidden />
              <label htmlFor="api-key" className="sr-only">Clave API</label>
              <input id="api-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                placeholder={s.configured ? 'Pega una clave nueva para sustituirla' : 'sk-ant-…'}
                className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none placeholder:text-dim" />
            </div>
            <Button type="submit" tone="accent" disabled={busy || key.trim().length < 20}>Guardar</Button>
          </form>
          <p className="mt-2 text-xs text-dim">Se guarda cifrada (AES-256-GCM) en tu equipo y nunca se vuelve a mostrar. <a className="inline-flex items-center gap-1 text-accent-soft underline" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Obtener clave <ExternalLink size={11} aria-hidden /></a></p>
          {s.configured && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => run(async () => { const t = await core.testAi(); if (!t.ok) throw new Error(t.detail); return t.detail; })}>Probar conexión</Button>
              <Button tone="ghost" disabled={busy} onClick={() => { if (window.confirm('¿Borrar la clave API? JARVIS dejará de poder pensar hasta que añadas otra.')) void run(async () => { await core.deleteApiKey(); return 'Clave borrada.'; }); }}>Borrar clave</Button>
            </div>
          )}
        </div>

        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Modelo</legend>
          <div className="space-y-2">
            {s.models.map((m) => (
              <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${s.settings.model === m.id ? 'border-accent bg-accent/8' : 'border-navy-600 hover:border-navy-600/80'}`}>
                <input type="radio" name="model" className="mt-1 accent-[var(--accent)]" checked={s.settings.model === m.id}
                  onChange={() => run(async () => { await core.aiSettings({ model: m.id }); return `Modelo: ${m.label}`; })} />
                <span className="min-w-0">
                  <span className="text-sm text-ink">{m.label}</span>{m.id === 'claude-opus-5-5' && <span className="ml-2 text-[11px] text-accent">recomendado</span>}
                  <span className="block text-xs text-muted">{m.description}</span>
                  <span className="block font-mono text-[11px] text-dim">{m.price.input} $ / {m.price.output} $ por millón de tokens (entrada / salida)</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Nivel de razonamiento</legend>
          <div className="grid grid-cols-3 gap-2">
            {EFFORTS.map((e) => (
              <button key={e.v} type="button" aria-pressed={s.settings.effort === e.v} title={e.hint}
                onClick={() => run(async () => { await core.aiSettings({ effort: e.v }); return `Razonamiento: ${e.label}`; })}
                className={`rounded-lg border px-2 py-1.5 text-sm ${s.settings.effort === e.v ? 'border-accent bg-accent/12 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>{e.label}</button>
            ))}
          </div>
        </fieldset>

        <div>
          <div className="mb-2 text-xs tracking-wider text-dim uppercase">Límite de gasto mensual</div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted">Gastado este mes (estimado)</span>
            <span className="font-mono">{formatUsd(s.spentMonthUsd)} / {formatUsd(s.settings.monthlyLimitUsd)}</span>
          </div>
          <Meter label="Gasto del mes" value={s.budgetRatio} tone={s.blocked ? 'danger' : s.warn ? 'warn' : 'accent'} />
          <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await core.aiSettings({ monthlyLimitUsd: Number(limit) }); return `Límite: ${Number(limit).toFixed(2)} $ al mes`; }); }}>
            <label htmlFor="limit" className="sr-only">Límite mensual en dólares</label>
            <input id="limit" type="number" min={0} max={10000} step={0.5} value={limit} onChange={(e) => setLimit(e.target.value)}
              className="w-28 rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent" />
            <span className="text-sm text-muted">$ / mes</span>
            <Button type="submit" disabled={busy || limit === String(s.settings.monthlyLimitUsd)}>Guardar</Button>
          </form>
          <p className="mt-2 text-xs text-dim">Aviso al 80 %; al 100 % JARVIS deja de llamar al modelo hasta el mes siguiente o hasta que lo amplíes. Es una estimación local: la factura oficial está en tu consola de Anthropic.</p>
        </div>

        {msg && (msg.ok ? <p role="status" className="text-sm text-ok">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>)}
      </div>
    </Panel>
  );
}
