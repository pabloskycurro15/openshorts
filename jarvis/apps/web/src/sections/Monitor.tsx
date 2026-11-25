import { Cpu, HardDrive, ListTree, Server } from 'lucide-react';
import { Badge, Empty, ErrorNote, Meter, Panel, Stat } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import { useEffect, useState } from 'react';
import { core, formatBytes, formatDuration } from '../lib/api';
import { useSystemInfo } from '../lib/useSystem';

export function MonitorSection() {
  const { info, history, error } = useSystemInfo(2000, 90);
  if (!info) return error ? <ErrorNote>{error}</ErrorNote> : <Empty>Esperando datos del núcleo…</Empty>;
  const memUsed = 1 - info.memory.freeBytes / info.memory.totalBytes;
  const load = (info.cpu.usagePercent ?? ((info.cpu.loadAvg[0] ?? 0) / info.cpu.cores) * 100) / 100;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
      <Panel title="Procesador" icon={Cpu}>
        <div className="mb-3 flex items-end justify-between">
          <Stat label="Uso de CPU" value={`${(load * 100).toFixed(0)} %`} sub={info.cpu.model} />
          <Badge>{info.cpu.cores} núcleos</Badge>
        </div>
        <Sparkline values={history.map((h) => h.load)} label="Histórico de uso de CPU" />
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

      <Panel title="Procesos con más CPU" icon={ListTree}><Processes /></Panel>
    </div>
  );
}

interface Proc { pid: number; name: string; cpu: number | null; memoryBytes: number | null }
function Processes() {
  const [list, setList] = useState<Proc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      const r = await core.invoke('system.processes', { limit: 12 }).catch((e: Error) => ({ status: 'error' as const, error: e.message }));
      if (!alive) return;
      if (r.status === 'ok') { setList(r.output as Proc[]); setErr(null); } else setErr(r.status === 'error' ? r.error : r.status);
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!list) return <Empty>Cargando…</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-[11px] tracking-wider text-dim uppercase"><tr><th className="py-1">Proceso</th><th>PID</th><th className="text-right">CPU</th><th className="text-right">Memoria</th></tr></thead>
      <tbody className="divide-y divide-navy-700">
        {list.map((p) => (
          <tr key={p.pid}><td className="max-w-[160px] truncate py-1">{p.name}</td><td className="font-mono text-xs text-dim">{p.pid}</td>
            <td className="text-right font-mono text-xs">{p.cpu ?? '—'}</td><td className="text-right font-mono text-xs">{p.memoryBytes !== null ? formatBytes(p.memoryBytes) : '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
