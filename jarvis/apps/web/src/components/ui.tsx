import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Panel({ title, icon: Icon, actions, children, className = '' }: {
  title?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 sm:p-5 ${className}`}>
      <span aria-hidden className="hud-corner tl" /><span aria-hidden className="hud-corner tr" />
      <span aria-hidden className="hud-corner bl" /><span aria-hidden className="hud-corner br" />
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-[11px] font-semibold tracking-[0.2em] text-muted uppercase">
            {Icon && <Icon size={14} className="text-accent drop-shadow-[0_0_6px_var(--accent)]" aria-hidden />}
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
const TONE: Record<Tone, string> = {
  accent: 'text-accent border-accent/40 bg-accent/10',
  ok: 'text-ok border-ok/40 bg-ok/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
  muted: 'text-muted border-navy-600 bg-navy-800/60',
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const bg = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', muted: 'bg-dim' }[tone];
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${bg} ${pulse ? 'pulse-dot' : ''}`} />;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] tracking-wider text-dim uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-lg text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Meter({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'warn' | 'danger'; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const bar = { accent: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 w-full overflow-hidden rounded-full bg-navy-700">
      <div className={`h-full rounded-full ${bar} transition-[width] duration-700`} style={{ width: `${pct}%`, boxShadow: '0 0 10px var(--accent)' }} />
    </div>
  );
}

export function Button({ children, onClick, tone = 'default', disabled, type = 'button', title }: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'accent' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const cls = {
    default: 'border-navy-600 bg-navy-800 text-ink hover:border-accent/60',
    accent: 'border-accent bg-accent text-bg font-semibold hover:bg-accent-soft',
    danger: 'border-danger/60 bg-danger/15 text-danger hover:bg-danger/25',
    ghost: 'border-transparent bg-transparent text-muted hover:text-ink',
  }[tone];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-navy-600 p-4 text-center text-sm text-muted">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{children}</p>;
}
