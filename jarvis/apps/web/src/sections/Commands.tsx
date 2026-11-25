import { useState } from 'react';
import { Play, TerminalSquare } from 'lucide-react';
import type { ToolDescriptor, ToolResult } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { useCoreData } from '../lib/connection';
import { core } from '../lib/api';
import { RISK_LABEL } from '../lib/labels';

const RISK_TONE = { low: 'ok', medium: 'warn', high: 'danger', critical: 'danger' } as const;

function ToolRunner({ tool }: { tool: ToolDescriptor }) {
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState<ToolResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setErr(null);
    let parsed: unknown;
    try { parsed = JSON.parse(args); } catch { setErr('Los argumentos deben ser JSON válido.'); return; }
    setBusy(true);
    try { setResult(await core.invoke(tool.name, parsed)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{tool.description}</p>
      <div className="flex flex-wrap gap-2">
        <Badge tone={RISK_TONE[tool.risk]}>Riesgo {RISK_LABEL[tool.risk]}</Badge>
        <Badge>{tool.sideEffects ? 'Modifica cosas' : 'Solo lectura'}</Badge>
        {tool.permissions.map((p) => <Badge key={p}>{p}</Badge>)}
      </div>
      <p className="text-xs text-dim">Devuelve: {tool.returns}</p>
      <label className="block text-xs tracking-wider text-dim uppercase" htmlFor={`args-${tool.name}`}>Argumentos (JSON)</label>
      <textarea id={`args-${tool.name}`} value={args} onChange={(e) => setArgs(e.target.value)} rows={3} spellCheck={false}
        className="w-full rounded-lg border border-navy-600 bg-bg/70 p-2 font-mono text-xs text-ink outline-none focus:border-accent" />
      <Button tone="accent" onClick={run} disabled={busy}><Play size={14} aria-hidden /> Ejecutar</Button>
      {err && <ErrorNote>{err}</ErrorNote>}
      {result && (
        <div>
          <Badge tone={result.status === 'ok' ? 'ok' : result.status === 'pending_approval' ? 'accent' : 'danger'}>
            {{ ok: 'Correcto', pending_approval: 'Esperando confirmación en Seguridad', denied: 'Denegado', error: 'Error' }[result.status]}
          </Badge>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg/70 p-3 font-mono text-xs text-ink">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function CommandsSection() {
  const { data: tools, error } = useCoreData(() => core.tools());
  const [sel, setSel] = useState<string | null>(null);
  const current = tools?.find((t) => t.name === (sel ?? tools[0]?.name));
  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[280px_1fr]">
      <Panel title="Herramientas" icon={TerminalSquare}>
        {error && <ErrorNote>{error}</ErrorNote>}
        {tools?.length ? (
          <ul className="space-y-1">
            {tools.map((t) => (
              <li key={t.name}>
                <button type="button" onClick={() => setSel(t.name)}
                  className={`w-full rounded-lg px-3 py-2 text-left font-mono text-sm ${current?.name === t.name ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-navy-800'}`}>{t.name}</button>
              </li>
            ))}
          </ul>
        ) : <Empty>Sin herramientas.</Empty>}
        <p className="mt-4 text-xs text-dim">Cada fase añadirá herramientas nuevas (archivos, ventanas, conectores…). Todas pasan por permisos y auditoría.</p>
      </Panel>
      <Panel title={current?.name ?? 'Herramienta'}>{current ? <ToolRunner key={current.name} tool={current} /> : <Empty>Selecciona una herramienta.</Empty>}</Panel>
    </div>
  );
}
