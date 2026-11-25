import { CheckCircle2, Clock } from 'lucide-react';
import { Badge, Panel } from '../components/ui';
import type { SectionDef } from './registry';

/** Sección aún no operativa: explica con honestidad qué hará y cuándo. Sin datos inventados. */
export function PlannedSection({ section }: { section: SectionDef }) {
  const Icon = section.icon;
  return (
    <div className="mx-auto max-w-3xl">
      <Panel>
        <div className="flex flex-col items-center py-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-navy-600 bg-navy-900">
            <Icon size={28} className="text-accent" aria-hidden />
          </div>
          <h2 className="mt-4 font-display text-lg tracking-[0.15em] uppercase">{section.label}</h2>
          <div className="mt-2"><Badge tone="accent"><Clock size={12} aria-hidden /> Disponible en la Fase {section.phase}</Badge></div>
          <p className="mt-3 max-w-md text-sm text-muted">Esta sección todavía no funciona. Así quedará cuando su fase esté terminada y probada:</p>
        </div>
        <ul className="mx-auto max-w-lg space-y-2 pb-4">
          {section.planned?.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-dim" aria-hidden />{p}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
