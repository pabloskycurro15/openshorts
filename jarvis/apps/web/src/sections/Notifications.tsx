import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Badge, Empty, Panel } from '../components/ui';
import { useConnection } from '../lib/connection';
import { EVENT_LABEL, timeAgo } from '../lib/labels';

function describe(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'approval.requested': return `«${String(p.tool)}» necesita tu confirmación (${String(p.reason)})`;
    case 'approval.resolved': return `«${String(p.tool)}»: ${String(p.status)}`;
    case 'tool.invoked': return `${String(p.tool)} → ${String(p.outcome)}`;
    case 'module.status': return `Módulo ${String(p.id)}: ${String(p.status)}${p.error ? ` (${String(p.error)})` : ''}`;
    case 'emergency.changed': return p.lockdown ? 'Modo emergencia ACTIVADO' : 'Modo emergencia desactivado';
    case 'assistant.state': return `Estado: ${String(p.state)}`;
    case 'audit.appended': return `${String(p.action)} ${p.target ? `· ${String(p.target)}` : ''}`;
    default: return type;
  }
}

export function NotificationsSection() {
  const { feed } = useConnection();
  const [showAudit, setShowAudit] = useState(false);
  const items = showAudit ? feed : feed.filter((f) => f.type !== 'audit.appended');
  return (
    <Panel title="Eventos en directo" icon={Bell} className="mx-auto max-w-4xl"
      actions={<label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showAudit} onChange={(e) => setShowAudit(e.target.checked)} className="accent-[var(--accent)]" /> Incluir auditoría</label>}>
      <p className="mb-3 text-xs text-dim">Eventos recibidos desde que abriste la interfaz. La lectura en voz alta de notificaciones autorizadas llegará con la Fase 4.</p>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-3 rounded-lg border border-navy-700 bg-navy-900/50 p-3">
              <div className="min-w-0">
                <Badge tone={f.type.startsWith('approval') || f.type === 'emergency.changed' ? 'accent' : 'muted'}>{EVENT_LABEL[f.type] ?? f.type}</Badge>
                <p className="mt-1.5 truncate text-sm">{describe(f.type, (f.payload ?? {}) as Record<string, unknown>)}</p>
              </div>
              <span className="shrink-0 text-xs text-dim">{timeAgo(f.ts)}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>Todavía no ha llegado ningún evento.</Empty>}
    </Panel>
  );
}
