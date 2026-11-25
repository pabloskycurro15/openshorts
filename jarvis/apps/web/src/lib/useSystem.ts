import { useEffect, useRef, useState } from 'react';
import { core, type SystemInfo } from './api';
import { useConnection } from './connection';

export interface Sample {
  t: number;
  memUsed: number; // 0-1
  load: number; // carga 1 min normalizada por núcleos (0-1+)
}

/** Sondea system.info y conserva un histórico corto para las gráficas. */
export function useSystemInfo(intervalMs = 3000, keep = 60) {
  const { status } = useConnection();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (status !== 'online') return;
    let alive = true;
    const tick = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const r = await core.invoke('system.info');
        if (!alive) return;
        if (r.status !== 'ok') throw new Error(r.status === 'error' ? r.error : r.status === 'denied' ? r.reason : 'Pendiente de aprobación');
        const i = r.output as SystemInfo;
        setInfo(i);
        setError(null);
        setHistory((h) => [...h, {
          t: Date.now(),
          memUsed: 1 - i.memory.freeBytes / i.memory.totalBytes,
          load: (i.cpu.loadAvg[0] ?? 0) / Math.max(i.cpu.cores, 1),
        }].slice(-keep));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [status, intervalMs, keep]);

  return { info, history, error };
}
