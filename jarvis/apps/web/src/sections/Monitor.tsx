import { Cpu, HardDrive, ListTree, Server } from 'lucide-react';
import { Badge, Empty, ErrorNote, Meter, Panel, Stat } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import { formatBytes, formatDuration } from '../lib/api';
import { useSystemInfo } from '../lib/useSystem';

export function MonitorSection() {
  const { info, history, error } = useSystemInfo(2000, 90);
  if (!info) return error ? <ErrorNote>{error}</ErrorNote> : <Empty>Esperando datos del núcleo…</Empty>;
  const memUsed = 1 - info.memory.freeBytes / info.memory.totalBytes;
  const load = (info.cpu.loadAvg[0] ?? 0) / info.cpu.cores;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
      <Panel title="Procesador" icon={Cpu}>
        <div className="mb-3 flex items-end justify-between">
          <Stat label="Carga (1 min)" value={`${(load * 100).toFixed(0)} %`} sub={info.cpu.model} />
          <Badge>{info.cpu.cores} núcleos</Badge>
        </div>
        <Sparkline values={history.map((h) => h.load)} label="Histórico de carga de CPU" />
        <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs text-muted">
          {['1 min', '5 min', '15 min'].map((l, i) => <div key={l}>{l}: <span className="text-ink">{(info.cpu.loadAvg[i] ?? 0).toFixed(2)}</span></div>)}
        </div>
        {info.platform === 'win32' && <p className="mt-3 text-xs text-dim">En Windows la carga media no está disponible en Node; la Fase 5 añadirá el uso de CPU por contadores del sistema.</p>}
      </Panel>

      <Panel title="Memoria" icon={HardDrive}>
        <div className="mb-3"><Stat label="En uso" value={`${(memUsed * 100).toFixed(0)} %`} sub={`${formatBytes(info.memory.totalBytes - info.memory.freeBytes)} de ${formatBytes(info.memory.totalBytes)}`} /></div>
        <Sparkline values={history.map((h) => h.memUsed)} label="Histórico de memoria usada" />
        <div className="mt-3"><Meter label="Memoria usada" value={memUsed} tone={memUsed > 0.9 ? 'danger' : memUsed > 0.75 ? 'warn' : 'accent'} /></div>
      </Panel>

      <Panel title="Sistema" icon={Server}>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Equipo" value={info.hostname} />
          <Stat label="Sistema" value={info.platform} sub={info.release} />
          <Stat label="Arquitectura" value={info.arch} />
          <Stat label="Encendido" value={formatDuration(info.uptimeSec)} />
        </div>
      </Panel>

      <Panel title="Procesos activos" icon={ListTree}>
        <Empty>La lista de procesos y su control llegan con el módulo de control de Windows (Fase 5), con permisos y confirmación.</Empty>
      </Panel>
    </div>
  );
}
