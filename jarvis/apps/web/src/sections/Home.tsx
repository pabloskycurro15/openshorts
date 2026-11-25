import { useState } from 'react';
import { Activity, Bell, Boxes, CalendarDays, CloudSun, ShieldAlert, Bot, Workflow } from 'lucide-react';
import { AICore } from '../components/AICore';
import { CommandBar } from '../components/CommandBar';
import { Badge, Button, Dot, Meter, Panel, Stat } from '../components/ui';
import { useConnection, useCoreData } from '../lib/connection';
import { core, formatBytes, formatDuration, formatUsd } from '../lib/api';
import { useSettings, ACCENTS } from '../lib/settings';
import { useSystemInfo } from '../lib/useSystem';
import { useDisplayState } from '../voice/VoiceProvider';
import { EVENT_LABEL, STATE_LABEL, timeAgo } from '../lib/labels';

function Planned({ icon: Icon, title, phase }: { icon: typeof Bot; title: string; phase: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Icon size={13} className="shrink-0 text-dim" aria-hidden />
      <span className="flex-1 truncate">{title}</span>
      <Badge>F{phase}</Badge>
    </div>
  );
}

export function HomeSection({ navigate }: { navigate: (id: string) => void }) {
  const { status, lockdown, internet, feed } = useConnection();
  const assistant = useDisplayState();
  const { appearance } = useSettings();
  const { info } = useSystemInfo(4000, 2);
  const { data: health } = useCoreData(() => core.health(), [], 15000);
  const { data: pending } = useCoreData(() => core.approvals('pending'));
  const { data: ai } = useCoreData(() => core.aiStatus());
  const { data: tasks } = useCoreData(() => core.tasks(), [], 6000);
  const liveTasks = (tasks ?? []).filter((t) => t.status === 'planning' || t.status === 'running');
  const [subtitle, setSubtitle] = useState<{ text: string; live: boolean }>({ text: '', live: false });
  const [routeLabel, setRouteLabel] = useState('');
  const memUsed = info ? 1 - info.memory.freeBytes / info.memory.totalBytes : 0;
  const load = info ? (info.cpu.usagePercent !== undefined ? info.cpu.usagePercent / 100 : (info.cpu.loadAvg[0] ?? 0) / info.cpu.cores) : 0;
  const accent = ACCENTS[appearance.accent].hex;
  const clean = subtitle.text.replace(/```[\s\S]*?```/g, '[código]').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '').replace(/`([^`]+)`/g, '$1').replace(/^#+\s*/gm, '');
  const shown = clean.length > 320 ? `…${clean.slice(-320)}` : clean;

  const left = (
    <div className="space-y-4">
      <Panel title="Sistema" icon={Activity}>
        <ul className="space-y-2.5 text-sm">
          <li className="flex items-center justify-between"><span className="text-muted">Núcleo</span>
            <span className="flex items-center gap-2"><Dot tone={status === 'online' ? 'ok' : 'danger'} pulse={status === 'online'} />{status === 'online' ? `v${health?.version ?? '…'}` : 'Sin conexión'}</span></li>
          <li className="flex items-center justify-between"><span className="text-muted">Internet</span>
            <span className="flex items-center gap-2"><Dot tone={internet ? 'ok' : 'danger'} />{internet ? 'Disponible' : 'Sin conexión'}</span></li>
          <li className="flex items-center justify-between"><span className="text-muted">Seguridad</span>
            {lockdown ? <Badge tone="danger">Emergencia</Badge> : <Badge tone="ok">Normal</Badge>}</li>
          <li className="flex items-center justify-between"><span className="text-muted">Cerebro</span>
            {ai ? (ai.configured ? <Badge tone="ok">{ai.settings.model === 'auto' ? `Automático · ${(ai.providers ?? []).filter((p) => p.configured).length} proveedor(es)` : ai.models.find((m) => m.id === ai.settings.model)?.label ?? ai.settings.model}</Badge> : <Badge tone="warn">Sin clave API</Badge>) : <Badge>…</Badge>}</li>
          {ai?.configured && <li><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Gasto del mes</span><span className="font-mono">{formatUsd(ai.spentMonthUsd)} / {formatUsd(ai.settings.monthlyLimitUsd)}</span></div>
            <Meter label="Gasto del mes" value={ai.budgetRatio} tone={ai.blocked ? 'danger' : ai.warn ? 'warn' : 'accent'} /></li>}
          {health && <li className="flex items-center justify-between"><span className="text-muted">Activo</span><span className="data-blip font-mono text-xs">{formatDuration(health.uptimeSec)}</span></li>}
        </ul>
      </Panel>
      <Panel title="Módulos" icon={Boxes}>
        <ul className="space-y-2">
          {health?.modules.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{m.name}</span>
              <Badge tone={m.status === 'running' ? 'ok' : m.status === 'failed' ? 'danger' : 'muted'}>{m.status === 'running' ? 'Activo' : m.status === 'failed' ? 'Fallo' : m.status}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );

  const right = (
    <div className="space-y-4">
      <Panel title="Rendimiento" icon={Activity} actions={<Button tone="ghost" onClick={() => navigate('monitor')}>Detalle</Button>}>
        {info ? (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">CPU · {info.cpu.cores} núcleos</span><span className="font-mono">{(load * 100).toFixed(0)} %</span></div>
              <Meter label="Uso de CPU" value={load} tone={load > 0.85 ? 'danger' : load > 0.6 ? 'warn' : 'accent'} />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Memoria</span><span className="font-mono">{formatBytes(info.memory.totalBytes - info.memory.freeBytes)} / {formatBytes(info.memory.totalBytes)}</span></div>
              <Meter label="Memoria usada" value={memUsed} tone={memUsed > 0.9 ? 'danger' : memUsed > 0.75 ? 'warn' : 'accent'} />
            </div>
            <Stat label="Equipo" value={info.hostname} sub={`${info.platform} · ${info.arch}`} />
          </div>
        ) : <p className="text-sm text-muted">Esperando datos…</p>}
      </Panel>
      <Panel title="Agentes trabajando" icon={Bot} actions={<Button tone="ghost" onClick={() => navigate('tareas')}>Tareas</Button>}>
        {liveTasks.length ? (
          <ul className="space-y-2">
            {liveTasks.slice(0, 3).map((t) => {
              const cur = t.subtasks.find((s) => s.status === 'running' || s.status === 'waiting_approval');
              const done = t.subtasks.filter((s) => s.status === 'done').length;
              return (
                <li key={t.id} className="text-sm">
                  <div className="flex items-center gap-2"><span className="pulse-dot h-2 w-2 rounded-full bg-accent" aria-hidden /><span className="truncate">{t.title}</span></div>
                  <div className="ml-4 text-[11px] text-dim">{cur ? `${cur.agentId}: ${cur.title}` : 'Planificando…'} · {done}/{t.subtasks.length || '?'}</div>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted">Ningún agente trabajando ahora.</p>}
      </Panel>
      <Panel title="Confirmaciones" icon={ShieldAlert}>
        {pending?.length
          ? <div className="space-y-2"><p className="text-sm">{pending.length} pendiente{pending.length > 1 ? 's' : ''}.</p><Button tone="accent" onClick={() => navigate('seguridad')}>Revisar</Button></div>
          : <p className="text-sm text-muted">Nada pendiente.</p>}
      </Panel>
      <Panel title="Actividad" icon={Bell} actions={<Button tone="ghost" onClick={() => navigate('notificaciones')}>Todo</Button>}>
        {feed.length ? (
          <ul className="space-y-2">
            {feed.filter((f) => f.type !== 'audit.appended' && f.type !== 'assistant.state').slice(0, 4).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{EVENT_LABEL[f.type] ?? f.type}</span>
                <span className="shrink-0 text-[11px] text-dim">{timeAgo(f.ts)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Sin eventos todavía.</p>}
        <div className="mt-4 space-y-1.5 border-t border-navy-700 pt-3">
          <Planned icon={CalendarDays} title="Calendario" phase={8} />
          <Planned icon={CloudSun} title="Tiempo" phase={8} />
          <Planned icon={Workflow} title="Automatizaciones" phase={9} />
        </div>
      </Panel>
    </div>
  );

  return (
    <div className="mx-auto grid min-h-full max-w-[1500px] gap-6 xl:grid-cols-[290px_1fr_290px]">
      <div className="order-2 xl:order-1">{left}</div>

      {/* Núcleo flotando en el espacio */}
      <div className="order-1 flex flex-col items-center xl:order-2">
        <div className="relative aspect-square w-full max-w-[640px]">
          <AICore state={assistant} accent={accent} motion={appearance.motion} particles={appearance.particles} className="h-full w-full" />
        </div>
        <div className="-mt-6 flex flex-col items-center text-center">
          <div className="font-display text-[10px] tracking-[0.5em] text-dim uppercase">Estado</div>
          <div className="holo-text mt-1 font-display text-xl font-semibold tracking-[0.25em] uppercase" aria-live="polite">{STATE_LABEL[assistant]}</div>
        </div>
        {routeLabel && <div className="mt-3 rounded-full border border-accent/30 bg-accent/8 px-2.5 py-0.5 font-mono text-[10px] text-accent-soft">⟐ {routeLabel}</div>}
        <p className={`mt-4 min-h-[1.5rem] max-w-2xl px-2 text-center font-mono text-sm whitespace-pre-line text-ink/90 [text-shadow:0_0_12px_rgb(var(--accent-rgb)/0.6)] ${subtitle.live ? 'typing-caret' : ''}`} aria-live="polite">
          {shown || (status === 'online'
            ? (ai?.configured ? 'A su servicio. ¿En qué puedo ayudarle?' : 'Núcleo operativo. Añade tu clave API en Configuración para activar el cerebro.')
            : 'Esperando al núcleo local…')}
        </p>
        <div className="mt-5 flex w-full justify-center px-2">
          {ai?.configured ? <CommandBar onSubtitle={(text, live) => setSubtitle({ text, live })} onRoute={setRouteLabel} /> : <Button tone="accent" onClick={() => navigate('configuracion')}>Configurar el cerebro</Button>}
        </div>
      </div>

      <div className="order-3">{right}</div>
    </div>
  );
}
