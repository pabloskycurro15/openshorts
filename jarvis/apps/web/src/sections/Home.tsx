import { Activity, Boxes, CalendarDays, CloudSun, ShieldAlert, Sparkles, Bot, Workflow, Bell } from 'lucide-react';
import { AICore } from '../components/AICore';
import { Badge, Button, Dot, Empty, Meter, Panel, Stat } from '../components/ui';
import { useConnection, useCoreData } from '../lib/connection';
import { core, formatBytes, formatDuration, formatUsd } from '../lib/api';
import { useSettings, ACCENTS } from '../lib/settings';
import { useSystemInfo } from '../lib/useSystem';
import { EVENT_LABEL, STATE_LABEL, timeAgo } from '../lib/labels';

function Planned({ icon: Icon, title, phase, text }: { icon: typeof Bot; title: string; phase: number; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-navy-700 bg-navy-900/50 p-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-dim" aria-hidden />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-ink">{title} <Badge>Fase {phase}</Badge></div>
        <p className="mt-0.5 text-xs text-muted">{text}</p>
      </div>
    </div>
  );
}

export function HomeSection({ navigate }: { navigate: (id: string) => void }) {
  const { assistant, status, lockdown, internet, feed } = useConnection();
  const { appearance } = useSettings();
  const { info, error: sysError } = useSystemInfo(4000, 2);
  const { data: health } = useCoreData(() => core.health(), [], 15000);
  const { data: pending } = useCoreData(() => core.approvals('pending'));
  const { data: ai } = useCoreData(() => core.aiStatus());
  const memUsed = info ? 1 - info.memory.freeBytes / info.memory.totalBytes : 0;
  const load = info ? (info.cpu.loadAvg[0] ?? 0) / info.cpu.cores : 0;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[1fr_1.35fr_1fr]">
      {/* Columna izquierda: estado */}
      <div className="space-y-4 xl:order-1 order-2">
        <Panel title="Estado del sistema" icon={Activity}>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center justify-between"><span className="text-muted">Núcleo</span>
              <span className="flex items-center gap-2"><Dot tone={status === 'online' ? 'ok' : 'danger'} />{status === 'online' ? `En línea · v${health?.version ?? '…'}` : 'Sin conexión'}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted">Internet</span>
              <span className="flex items-center gap-2"><Dot tone={internet ? 'ok' : 'danger'} />{internet ? 'Disponible' : 'Sin conexión'}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted">Seguridad</span>
              {lockdown ? <Badge tone="danger">Emergencia activa</Badge> : <Badge tone="ok">Normal</Badge>}</li>
            <li className="flex items-center justify-between"><span className="text-muted">Cerebro IA</span>
              {ai ? (ai.configured ? <Badge tone="ok">{ai.models.find((m) => m.id === ai.settings.model)?.label ?? ai.settings.model}</Badge> : <Badge tone="warn">Sin clave API</Badge>) : <Badge>…</Badge>}</li>
            {ai?.configured && <li><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Gasto del mes</span><span className="font-mono">{formatUsd(ai.spentMonthUsd)} / {formatUsd(ai.settings.monthlyLimitUsd)}</span></div>
              <Meter label="Gasto del mes" value={ai.budgetRatio} tone={ai.blocked ? 'danger' : ai.warn ? 'warn' : 'accent'} /></li>}
            <li className="flex items-center justify-between"><span className="text-muted">Voz</span><Badge>Fase 4</Badge></li>
            {health && <li className="flex items-center justify-between"><span className="text-muted">Núcleo activo</span><span className="font-mono text-xs">{formatDuration(health.uptimeSec)}</span></li>}
          </ul>
        </Panel>

        <Panel title="Módulos" icon={Boxes}>
          {health?.modules.length ? (
            <ul className="space-y-2">
              {health.modules.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{m.name} <span className="font-mono text-xs text-dim">{m.version}</span></span>
                  <Badge tone={m.status === 'running' ? 'ok' : m.status === 'failed' ? 'danger' : 'muted'}>{m.status === 'running' ? 'Activo' : m.status === 'failed' ? 'Fallo' : m.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty>Sin datos del núcleo.</Empty>}
        </Panel>
      </div>

      {/* Centro: núcleo */}
      <div className="xl:order-2 order-1">
        <div className="panel relative flex flex-col items-center overflow-hidden px-4 pt-4 pb-6">
          <div className="aspect-square w-full max-w-[520px]">
            <AICore state={assistant} accent={ACCENTS[appearance.accent].hex} motion={appearance.motion} particles={appearance.particles} className="h-full w-full" />
          </div>
          <div className="-mt-4 text-center">
            <div className="font-display text-xs tracking-[0.4em] text-dim uppercase">Estado</div>
            <div className="mt-1 font-display text-xl font-semibold tracking-[0.2em] text-ink glow-text uppercase" aria-live="polite">{STATE_LABEL[assistant]}</div>
            <p className="mx-auto mt-3 max-w-sm text-sm text-muted">
              {status === 'online'
                ? (ai?.configured ? 'A su servicio. Escríbeme en Conversación; la voz llega en la Fase 4.' : 'Núcleo operativo. Añade tu clave API en Configuración para activar el cerebro.')
                : 'Esperando al núcleo local. Arráncalo con «npm run dev» en la carpeta jarvis.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button tone="accent" onClick={() => navigate('conversacion')}>Conversar</Button>
              <Button onClick={() => navigate('comandos')}>Centro de comandos</Button>
              <Button onClick={() => navigate('laboratorio')}><Sparkles size={14} aria-hidden /> Probar estados</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Derecha: rendimiento y actividad */}
      <div className="space-y-4 xl:order-3 order-3">
        <Panel title="Rendimiento" icon={Activity} actions={<Button tone="ghost" onClick={() => navigate('monitor')}>Detalle</Button>}>
          {info ? (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">CPU · {info.cpu.cores} núcleos</span><span className="font-mono">{(load * 100).toFixed(0)} %</span></div>
                <Meter label="Carga de CPU" value={load} tone={load > 0.85 ? 'danger' : load > 0.6 ? 'warn' : 'accent'} />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Memoria</span><span className="font-mono">{formatBytes(info.memory.totalBytes - info.memory.freeBytes)} / {formatBytes(info.memory.totalBytes)}</span></div>
                <Meter label="Memoria usada" value={memUsed} tone={memUsed > 0.9 ? 'danger' : memUsed > 0.75 ? 'warn' : 'accent'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Equipo" value={info.hostname} sub={`${info.platform} · ${info.arch}`} />
                <Stat label="Encendido" value={formatDuration(info.uptimeSec)} />
              </div>
            </div>
          ) : <Empty>{sysError ?? 'Esperando datos…'}</Empty>}
        </Panel>

        <Panel title="Pendiente de tu confirmación" icon={ShieldAlert}>
          {pending?.length ? (
            <div className="space-y-2">
              <p className="text-sm">{pending.length} {pending.length === 1 ? 'operación espera' : 'operaciones esperan'} tu autorización.</p>
              <Button tone="accent" onClick={() => navigate('seguridad')}>Revisar</Button>
            </div>
          ) : <p className="text-sm text-muted">Nada pendiente.</p>}
        </Panel>

        <Panel title="Actividad reciente" icon={Bell} actions={<Button tone="ghost" onClick={() => navigate('notificaciones')}>Todo</Button>}>
          {feed.length ? (
            <ul className="space-y-2">
              {feed.slice(0, 4).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{EVENT_LABEL[f.type] ?? f.type}</span>
                  <span className="shrink-0 text-xs text-dim">{timeAgo(f.ts)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Sin eventos desde que abriste la interfaz.</p>}
        </Panel>
      </div>

      {/* Fila inferior: lo que llegará, sin datos inventados */}
      <div className="order-4 xl:col-span-3">
        <Panel title="Próximamente en tu panel" icon={Sparkles}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Planned icon={CalendarDays} title="Calendario y tareas" phase={8} text="Se mostrará al conectar Google Calendar." />
            <Planned icon={CloudSun} title="Tiempo" phase={8} text="Requiere configurar un servicio meteorológico." />
            <Planned icon={Bot} title="Agentes trabajando" phase={7} text="Agentes activos, progreso y resultados." />
            <Planned icon={Workflow} title="Automatizaciones" phase={9} text="Rutinas activas y próximas ejecuciones." />
          </div>
        </Panel>
      </div>
    </div>
  );
}
