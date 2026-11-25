import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import type { AuditEntry } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { useConnection } from '../lib/connection';
import { core } from '../lib/api';
import { PRINCIPAL_LABEL } from '../lib/labels';

const OUTCOME = { success: ['ok', 'Correcto'], failure: ['danger', 'Fallo'], denied: ['warn', 'Denegado'], pending: ['accent', 'Pendiente'] } as const;
const PAGE = 40;

export function HistorySection() {
  const { status, revision } = useConnection();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (status !== 'online') return;
    core.audit(PAGE).then((r) => { setRows(r); setMore(r.length === PAGE); setError(null); }).catch((e: Error) => setError(e.message));
  }, [status, revision]);

  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    const r = await core.audit(PAGE, last.seq);
    setRows((x) => [...x, ...r]);
    setMore(r.length === PAGE);
  };

  const shown = filter ? rows.filter((r) => `${r.action} ${r.target ?? ''} ${r.principal.id}`.toLowerCase().includes(filter.toLowerCase())) : rows;

  return (
    <Panel title="Registro de auditoría" icon={History} className="mx-auto max-w-6xl"
      actions={<input aria-label="Filtrar" placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)}
        className="w-36 rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1 text-sm outline-none focus:border-accent sm:w-56" />}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {shown.length ? (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] tracking-wider text-dim uppercase">
              <tr><th className="px-4 py-2 sm:px-2">#</th><th className="px-2">Fecha</th><th className="px-2">Quién</th><th className="px-2">Acción</th><th className="px-2">Objetivo</th><th className="px-2">Resultado</th></tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {shown.map((r) => {
                const [tone, label] = OUTCOME[r.outcome];
                return (
                  <tr key={r.seq} className="hover:bg-navy-800/50">
                    <td className="px-4 py-2 font-mono text-xs text-dim sm:px-2">{r.seq}</td>
                    <td className="px-2 font-mono text-xs whitespace-nowrap">{new Date(r.ts).toLocaleString('es-ES')}</td>
                    <td className="px-2 text-xs">{PRINCIPAL_LABEL[r.principal.kind]} · {r.principal.id}</td>
                    <td className="px-2 font-mono text-xs text-amber-200">{r.action}</td>
                    <td className="px-2 font-mono text-xs">{r.target ?? '—'}</td>
                    <td className="px-2"><Badge tone={tone}>{label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>Sin entradas.</Empty>}
      {more && !filter && rows.length > 0 && <div className="mt-4 text-center"><Button onClick={loadMore}>Cargar más</Button></div>}
    </Panel>
  );
}
