import { useEffect, useState, type FormEvent } from 'react';
import { Brain, ExternalLink, KeyRound, Route, ShieldAlert } from 'lucide-react';
import type { AiProviderStatus, AiStatus, Effort } from '@jarvis/shared';
import { Badge, Button, ErrorNote, Meter, Panel } from '../components/ui';
import { core, formatUsd } from '../lib/api';
import { useConnection } from '../lib/connection';

const EFFORTS: { v: Effort; label: string; hint: string }[] = [
  { v: 'low', label: 'Rápido', hint: 'Menos razonamiento, más barato' },
  { v: 'medium', label: 'Equilibrado', hint: 'Recomendado' },
  { v: 'high', label: 'Profundo', hint: 'Más razonamiento, más caro' },
];

const PROVIDER_NOTE: Record<string, string> = {
  anthropic: 'Claude Opus, Sonnet y Haiku. Prepago en platform.claude.com.',
  openai: 'GPT-6.1 Terra (1 $ / 5 $). Prepago en platform.openai.com.',
  google: 'Gemini Flash-Lite y Flash gratis con límite diario. Sin tarjeta. Google puede usar estos datos.',
};

function ProviderCard({ p, onChange }: { p: AiProviderStatus; onChange: (msg: { ok: boolean; text: string }) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await core.setProviderKey(p.id, key);
      setKey('');
      const t = await core.testProvider(p.id);
      onChange(t.ok ? { ok: true, text: `${p.name}: clave guardada y verificada. ${t.detail}` } : { ok: false, text: `${p.name}: clave guardada, pero la verificación falló: ${t.detail}` });
    } catch (err) {
      onChange({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-navy-600 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink">{p.name}</span>
        {p.configured ? <Badge tone="ok">Configurada</Badge> : <Badge>Sin clave</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-dim">{PROVIDER_NOTE[p.id]}</p>
      <form onSubmit={save} className="mt-2 flex gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent">
          <KeyRound size={14} className="text-accent" aria-hidden />
          <label htmlFor={`key-${p.id}`} className="sr-only">Clave de {p.name}</label>
          <input id={`key-${p.id}`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={p.configured ? 'Pega otra para sustituirla' : 'Pega aquí la clave'} className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-sm outline-none placeholder:text-dim" />
        </div>
        <Button type="submit" tone="accent" disabled={busy || key.trim().length < 20}>Guardar</Button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <a className="inline-flex items-center gap-1 text-accent-soft underline" href={p.keyUrl} target="_blank" rel="noreferrer">Obtener clave <ExternalLink size={11} aria-hidden /></a>
        {p.configured && <button type="button" className="text-muted hover:text-ink" onClick={async () => { const t = await core.testProvider(p.id); onChange({ ok: t.ok, text: `${p.name}: ${t.detail}` }); }}>Probar</button>}
        {p.configured && <button type="button" className="text-dim hover:text-danger" onClick={async () => { if (window.confirm(`¿Borrar la clave de ${p.name}?`)) { await core.deleteProviderKey(p.id); onChange({ ok: true, text: `${p.name}: clave borrada.` }); } }}>Borrar</button>}
      </div>
    </div>
  );
}

export function AiSettingsPanel() {
  const { status: link } = useConnection();
  const [s, setS] = useState<AiStatus | null>(null);
  const [limit, setLimit] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const st = await core.aiStatus();
    setS(st);
    setLimit(String(st.settings.monthlyLimitUsd));
  };
  useEffect(() => {
    if (link === 'online') void load().catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [link]);

  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    await load().catch(() => undefined);
  };

  if (!s) return <Panel title="Cerebro IA" icon={Brain}><p className="text-sm text-muted">Cargando…</p></Panel>;
  const configured = new Set(s.providers.filter((p) => p.configured).map((p) => p.id));

  return (
    <Panel title="Cerebro IA" icon={Brain}>
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="text-xs tracking-wider text-dim uppercase">Proveedores</div>
          {s.providers.map((p) => <ProviderCard key={p.id} p={p} onChange={(m) => { setMsg(m); void load(); }} />)}
          <p className="text-xs text-dim">Las claves se guardan cifradas (AES-256-GCM) en tu equipo y nunca se vuelven a mostrar.</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs tracking-wider text-dim uppercase">Modelo</legend>
          <label className={`mb-2 flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${s.settings.model === 'auto' ? 'border-accent bg-accent/8' : 'border-navy-600'}`}>
            <input type="radio" name="model" className="mt-1 accent-[var(--accent)]" checked={s.settings.model === 'auto'} onChange={() => run(async () => { await core.aiSettings({ model: 'auto' }); return 'Repartidor automático activado.'; })} />
            <span>
              <span className="flex items-center gap-2 text-sm text-ink"><Route size={14} className="text-accent" aria-hidden /> Automático <span className="text-[11px] text-accent">recomendado</span></span>
              <span className="block text-xs text-muted">JARVIS elige según la tarea, del más barato al más capaz, y si uno falla (cupo, saldo) pasa al siguiente.</span>
            </span>
          </label>
          {s.settings.model === 'auto' && (
            <div className="mb-3 overflow-hidden rounded-lg border border-navy-700 text-xs">
              {[
                ['Sencilla (saludos, hora, traducir, dudas cortas)', 'Gemini Flash-Lite gratis → Flash gratis → Haiku'],
                ['Media (explicaciones, redacción)', 'GPT-6.1 Terra → Sonnet → Opus'],
                ['Compleja (planificar, programar, crear webs, investigar)', 'Opus → Sonnet → Terra'],
                ['Acciones en el equipo (archivos, apps, comandos)', 'Sonnet / Opus (usan mejor las herramientas)'],
                ['Datos sensibles (contraseñas, banco, salud…)', 'Nunca el nivel gratuito de Google'],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[1fr_1.2fr] gap-2 border-b border-navy-700 px-3 py-1.5 last:border-0"><span className="text-muted">{k}</span><span className="text-ink">{v}</span></div>
              ))}
            </div>
          )}
          <label className="mb-3 flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={s.settings.allowFreeGoogle} onChange={(e) => run(async () => { await core.aiSettings({ allowFreeGoogle: e.target.checked }); return e.target.checked ? 'Gemini gratis permitido.' : 'Gemini gratis desactivado.'; })} />
            <span>Usar Gemini gratis para tareas sencillas
              <span className="flex items-start gap-1 text-xs text-warn"><ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> En el nivel gratuito, Google puede usar esas conversaciones para mejorar sus productos. Lo sensible nunca se le envía.</span>
            </span>
          </label>
          <div className="text-xs text-dim">O fija un modelo concreto:</div>
          <div className="mt-2 space-y-1.5">
            {s.models.map((m) => {
              const ok = configured.has(m.provider as AiProviderStatus['id']);
              return (
                <label key={m.id} className={`flex items-start gap-3 rounded-lg border p-2 ${s.settings.model === m.id ? 'border-accent bg-accent/8' : 'border-navy-700'} ${ok ? 'cursor-pointer' : 'opacity-45'}`}>
                  <input type="radio" name="model" disabled={!ok} className="mt-1 accent-[var(--accent)]" checked={s.settings.model === m.id}
                    onChange={() => run(async () => { await core.aiSettings({ model: m.id }); return `Modelo fijo: ${m.label}`; })} />
                  <span className="min-w-0">
                    <span className="text-sm text-ink">{m.label}</span>
                    <span className="block text-xs text-muted">{m.description}{!ok && ' · falta la clave'}</span>
                    <span className="block font-mono text-[11px] text-dim">{m.price.input === 0 ? 'Gratis (nivel gratuito)' : `${m.price.input} $ / ${m.price.output} $ por millón de tokens`}</span>
                  </span>
                </label>
              );
            })}
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
          <div className="mb-2 text-xs tracking-wider text-dim uppercase">Límite de gasto mensual (todos los proveedores)</div>
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
            <Button type="submit" disabled={limit === String(s.settings.monthlyLimitUsd)}>Guardar</Button>
          </form>
          <p className="mt-2 text-xs text-dim">Aviso al 80 %; al 100 % JARVIS deja de llamar a los modelos de pago. Estimación local: las facturas oficiales están en cada consola.</p>
        </div>

        {msg && (msg.ok ? <p role="status" className="text-sm text-ok">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>)}
      </div>
    </Panel>
  );
}
