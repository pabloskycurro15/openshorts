import { useState, type ReactNode } from 'react';
import { Mic, MicOff, CameraOff, Menu, MonitorOff, Wifi, WifiOff, X, Siren, Cpu } from 'lucide-react';
import { useConnection, useCoreData, type LinkStatus } from '../lib/connection';
import { core } from '../lib/api';
import { STATE_LABEL } from '../lib/labels';
import { SECTIONS, type SectionDef } from '../sections/registry';
import { Dot } from './ui';

const LINK: Record<LinkStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  online: { label: 'Núcleo en línea', tone: 'ok' },
  connecting: { label: 'Conectando…', tone: 'warn' },
  offline: { label: 'Núcleo sin conexión', tone: 'danger' },
  unauthorized: { label: 'Token no válido', tone: 'danger' },
  'no-token': { label: 'Sin vincular', tone: 'muted' },
};

function Indicator({ icon: Icon, label, active, tone }: { icon: typeof Mic; label: string; active: boolean; tone?: 'ok' | 'danger' | 'accent' }) {
  const color = active ? { ok: 'text-ok', danger: 'text-danger', accent: 'text-accent' }[tone ?? 'accent'] : 'text-dim';
  return (
    <span title={label} aria-label={label} className={`flex h-8 w-8 items-center justify-center rounded-lg border border-navy-700 bg-navy-900/70 ${color}`}>
      <Icon size={15} aria-hidden />
    </span>
  );
}

function NavItem({ s, active, onSelect, badge }: { s: SectionDef; active: boolean; onSelect: () => void; badge?: number }) {
  const Icon = s.icon;
  const ready = s.phase <= 2;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
          active ? 'bg-accent/12 text-ink shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-navy-800 hover:text-ink'
        }`}
      >
        <Icon size={16} aria-hidden className={active ? 'text-accent' : 'text-dim group-hover:text-accent-soft'} />
        <span className="flex-1 truncate">{s.label}</span>
        {!!badge && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-bg">{badge}</span>}
        {!ready && <span className="font-mono text-[10px] text-dim" title={`Disponible en la Fase ${s.phase}`}>F{s.phase}</span>}
      </button>
    </li>
  );
}

export function Shell({ route, navigate, children }: { route: string; navigate: (id: string) => void; children: ReactNode }) {
  const { status, assistant, lockdown, internet } = useConnection();
  const [open, setOpen] = useState(false);
  const { data: pending } = useCoreData(() => core.approvals('pending'));
  const pendingCount = pending?.length ?? 0;
  const link = LINK[status];
  const current = SECTIONS.find((s) => s.id === route);

  const nav = (
    <nav aria-label="Secciones" className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-3 pt-5 pb-6">
        <div className="relative h-9 w-9">
          <span className="absolute inset-0 rounded-full border-2 border-accent/70" />
          <span className="absolute inset-[9px] rounded-full bg-accent shadow-[0_0_14px_var(--accent)]" />
        </div>
        <div>
          <div className="font-display text-lg font-bold tracking-[0.3em] text-ink glow-text">JARVIS</div>
          <div className="text-[10px] tracking-widest text-dim uppercase">v0.2 · Fase 2</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {SECTIONS.map((s) => (
          <NavItem key={s.id} s={s} active={route === s.id} badge={s.id === 'seguridad' ? pendingCount : undefined}
            onSelect={() => { navigate(s.id); setOpen(false); }} />
        ))}
      </ul>
      <div className="border-t border-navy-700 px-4 py-3 text-xs text-muted">
        <div className="flex items-center gap-2"><Dot tone={link.tone} pulse={status === 'connecting'} />{link.label}</div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-navy-700 bg-navy-950/80 backdrop-blur lg:block">{nav}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-navy-700 bg-navy-950">
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="absolute top-5 right-3 text-muted hover:text-ink"><X size={18} /></button>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-navy-700 bg-navy-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <button type="button" className="text-muted hover:text-ink lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-sm font-semibold tracking-[0.18em] text-ink uppercase">{current?.label ?? 'JARVIS'}</h1>
            <p className="truncate text-xs text-muted">{current?.summary}</p>
          </div>
          {lockdown && (
            <button type="button" onClick={() => navigate('seguridad')} className="flex items-center gap-1.5 rounded-lg border border-danger/60 bg-danger/15 px-2.5 py-1.5 text-xs font-semibold text-danger">
              <Siren size={14} aria-hidden /> <span className="hidden sm:inline">Modo emergencia</span>
            </button>
          )}
          <div className="hidden items-center gap-2 rounded-lg border border-navy-700 bg-navy-900/70 px-2.5 py-1.5 text-xs text-muted md:flex" aria-live="polite">
            <Cpu size={13} aria-hidden className="text-accent" /> {STATE_LABEL[assistant]}
          </div>
          <div className="flex items-center gap-1.5" aria-label="Indicadores de privacidad y conexión">
            <Indicator icon={internet ? Wifi : WifiOff} label={internet ? 'Internet disponible' : 'Sin Internet'} active tone={internet ? 'ok' : 'danger'} />
            <Indicator icon={assistant === 'listening' ? Mic : MicOff} label={assistant === 'listening' ? 'Micrófono ACTIVO' : 'Micrófono desactivado'} active={assistant === 'listening'} tone="danger" />
            <span className="hidden sm:contents">
              <Indicator icon={CameraOff} label="Cámara desactivada" active={false} />
              <Indicator icon={MonitorOff} label="Pantalla no se está analizando" active={false} />
            </span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
