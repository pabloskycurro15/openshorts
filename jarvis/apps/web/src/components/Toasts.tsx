import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useConnection } from '../lib/connection';

/** Avisos emergentes (herramienta notify.send y automatizaciones). Desaparecen a los 8 s. */
export function Toasts() {
  const { feed } = useConnection();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const items = feed.filter((f) => f.type === 'notification' && !hidden.has(f.id) && now - new Date(f.ts).getTime() < 8000).slice(0, 3);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {items.map((f) => {
        const p = f.payload as { title: string; body: string };
        return (
          <div key={f.id} role="status" className="pointer-events-auto flex gap-3 rounded-xl border border-accent/50 bg-navy-900/95 p-3 shadow-[0_0_24px_rgb(var(--accent-rgb)/0.35)] backdrop-blur">
            <BellRing size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">{p.title}</div>
              {p.body && <div className="mt-0.5 line-clamp-3 text-xs text-muted">{p.body}</div>}
            </div>
            <button type="button" onClick={() => setHidden((h) => new Set(h).add(f.id))} className="text-dim hover:text-ink" aria-label="Cerrar aviso"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
