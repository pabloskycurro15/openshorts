import { useState } from 'react';
import { BadgeCheck, KeyRound, ShieldAlert, Siren, Eye } from 'lucide-react';
import type { ApprovalRequest } from '@jarvis/shared';
import { Badge, Button, Empty, ErrorNote, Panel } from '../components/ui';
import { useConnection, useCoreData } from '../lib/connection';
import { core } from '../lib/api';
import { PRINCIPAL_LABEL, RISK_LABEL, timeAgo } from '../lib/labels';

const RISK_TONE = { low: 'ok', medium: 'warn', high: 'danger', critical: 'danger' } as const;

function ApprovalCard({ a, onDone }: { a: ApprovalRequest; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const decide = async (d: 'approved' | 'approved_always' | 'denied') => {
    setBusy(true);
    try {
      const r = await core.resolveApproval(a.id, d);
      onDone(d === 'denied' ? 'Operación denegada.' : r.status === 'ok' ? 'Operación aprobada y ejecutada.' : `Resultado: ${r.status}`);
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-lg border border-navy-600 bg-navy-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-amber-200">{a.tool}</span>
        <Badge tone={RISK_TONE[a.risk]}>Riesgo {RISK_LABEL[a.risk]}</Badge>
        <span className="text-xs text-dim">{PRINCIPAL_LABEL[a.principal.kind]} · {a.principal.id} · {timeAgo(a.createdAt)}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{a.reason}</p>
      <pre className="mt-2 max-h-32 overflow-auto rounded bg-bg/70 p-2 font-mono text-xs text-ink">{JSON.stringify(a.args, null, 2)}</pre>
      <div className="mt-2 flex gap-2">
        <Button tone="accent" disabled={busy} onClick={() => decide('approved')}>Aprobar</Button>
        {a.principal.kind !== 'user' && (a.risk === 'low' || a.risk === 'medium') && <Button disabled={busy} onClick={() => decide('approved_always')}>Aprobar siempre</Button>}
        <Button tone="danger" disabled={busy} onClick={() => decide('denied')}>Denegar</Button>
      </div>
    </li>
  );
}

export function SecuritySection() {
  const { lockdown, setLockdownLocal } = useConnection();
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [verify, setVerify] = useState<string | null>(null);
  const approvals = useCoreData(() => core.approvals('pending'));
  const grants = useCoreData(() => core.grants());

  const toggleLockdown = async (v: boolean) => {
    try {
      const r = await core.emergency(v);
      setLockdownLocal(r.lockdown);
      setNote(v ? `Modo emergencia ACTIVADO. ${r.cancelledApprovals} confirmaciones canceladas.` : 'Modo emergencia desactivado.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
    setConfirming(false);
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
      <Panel title="Centro de emergencia" icon={Siren} className={`lg:col-span-2 ${lockdown ? 'border-danger/60' : ''}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm">
              {lockdown
                ? <><strong className="text-danger">Bloqueo activo.</strong> Ninguna operación que modifique algo puede ejecutarse, ni siquiera las ya aprobadas.</>
                : 'Bloquea al instante cualquier operación con efectos: agentes, automatizaciones, conectores y comandos.'}
            </p>
            <p className="mt-1 text-xs text-dim">Las consultas de solo lectura (como el monitor) siguen funcionando.</p>
          </div>
          {lockdown ? (
            <Button onClick={() => toggleLockdown(false)}>Desactivar bloqueo</Button>
          ) : confirming ? (
            <div className="flex gap-2"><Button tone="danger" onClick={() => toggleLockdown(true)}>Confirmar bloqueo</Button><Button tone="ghost" onClick={() => setConfirming(false)}>Cancelar</Button></div>
          ) : (
            <Button tone="danger" onClick={() => setConfirming(true)}><Siren size={14} aria-hidden /> Activar modo emergencia</Button>
          )}
        </div>
        {note && <p className="mt-3 text-sm text-accent-soft" role="status">{note}</p>}
      </Panel>

      <Panel title="Confirmaciones pendientes" icon={ShieldAlert}>
        {approvals.error && <ErrorNote>{approvals.error}</ErrorNote>}
        {approvals.data?.length ? (
          <ul className="space-y-3">{approvals.data.map((a) => <ApprovalCard key={a.id} a={a} onDone={(m) => { setNote(m); void approvals.refresh(); }} />)}</ul>
        ) : <Empty>No hay operaciones esperando tu autorización.</Empty>}
      </Panel>

      <Panel title="Permisos concedidos" icon={KeyRound}
        actions={grants.data?.length ? <Button tone="danger" onClick={async () => { const r = await core.revokeAll(); setNote(`${r.removed} permisos revocados.`); void grants.refresh(); }}>Revocar todos</Button> : undefined}>
        {grants.data?.length ? (
          <ul className="divide-y divide-navy-700">
            {grants.data.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-amber-200">{g.scope}</div>
                  <div className="text-xs text-dim">{PRINCIPAL_LABEL[g.principal.kind]} · {g.principal.id} · {g.mode === 'ask' ? 'preguntar siempre' : 'permitido'}</div>
                </div>
                <Button tone="ghost" onClick={async () => { await core.revoke(g.principal, g.scope); void grants.refresh(); }}>Revocar</Button>
              </li>
            ))}
          </ul>
        ) : <Empty>Nadie tiene permisos permanentes todavía. Se conceden con «Aprobar siempre» cuando JARVIS pide usar una herramienta.</Empty>}
      </Panel>

      <Panel title="Integridad del registro" icon={BadgeCheck}>
        <p className="text-sm text-muted">Comprueba que nadie ha alterado el historial de auditoría (cadena de hashes SHA-256).</p>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={async () => {
            const r = await core.verifyAudit();
            setVerify(r.ok ? `✔ Íntegro: ${r.count} entradas verificadas.` : `✖ Manipulación detectada en la entrada #${r.brokenAt}.`);
          }}>Verificar ahora</Button>
          {verify && <span role="status" className={`text-sm ${verify.startsWith('✔') ? 'text-ok' : 'text-danger'}`}>{verify}</span>}
        </div>
      </Panel>

      <Panel title="Sensores y privacidad" icon={Eye}>
        <ul className="space-y-2 text-sm">
          {[['Micrófono', 'Solo al pulsarlo · indicador rojo · auditado'], ['Cámara', 'Desactivada · sin uso previsto aún'], ['Análisis de pantalla', 'Desactivado · Fase 5, con indicador visible']].map(([k, v]) => (
            <li key={k} className="flex items-center justify-between"><span className="text-muted">{k}</span><Badge>{v}</Badge></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
