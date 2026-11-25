import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Clock, Cpu, History, Mail, MessageCircle, Pencil, Play, Plus, Sparkles, Trash2, Workflow, Zap } from 'lucide-react';
import type { AutomationRunStatus, AutomationRunView, AutomationView, ToolDescriptor } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { core, formatUsd } from '../lib/api';
import { useCoreData } from '../lib/connection';
import { timeAgo } from '../lib/labels';

type Trigger = AutomationView['trigger'];
type Action = AutomationView['action'];
interface Draft { name: string; description: string; trigger: Trigger; action: Action; retries: number; maxRunsPerDay: number }

const RUN: Record<AutomationRunStatus, [string, 'accent' | 'ok' | 'danger' | 'muted' | 'warn']> = {
  running: ['En marcha', 'accent'], waiting_approval: ['Espera tu confirmación', 'warn'], ok: ['Correcta', 'ok'], error: ['Error', 'danger'],
  denied: ['Denegada', 'warn'], skipped: ['Omitida', 'muted'], cancelled: ['Cancelada', 'muted'],
};
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'daily': return t.days.length === 7 ? `Cada día a las ${t.time}` : `${t.days.map((d) => DAYS[d - 1]).join(' ')} a las ${t.time}`;
    case 'interval': return t.minutes % 60 === 0 ? `Cada ${t.minutes / 60} h` : `Cada ${t.minutes} min`;
    case 'once': return `Una vez: ${t.at.replace('T', ' ')}`;
    case 'whatsapp': return `WhatsApp recibido${t.from ? ` de «${t.from}»` : ''}${t.contains ? ` con «${t.contains}»` : ''}`;
    case 'gmail': return `Correo nuevo: ${t.query}`;
    case 'condition': return `${t.metric === 'cpu' ? 'CPU' : 'Memoria'} > ${t.above} % durante ${t.forMinutes} min`;
    case 'manual': return 'Solo manual';
  }
}
const TRIGGER_ICON: Record<Trigger['type'], typeof Clock> = { daily: CalendarClock, interval: Clock, once: CalendarClock, whatsapp: MessageCircle, gmail: Mail, condition: Cpu, manual: Play };

const TEMPLATES: { title: string; hint: string; draft: Draft }[] = [
  { title: 'Resumen matinal', hint: 'IA · correo + agenda → Telegram', draft: { name: 'Resumen matinal', description: 'Correo sin leer y agenda del día, por Telegram.', retries: 1, maxRunsPerDay: 2,
    trigger: { type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] },
    action: { mode: 'ai', instructions: 'Busca mis correos no leídos de las últimas 24 horas (is:unread newer_than:1d) y mis eventos de hoy. Escribe un resumen breve: lo importante primero. Envíamelo por Telegram.', tools: ['gmail.search', 'gmail.read', 'calendar.events', 'telegram.send'] } } },
  { title: 'Correo importante', hint: 'Sin IA · Gmail → Telegram', draft: { name: 'Aviso de correo importante', description: '', retries: 1, maxRunsPerDay: 30,
    trigger: { type: 'gmail', query: 'is:important is:unread' },
    action: { mode: 'steps', steps: [{ tool: 'telegram.send', args: { text: '📧 {{event.from}}\n{{event.subject}}\n{{event.snippet}}' } }] } } },
  { title: 'Reserva por WhatsApp', hint: 'Sin IA · WhatsApp → aviso', draft: { name: 'Reservas por WhatsApp', description: '', retries: 0, maxRunsPerDay: 50,
    trigger: { type: 'whatsapp', contains: 'reserva' },
    action: { mode: 'steps', steps: [{ tool: 'notify.send', args: { title: 'Reserva de {{event.name}}', body: '{{event.text}}' } }] } } },
  { title: 'Mensaje en Vinted', hint: 'Sin IA · correo de Vinted → aviso', draft: { name: 'Mensajes de Vinted', description: 'Vinted avisa por correo de cada mensaje nuevo.', retries: 1, maxRunsPerDay: 50,
    trigger: { type: 'gmail', query: 'from:vinted is:unread' },
    action: { mode: 'steps', steps: [{ tool: 'notify.send', args: { title: 'Vinted: {{event.subject}}', body: '{{event.snippet}}' } }] } } },
  { title: 'Alerta del equipo', hint: 'Sin IA · CPU alta → aviso', draft: { name: 'CPU alta', description: '', retries: 0, maxRunsPerDay: 10,
    trigger: { type: 'condition', metric: 'cpu', above: 90, forMinutes: 5 },
    action: { mode: 'steps', steps: [{ tool: 'notify.send', args: { title: 'CPU al {{event.value}} %', body: 'Lleva 5 minutos por encima del 90 %.' } }] } } },
];

const EMPTY: Draft = { name: '', description: '', retries: 1, maxRunsPerDay: 24, trigger: { type: 'daily', time: '09:00', days: ALL_DAYS }, action: { mode: 'steps', steps: [{ tool: 'notify.send', args: { title: 'Recordatorio', body: '' } }] } };

export function AutomationsSection() {
  const { data, error, refresh } = useCoreData(() => core.automations(), [], 4000);
  const { data: tools } = useCoreData(() => core.tools(), [], 30_000);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Empty>Cargando…</Empty>;

  const act = async (fn: () => Promise<string>) => {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    void refresh();
  };
  const toggle = (a: AutomationView, on: boolean) => act(async () => {
    if (on) {
      const { scopes } = await core.automationScopes(a);
      if (!window.confirm(`Activar «${a.name}» concede a esta automatización estos permisos:\n\n${scopes.map((s) => `• ${s}`).join('\n') || '• (ninguno)'}\n\nLo de riesgo alto o crítico seguirá pidiéndote confirmación. ¿Activar?`)) return 'Sin cambios.';
    }
    await core.setAutomationEnabled(a.id, on);
    return on ? `«${a.name}» activada.` : `«${a.name}» desactivada.`;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <p className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs text-muted">
        Cada automatización actúa con su propia identidad y solo con los permisos que le concedes al activarla. Lo de riesgo alto o crítico
        (enviar mensajes, publicar…) te pide confirmación igualmente. «Pasos» no usa IA (sin coste); «IA» gasta del presupuesto mensual en cada ejecución.
        JARVIS puede proponerte automatizaciones desde la conversación: aparecen aquí desactivadas para que las revises.
      </p>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}

      {editing ? (
        <Editor initial={editing.draft} id={editing.id} tools={tools ?? []} onClose={() => { setEditing(null); void refresh(); }} />
      ) : (
        <Panel title="Nueva automatización" icon={Sparkles} actions={<Button tone="accent" onClick={() => setEditing({ id: null, draft: structuredClone(EMPTY) })}><Plus size={14} aria-hidden /> Crear desde cero</Button>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {TEMPLATES.map((t) => (
              <button key={t.title} type="button" onClick={() => setEditing({ id: null, draft: structuredClone(t.draft) })}
                className="group rounded-lg border border-navy-600 bg-navy-900/60 p-3 text-left transition hover:border-accent hover:shadow-[0_0_18px_rgb(var(--accent-rgb)/0.3)]">
                <div className="flex items-center gap-2 text-sm text-ink"><Zap size={14} className="text-accent" aria-hidden />{t.title}</div>
                <div className="mt-1 text-[11px] text-dim">{t.hint}</div>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {data.length === 0 ? <Empty>Todavía no tienes automatizaciones. Empieza con una plantilla.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((a) => (
            <AutomationCard key={a.id} a={a} onToggle={(on) => void toggle(a, on)}
              onEdit={() => setEditing({ id: a.id, draft: { name: a.name, description: a.description, trigger: a.trigger, action: a.action, retries: a.retries, maxRunsPerDay: a.maxRunsPerDay } })}
              onRun={() => void act(async () => { const r = await core.runAutomation(a.id); return 'status' in r ? `Ejecución: ${RUN[r.status][0]}${r.error ? ` — ${r.error}` : ''}` : 'Ejecución en marcha…'; })}
              onDelete={() => { if (window.confirm(`¿Borrar «${a.name}» y su historial? Se retirarán sus permisos.`)) void act(async () => { await core.deleteAutomation(a.id); return 'Borrada.'; }); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationCard({ a, onToggle, onEdit, onRun, onDelete }: { a: AutomationView; onToggle: (on: boolean) => void; onEdit: () => void; onRun: () => void; onDelete: () => void }) {
  const [showRuns, setShowRuns] = useState(false);
  const Icon = TRIGGER_ICON[a.trigger.type];
  const live = a.lastRun?.status === 'running' || a.lastRun?.status === 'waiting_approval';
  return (
    <Panel className={a.enabled ? '' : 'opacity-80'}>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${live ? 'border-accent bg-accent/15 shadow-[0_0_18px_var(--accent)]' : a.enabled ? 'border-accent/50 bg-accent/10' : 'border-navy-600 bg-navy-900'}`}>
          <Icon size={18} className={live ? 'pulse-dot text-accent' : 'text-accent'} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-ink">{a.name}</h3>
            {a.proposed && <Badge tone="warn">Propuesta de JARVIS</Badge>}
            <Badge tone={a.action.mode === 'ai' ? 'accent' : 'muted'}>{a.action.mode === 'ai' ? 'IA' : 'Pasos · sin coste'}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">{describeTrigger(a.trigger)}</p>
          {a.description && <p className="mt-0.5 text-xs text-dim">{a.description}</p>}
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
          <input type="checkbox" className="accent-[var(--accent)]" checked={a.enabled} aria-label={`Activar ${a.name}`} onChange={(e) => onToggle(e.target.checked)} />
        </label>
      </div>
      <div className="mt-2 rounded-lg bg-navy-950/50 p-2 font-mono text-[11px] text-dim">
        {a.action.mode === 'ai'
          ? <><span className="text-muted">{a.action.instructions.slice(0, 160)}{a.action.instructions.length > 160 ? '…' : ''}</span><div className="mt-1">{a.action.tools.join(' · ') || 'sin herramientas extra'}</div></>
          : a.action.steps.map((s, i) => <div key={i}>{i + 1}. {s.tool}</div>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
        {a.enabled && a.nextRunAt && <span>Próxima: {new Date(a.nextRunAt).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
        <span>Hoy: {a.runsToday}/{a.maxRunsPerDay}</span>
        {a.lastRun && <span className="flex items-center gap-1">Última: <Badge tone={RUN[a.lastRun.status][1]}>{RUN[a.lastRun.status][0]}</Badge> {timeAgo(a.lastRun.startedAt)}</span>}
      </div>
      {a.enabled && a.grants.length > 0 && <div className="mt-1 text-[10px] text-dim">Permisos: <span className="font-mono">{a.grants.join(', ')}</span></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onRun} disabled={!a.enabled || live}><Play size={13} aria-hidden /> Ejecutar ahora</Button>
        <Button tone="ghost" onClick={() => setShowRuns((v) => !v)}><History size={13} aria-hidden /> Historial</Button>
        <Button tone="ghost" onClick={onEdit}><Pencil size={13} aria-hidden /> Editar</Button>
        <Button tone="ghost" onClick={onDelete}><Trash2 size={13} aria-hidden /> Borrar</Button>
      </div>
      {showRuns && <Runs id={a.id} />}
    </Panel>
  );
}

function Runs({ id }: { id: string }) {
  const { data } = useCoreData(() => core.automationRuns(id), [id], 3000);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <p className="mt-2 text-xs text-dim">Cargando…</p>;
  if (!data.length) return <p className="mt-2 text-xs text-dim">Aún no se ha ejecutado.</p>;
  return (
    <ul className="mt-3 space-y-1 border-t border-navy-700 pt-2">
      {data.map((r: AutomationRunView) => (
        <li key={r.id} className="text-xs">
          <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-2 text-left hover:text-ink">
            <Badge tone={RUN[r.status][1]}>{RUN[r.status][0]}</Badge>
            <span className="truncate text-muted">{r.trigger}{r.attempt > 1 ? ` · intento ${r.attempt}` : ''}</span>
            <span className="ml-auto shrink-0 font-mono text-dim">{r.costUsd ? formatUsd(r.costUsd) : ''} {timeAgo(r.startedAt)}</span>
          </button>
          {open === r.id && (
            <div className="mt-1 space-y-0.5 rounded bg-navy-950/60 p-2 font-mono text-[11px]">
              {r.log.map((l, i) => <div key={i} className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-200' : l.level === 'tool' ? 'text-accent-soft' : 'text-dim'}>{l.text}</div>)}
              {r.result && <div className="mt-1 whitespace-pre-wrap text-ink">{r.result}</div>}
              {r.error && <div className="text-red-300">{r.error}</div>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const input = 'rounded-lg border border-navy-600 bg-navy-950/60 px-2.5 py-1.5 text-sm outline-none focus:border-accent';

function Editor({ initial, id, tools, onClose }: { initial: Draft; id: string | null; tools: ToolDescriptor[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [argsText, setArgsText] = useState<string[]>(() => (initial.action.mode === 'steps' ? initial.action.steps.map((s) => JSON.stringify(s.args, null, 1)) : []));
  const [err, setErr] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const usable = useMemo(() => tools.filter((t) => !t.name.startsWith('automations.') && t.name !== 'agents.delegate').sort((a, b) => a.name.localeCompare(b.name)), [tools]);
  const t = d.trigger;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });

  const build = (): Draft => {
    if (d.action.mode !== 'steps') return d;
    return { ...d, action: { mode: 'steps', steps: d.action.steps.map((s, i) => {
      try { return { tool: s.tool, args: JSON.parse(argsText[i] || '{}') as Record<string, unknown> }; } catch { throw new Error(`Paso ${i + 1}: los argumentos no son JSON válido`); }
    }) } };
  };
  useEffect(() => {
    const h = setTimeout(() => { try { void core.automationScopes(build()).then((r) => setScopes(r.scopes)).catch(() => setScopes(null)); } catch { setScopes(null); } }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, argsText]);

  const setTrigger = (type: Trigger['type']) => {
    const defs: Record<Trigger['type'], Trigger> = {
      daily: { type: 'daily', time: '09:00', days: ALL_DAYS }, interval: { type: 'interval', minutes: 60 }, once: { type: 'once', at: new Date(Date.now() + 3600_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) },
      whatsapp: { type: 'whatsapp' }, gmail: { type: 'gmail', query: 'is:unread' }, condition: { type: 'condition', metric: 'cpu', above: 90, forMinutes: 5 }, manual: { type: 'manual' },
    };
    set({ trigger: defs[type] });
  };
  const save = async (enable: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      const body = build();
      if (id) {
        await core.updateAutomation(id, body);
      } else {
        if (enable && !window.confirm(`Se concederán estos permisos a la automatización:\n\n${(scopes ?? []).map((s) => `• ${s}`).join('\n') || '• (ninguno)'}\n\n¿Guardar y activar?`)) return;
        await core.createAutomation(body, enable);
      }
      onClose();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={id ? 'Editar automatización' : 'Nueva automatización'} icon={Workflow}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void save(false); }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">Nombre<input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Descripción<input className={input} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} /></label>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium tracking-wider text-accent-soft uppercase">Cuándo</legend>
          <div className="flex flex-wrap gap-1.5">
            {(['daily', 'interval', 'once', 'gmail', 'whatsapp', 'condition', 'manual'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTrigger(k)} className={`rounded-full border px-2.5 py-1 text-xs ${t.type === k ? 'border-accent bg-accent/15 text-ink' : 'border-navy-600 text-muted hover:text-ink'}`}>
                {{ daily: 'A una hora', interval: 'Cada cierto tiempo', once: 'Una vez', gmail: 'Correo nuevo', whatsapp: 'WhatsApp recibido', condition: 'Estado del equipo', manual: 'Manual' }[k]}
              </button>
            ))}
          </div>
          {t.type === 'daily' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input aria-label="Hora" type="time" className={input} value={t.time} onChange={(e) => set({ trigger: { ...t, time: e.target.value } })} />
              {DAYS.map((label, i) => (
                <label key={label} className={`cursor-pointer rounded border px-2 py-1 ${t.days.includes(i + 1) ? 'border-accent text-ink' : 'border-navy-600 text-dim'}`}>
                  <input type="checkbox" className="sr-only" checked={t.days.includes(i + 1)} onChange={(e) => { const days = e.target.checked ? [...t.days, i + 1].sort() : t.days.filter((x) => x !== i + 1); if (days.length) set({ trigger: { ...t, days } }); }} />{label}
                </label>
              ))}
            </div>
          )}
          {t.type === 'interval' && <label className="flex items-center gap-2 text-xs text-muted">Cada <input type="number" min={5} className={`${input} w-24`} value={t.minutes} onChange={(e) => set({ trigger: { ...t, minutes: Number(e.target.value) } })} /> minutos {d.action.mode === 'ai' && <span className="text-dim">(mín. 30 con IA)</span>}</label>}
          {t.type === 'once' && <input aria-label="Fecha y hora" type="datetime-local" className={input} value={t.at} onChange={(e) => set({ trigger: { ...t, at: e.target.value } })} />}
          {t.type === 'gmail' && <label className="flex flex-col gap-1 text-xs text-muted">Búsqueda de Gmail (se comprueba cada 5 min)<input className={`${input} font-mono`} value={t.query} onChange={(e) => set({ trigger: { ...t, query: e.target.value } })} placeholder="from:jefe@empresa.com is:unread" /></label>}
          {t.type === 'whatsapp' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted">De (nombre o número, opcional)<input className={input} value={t.from ?? ''} onChange={(e) => set({ trigger: { ...t, from: e.target.value || undefined } })} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Que contenga (opcional)<input className={input} value={t.contains ?? ''} onChange={(e) => set({ trigger: { ...t, contains: e.target.value || undefined } })} /></label>
            </div>
          )}
          {t.type === 'condition' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <select aria-label="Métrica" className={input} value={t.metric} onChange={(e) => set({ trigger: { ...t, metric: e.target.value as 'cpu' | 'memory' } })}><option value="cpu">CPU</option><option value="memory">Memoria</option></select>
              por encima del <input type="number" min={1} max={100} className={`${input} w-20`} value={t.above} onChange={(e) => set({ trigger: { ...t, above: Number(e.target.value) } })} /> %
              durante <input type="number" min={1} max={120} className={`${input} w-20`} value={t.forMinutes} onChange={(e) => set({ trigger: { ...t, forMinutes: Number(e.target.value) } })} /> min
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium tracking-wider text-accent-soft uppercase">Qué hace</legend>
          <div className="flex gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-1"><input type="radio" name="mode" className="accent-[var(--accent)]" checked={d.action.mode === 'steps'} onChange={() => { set({ action: { mode: 'steps', steps: [{ tool: 'notify.send', args: { title: 'Aviso', body: '' } }] } }); setArgsText(['{\n "title": "Aviso",\n "body": ""\n}']); }} /> Pasos fijos (sin IA, sin coste)</label>
            <label className="flex cursor-pointer items-center gap-1"><input type="radio" name="mode" className="accent-[var(--accent)]" checked={d.action.mode === 'ai'} onChange={() => set({ action: { mode: 'ai', instructions: '', tools: [] } })} /> Instrucciones para JARVIS (IA)</label>
          </div>
          {d.action.mode === 'ai' ? (
            <>
              <textarea aria-label="Instrucciones" className={`${input} min-h-24 w-full`} value={d.action.instructions} onChange={(e) => set({ action: { ...d.action, instructions: e.target.value } as Action })} placeholder="Ej.: Resume mis correos sin leer y envíamelo por Telegram." />
              <div className="text-xs text-muted">Herramientas que puede usar (además de avisarte):</div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
                {usable.map((tool) => {
                  const on = d.action.mode === 'ai' && d.action.tools.includes(tool.name);
                  return (
                    <label key={tool.name} title={tool.description} className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] ${on ? 'border-accent text-ink' : 'border-navy-600 text-dim'}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => { if (d.action.mode !== 'ai') return; const list = e.target.checked ? [...d.action.tools, tool.name] : d.action.tools.filter((x) => x !== tool.name); set({ action: { ...d.action, tools: list } }); }} />{tool.name}
                    </label>
                  );
                })}
              </div>
              {d.action.tools.filter((n) => !usable.some((u) => u.name === n)).length > 0 && <p className="text-[11px] text-amber-200">Algunas herramientas elegidas son de conectores apagados: {d.action.tools.filter((n) => !usable.some((u) => u.name === n)).join(', ')}. Actívalos en Conectores.</p>}
            </>
          ) : (
            <div className="space-y-2">
              {d.action.steps.map((s, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-navy-700 p-2 sm:grid-cols-[200px_1fr_auto]">
                  <select aria-label={`Herramienta del paso ${i + 1}`} className={`${input} font-mono text-xs`} value={s.tool} onChange={(e) => { if (d.action.mode !== 'steps') return; const steps = [...d.action.steps]; steps[i] = { tool: e.target.value, args: {} }; set({ action: { mode: 'steps', steps } }); }}>
                    {!usable.some((u) => u.name === s.tool) && <option value={s.tool}>{s.tool} (conector apagado)</option>}
                    {usable.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                  </select>
                  <textarea aria-label={`Argumentos del paso ${i + 1}`} className={`${input} min-h-16 font-mono text-xs`} value={argsText[i] ?? '{}'} onChange={(e) => { const a = [...argsText]; a[i] = e.target.value; setArgsText(a); }} />
                  <Button tone="ghost" disabled={argsText.length <= 1} onClick={() => { if (d.action.mode !== 'steps') return; set({ action: { mode: 'steps', steps: d.action.steps.filter((_, k) => k !== i) } }); setArgsText(argsText.filter((_, k) => k !== i)); }}>Quitar</Button>
                </div>
              ))}
              {d.action.steps.length < 10 && <Button tone="ghost" onClick={() => { if (d.action.mode !== 'steps') return; set({ action: { mode: 'steps', steps: [...d.action.steps, { tool: 'notify.send', args: {} }] } }); setArgsText([...argsText, '{}']); }}><Plus size={13} aria-hidden /> Añadir paso</Button>}
              <p className="text-[11px] text-dim">En los argumentos puedes usar {'{{event.from}}'}, {'{{event.subject}}'}, {'{{event.text}}'}, {'{{last}}'} (resultado del paso anterior), {'{{date}}'} y {'{{time}}'}.</p>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <label className="flex items-center gap-2">Reintentos seguros <input type="number" min={0} max={3} className={`${input} w-16`} value={d.retries} onChange={(e) => set({ retries: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2">Máximo al día <input type="number" min={1} max={200} className={`${input} w-20`} value={d.maxRunsPerDay} onChange={(e) => set({ maxRunsPerDay: Number(e.target.value) })} /></label>
        </div>
        {scopes && <p className="text-[11px] text-dim">Permisos que se le concederán al activarla: <span className="font-mono">{scopes.join(', ') || '(ninguno)'}</span></p>}
        {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
        <div className="flex flex-wrap gap-2">
          {!id && <Button tone="accent" disabled={busy} onClick={() => void save(true)}>Guardar y activar</Button>}
          <Button type="submit" tone={id ? 'accent' : 'default'} disabled={busy}>{id ? 'Guardar cambios' : 'Guardar desactivada'}</Button>
          <Button tone="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Panel>
  );
}
