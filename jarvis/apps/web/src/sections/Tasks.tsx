import { useState, type FormEvent } from 'react';
import { Bot, CircleStop, ListChecks, Play, Trash2 } from 'lucide-react';
import type { SubtaskStatus, TaskStatus, TaskView } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { core, formatUsd } from '../lib/api';
import { useCoreData } from '../lib/connection';
import { timeAgo } from '../lib/labels';
import { modelShortName } from '../components/ModelSwitch';

const T_LABEL: Record<TaskStatus, [string, 'accent' | 'ok' | 'danger' | 'muted' | 'warn']> = {
  planning: ['Planificando', 'accent'], running: ['En marcha', 'accent'], done: ['Terminada', 'ok'], failed: ['Fallida', 'danger'], cancelled: ['Cancelada', 'muted'],
};
const S_LABEL: Record<SubtaskStatus, [string, 'accent' | 'ok' | 'danger' | 'muted' | 'warn']> = {
  pending: ['En cola', 'muted'], running: ['Trabajando', 'accent'], waiting_approval: ['Espera tu permiso', 'warn'], done: ['Hecha', 'ok'], failed: ['Fallida', 'danger'], cancelled: ['Cancelada', 'muted'],
};

function TaskDetail({ t }: { t: TaskView }) {
  const live = t.status === 'planning' || t.status === 'running';
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base text-ink">{t.title}</h3>
        <Badge tone={T_LABEL[t.status][1]}>{T_LABEL[t.status][0]}</Badge>
        <span className="font-mono text-xs text-dim">{formatUsd(t.costUsd)}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{t.goal}</p>
      <div className="mt-3 flex gap-2">
        {live && <Button tone="danger" onClick={() => void core.cancelTask(t.id)}><CircleStop size={14} aria-hidden /> Detener</Button>}
        {!live && <Button tone="ghost" onClick={async () => { if (window.confirm('¿Borrar esta tarea del historial?')) await core.deleteTask(t.id); }}><Trash2 size={14} aria-hidden /> Borrar</Button>}
      </div>
      {t.status === 'planning' && <p className="mt-4 animate-pulse text-sm text-accent-soft">El coordinador está repartiendo el trabajo…</p>}
      <ol className="mt-4 space-y-3">
        {t.subtasks.map((s) => (
          <li key={s.id} className={`relative rounded-lg border p-3 ${s.status === 'running' || s.status === 'waiting_approval' ? 'border-accent/60 bg-accent/5' : 'border-navy-700 bg-navy-900/50'}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-dim">{s.index + 1}</span>
              <Bot size={14} className="text-accent" aria-hidden />
              <span className="text-ink">{s.title}</span>
              <Badge>{s.agentId}</Badge>
              <Badge tone={S_LABEL[s.status][1]}>{S_LABEL[s.status][0]}</Badge>
              {s.model && <span className="font-mono text-[10px] text-accent-soft">⟐ {modelShortName(s.model)}</span>}
              <span className="ml-auto font-mono text-[10px] text-dim">{s.costUsd > 0 ? formatUsd(s.costUsd) : ''}</span>
            </div>
            {s.log.length > 0 && (
              <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted">
                {s.log.slice(-6).map((l, i) => (
                  <li key={i} className={l.kind === 'error' ? 'text-danger' : l.kind === 'warning' ? 'text-warn' : l.kind === 'approval' ? 'text-warn' : ''}>
                    · {l.text}
                    {l.approvalId && s.status === 'waiting_approval' && (
                      <span className="ml-2 inline-flex gap-1">
                        <button type="button" className="rounded bg-accent px-1.5 text-bg" onClick={() => void core.resolveApproval(l.approvalId!, 'approved')}>Aprobar</button>
                        <button type="button" className="rounded border border-accent/60 px-1.5 text-accent" onClick={() => void core.resolveApproval(l.approvalId!, 'approved_always')}>Siempre</button>
                        <button type="button" className="rounded border border-danger/60 px-1.5 text-danger" onClick={() => void core.resolveApproval(l.approvalId!, 'denied')}>Denegar</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {s.result && <details className="mt-2 text-sm"><summary className="cursor-pointer text-xs text-accent-soft">Resultado</summary><div className="mt-1"><Markdown text={s.result} /></div></details>}
            {s.error && <p className="mt-1 text-xs text-danger">{s.error}</p>}
          </li>
        ))}
      </ol>
      {t.result && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="mb-1 text-xs tracking-wider text-accent uppercase">Resultado final</div>
          <Markdown text={t.result} />
        </div>
      )}
      {t.error && t.status !== 'done' && <div className="mt-3"><ErrorNote>{t.error}</ErrorNote></div>}
    </div>
  );
}

export function TasksSection() {
  const { data: tasks, error } = useCoreData(() => core.tasks(), [], 4000);
  const [sel, setSel] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const current = tasks?.find((t) => t.id === sel) ?? tasks?.[0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const t = await core.createTask(goal);
      setGoal('');
      setSel(t.id);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Panel title="Nuevo objetivo" icon={Play}>
          <form onSubmit={submit} className="space-y-2">
            <label htmlFor="goal" className="sr-only">Objetivo para el equipo de agentes</label>
            <textarea id="goal" rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ej.: Revisa el proyecto de la carpeta Web Marina, resume qué falta y prepara una lista de tareas en un documento."
              className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm outline-none focus:border-accent" />
            <Button type="submit" tone="accent" disabled={goal.trim().length < 5}>Encargar al equipo</Button>
            <p className="text-[11px] text-dim">El coordinador lo divide en subtareas y cada agente trabaja con sus propias herramientas y permisos. Consume créditos según la complejidad.</p>
          </form>
          {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
        </Panel>
        <Panel title="Tareas" icon={ListChecks}>
          {error && <ErrorNote>{error}</ErrorNote>}
          {tasks?.length ? (
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setSel(t.id)} className={`w-full rounded-lg px-3 py-2 text-left ${current?.id === t.id ? 'bg-accent/12' : 'hover:bg-navy-800'}`}>
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm">{t.title}</span><Badge tone={T_LABEL[t.status][1]}>{T_LABEL[t.status][0]}</Badge></div>
                    <div className="text-[11px] text-dim">{timeAgo(t.createdAt)} · {t.subtasks.length} subtareas · {formatUsd(t.costUsd)}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>Aún no hay tareas.</Empty>}
        </Panel>
      </div>
      <Panel>{current ? <TaskDetail t={current} /> : <Empty>Encarga un objetivo al equipo de agentes para verlo trabajar aquí.</Empty>}</Panel>
    </div>
  );
}
