import { useState } from 'react';
import { Archive, CheckCircle2, CloudUpload, Download, RotateCcw, ShieldCheck, Stethoscope, Trash2, Wrench, XCircle, AlertTriangle } from 'lucide-react';
import type { BackupView, SecurityAlert } from '@jarvis/shared';
import { Badge, Button, Panel } from './ui';
import { core, formatBytes } from '../lib/api';
import { useCoreData } from '../lib/connection';
import { timeAgo } from '../lib/labels';

const input = 'rounded-lg border border-navy-600 bg-navy-950/60 px-2.5 py-1.5 text-sm outline-none focus:border-accent';
type Msg = { ok: boolean; text: string } | null;

function useRun(refresh: () => unknown) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    setBusy(false);
    void refresh();
  };
  return { msg, busy, run };
}
const Note = ({ msg }: { msg: Msg }) => (msg ? <p role="status" className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p> : null);

/** Copias de seguridad cifradas con restauración verificada, local y (opcional) en Supabase. */
export function BackupPanel() {
  const { data: s, refresh } = useCoreData(() => core.backups(), [], 8000);
  const { msg, busy, run } = useRun(refresh);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [sbKey, setSbKey] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  if (!s) return null;
  const local = s.backups.filter((b) => b.location === 'local');
  const remote = s.backups.filter((b) => b.location === 'supabase');
  const restore = (b: BackupView) => void run(async () => {
    const other = window.prompt('Frase de ESA copia (déjalo vacío si es la frase actual):') ?? null;
    if (other === null) return;
    const r = await core.restoreBackup(b.id, other || undefined);
    return `Restauración preparada (copia del ${new Date(r.createdAt).toLocaleString('es-ES')}). ${r.detail}. Cierra y vuelve a abrir JARVIS para aplicarla; los datos actuales se guardarán aparte.`;
  });
  return (
    <Panel title="Copias de seguridad" icon={Archive} className="lg:col-span-2">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">Se cifran con tu frase antes de guardarse o subirse (nadie puede leerlas sin ella) y cada copia se comprueba abriéndola. Incluyen la base de datos y la clave de tus secretos, para restaurar en otro PC.</p>
          {s.restorePending && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
              <RotateCcw size={14} aria-hidden /> Restauración preparada: se aplicará al reiniciar JARVIS.
              <Button tone="ghost" onClick={() => void run(async () => { await core.cancelRestore(); return 'Restauración cancelada.'; })}>Cancelar</Button>
            </div>
          )}
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (pass !== pass2) { void run(async () => { throw new Error('Las frases no coinciden'); }); return; } void run(async () => { await core.backupPassphrase(pass); setPass(''); setPass2(''); return 'Frase guardada (cifrada en este equipo).'; }); }}>
            <div className="text-xs text-muted">{s.hasPassphrase ? <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 size={12} aria-hidden /> Frase de copias definida</span> : 'Define una frase de al menos 12 caracteres. Apúntala en un sitio seguro: sin ella no se puede restaurar en otro equipo.'}</div>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Frase de las copias" type="password" autoComplete="new-password" className={`${input} min-w-0 flex-1`} placeholder={s.hasPassphrase ? 'Nueva frase (opcional)' : 'Frase'} value={pass} onChange={(e) => setPass(e.target.value)} />
              <input aria-label="Repite la frase" type="password" autoComplete="new-password" className={`${input} min-w-0 flex-1`} placeholder="Repítela" value={pass2} onChange={(e) => setPass2(e.target.value)} />
              <Button type="submit" disabled={busy || pass.length < 12}>Guardar</Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent)]" checked={s.settings.auto} disabled={!s.hasPassphrase} onChange={(e) => void run(async () => { await core.backupSettings({ auto: e.target.checked }); })} /> Copia automática diaria a las</label>
            <input aria-label="Hora de la copia" type="time" className={input} value={s.settings.time} onChange={(e) => void run(async () => { await core.backupSettings({ time: e.target.value }); })} />
            <label className="flex items-center gap-2">Conservar <input aria-label="Copias a conservar" type="number" min={1} max={60} className={`${input} w-16`} value={s.settings.keep} onChange={(e) => void run(async () => { await core.backupSettings({ keep: Number(e.target.value) }); })} /></label>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-[var(--accent)]" checked={s.settings.includeWhatsapp} onChange={(e) => void run(async () => { await core.backupSettings({ includeWhatsapp: e.target.checked }); })} /> Incluir la sesión de WhatsApp (restaurar sin volver a escanear el QR)</label>
          <div className="text-[11px] text-dim">Carpeta: <span className="font-mono">{s.dir}</span>{s.nextAuto && ` · próxima: ${new Date(s.nextAuto).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}</div>
          <Button tone="accent" disabled={busy || !s.hasPassphrase} onClick={() => void run(async () => { const b = await core.createBackup(); return `Copia creada y verificada (${formatBytes(b.size)}). ${b.verifyDetail ?? ''}`; })}><Archive size={14} aria-hidden /> {busy ? 'Trabajando…' : 'Hacer una copia ahora'}</Button>
          <details className="rounded-lg border border-navy-700 p-3 text-xs">
            <summary className="flex cursor-pointer items-center gap-2 text-muted"><CloudUpload size={14} className="text-accent" aria-hidden /> Copia externa en Supabase Storage {s.settings.offsite ? <Badge tone="ok">Activa</Badge> : <Badge>Apagada</Badge>}</summary>
            <div className="mt-2 space-y-2">
              <p className="text-dim">Guarda una copia fuera de tu PC (por si se estropea o te lo roban). Sube solo el archivo cifrado. Plan gratuito de Supabase: 1 GB.</p>
              <div className="flex gap-2"><input aria-label="URL de Supabase" className={`${input} min-w-0 flex-1 font-mono text-xs`} placeholder={s.settings.supabaseUrl || 'https://tuproyecto.supabase.co'} value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} />
                <Button disabled={!sbUrl.trim()} onClick={() => void run(async () => { await core.backupSettings({ supabaseUrl: sbUrl.trim() }); setSbUrl(''); return 'URL guardada.'; })}>Guardar</Button></div>
              <div className="flex gap-2"><input aria-label="Clave secreta de Supabase" type="password" className={`${input} min-w-0 flex-1 font-mono text-xs`} placeholder={s.hasSupabaseKey ? 'Clave guardada (cifrada) · pega otra para cambiarla' : 'Clave secreta (sb_secret_…)'} value={sbKey} onChange={(e) => setSbKey(e.target.value)} />
                <Button disabled={sbKey.trim().length < 20} onClick={() => void run(async () => { await core.backupSupabaseKey(sbKey.trim()); setSbKey(''); return 'Clave guardada cifrada.'; })}>Guardar</Button></div>
              <div className="flex flex-wrap gap-2">
                <Button tone="ghost" disabled={!s.hasSupabaseKey || !s.settings.supabaseUrl} onClick={() => void run(async () => { const r = await core.backupSupabaseTest(); if (!r.ok) throw new Error(r.detail); return r.detail; })}>Probar y crear contenedor</Button>
                <Button tone={s.settings.offsite ? 'ghost' : 'accent'} disabled={!s.hasSupabaseKey || !s.settings.supabaseUrl} onClick={() => void run(async () => { await core.backupSettings({ offsite: !s.settings.offsite }); return s.settings.offsite ? 'Copia externa desactivada.' : 'Copia externa activada: las próximas copias también se subirán.'; })}>{s.settings.offsite ? 'Desactivar' : 'Activar copia externa'}</Button>
                {s.hasSupabaseKey && <Button tone="ghost" onClick={() => void run(async () => { await core.backupSupabaseKey(null); return 'Clave borrada.'; })}>Borrar clave</Button>}
              </div>
            </div>
          </details>
          <Note msg={msg} />
        </div>
        <div>
          <h4 className="mb-2 text-xs tracking-wider text-dim uppercase">Copias ({local.length} en este equipo{remote.length ? ` · ${remote.length} en Supabase` : ''})</h4>
          {s.backups.length ? (
            <ul className="space-y-1.5">
              {s.backups.slice(0, 12).map((b) => (
                <li key={b.id} className="rounded-lg border border-navy-700 bg-navy-900/50 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    {b.verified ? <ShieldCheck size={14} className="text-emerald-300" aria-label="Verificada" /> : <AlertTriangle size={14} className="text-amber-300" aria-label="Sin verificar" />}
                    <span className="truncate font-mono">{b.file}</span>
                    <Badge tone={b.location === 'supabase' ? 'accent' : 'muted'}>{b.location === 'supabase' ? 'Supabase' : 'Local'}</Badge>
                    {b.auto && <Badge>auto</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-dim">
                    <span>{timeAgo(b.createdAt)} · {formatBytes(b.size)}</span>
                    <span className="truncate" title={b.verifyDetail ?? ''}>{b.verifyDetail}</span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <Button tone="ghost" disabled={busy} onClick={() => void run(async () => { const r = await core.verifyBackup(b.id); if (!r.verified) throw new Error(r.verifyDetail ?? 'Falló'); return `Verificada: ${r.verifyDetail}`; })}><ShieldCheck size={12} aria-hidden /> Verificar</Button>
                    <Button tone="ghost" disabled={busy} onClick={() => { if (window.confirm('¿Restaurar esta copia? Al reiniciar JARVIS sustituirá los datos actuales (que se guardarán aparte).')) restore(b); }}><Download size={12} aria-hidden /> Restaurar</Button>
                    {b.location === 'local' && <Button tone="ghost" disabled={busy} onClick={() => { if (window.confirm('¿Borrar esta copia?')) void run(async () => { await core.deleteBackup(b.id); return 'Copia borrada.'; }); }}><Trash2 size={12} aria-hidden /></Button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-dim">Aún no hay copias. Para restaurar una de otro equipo, copia su archivo .jarvisbak a la carpeta de copias.</p>}
        </div>
      </div>
    </Panel>
  );
}

/** Diagnóstico del sistema, limpieza y actualizaciones. */
export function DiagnosticsPanel() {
  const { data: d, refresh } = useCoreData(() => core.diagnostics(), [], 60_000);
  const { msg, busy, run } = useRun(refresh);
  const [update, setUpdate] = useState<string | null>(null);
  const icon = { ok: <CheckCircle2 size={14} className="text-emerald-300" aria-label="Correcto" />, warn: <AlertTriangle size={14} className="text-amber-300" aria-label="Aviso" />, error: <XCircle size={14} className="text-red-400" aria-label="Error" /> };
  return (
    <Panel title="Diagnóstico y mantenimiento" icon={Stethoscope} className="lg:col-span-2"
      actions={<Button tone="ghost" onClick={() => void refresh()}>Repetir</Button>}>
      {d ? (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {d.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5">{icon[c.status]}</span>
              <div className="min-w-0"><div className="text-ink">{c.label}</div><div className="text-xs text-dim">{c.detail}</div></div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-dim">Comprobando…</p>}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-navy-700 pt-3">
        <Button disabled={busy} onClick={() => void run(async () => { const r = await core.cleanup(true); return `Limpieza hecha: ${r.automationRuns} ejecuciones, ${r.connectorLog} registros de conectores, ${r.approvals} confirmaciones y ${r.alerts} alertas antiguas (más de 90 días). La auditoría nunca se borra.`; })}><Wrench size={14} aria-hidden /> Limpiar y optimizar</Button>
        <Button tone="ghost" disabled={busy} onClick={() => void run(async () => { const u = await core.updates(); setUpdate(u.newer && u.url ? u.url : null); return `Versión actual ${u.current}. ${u.detail}.`; })}>Buscar actualizaciones</Button>
        <Button tone="ghost" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(d, null, 2)).then(() => run(async () => 'Informe copiado (no contiene claves ni datos personales).'))}>Copiar informe</Button>
        {update && <a className="text-sm text-accent underline" href={update} target="_blank" rel="noreferrer">Ver la nueva versión</a>}
      </div>
      <div className="mt-2"><Note msg={msg} /></div>
    </Panel>
  );
}

/** Alertas de seguridad (actividad sospechosa) y bloqueo automático. */
export function AlertsPanel() {
  const { data, refresh } = useCoreData(() => core.alerts(), [], 5000);
  const { run } = useRun(refresh);
  if (!data) return null;
  const tone = (a: SecurityAlert) => (a.level === 'critical' ? 'danger' : a.level === 'warning' ? 'warn' : 'muted');
  return (
    <Panel title="Actividad sospechosa" icon={AlertTriangle} className="lg:col-span-2"
      actions={data.unacknowledged > 0 ? <Button tone="ghost" onClick={() => void run(async () => { await core.ackAlerts(); })}>Marcar todo como revisado</Button> : undefined}>
      <label className="mb-3 flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={data.autoLockdown} onChange={(e) => void run(async () => { await core.setAutoLockdown(e.target.checked); })} />
        Activar el modo emergencia automáticamente ante algo crítico (ráfaga de acciones de un agente o automatización, auditoría manipulada).
      </label>
      {data.alerts.length ? (
        <ul className="space-y-2">
          {data.alerts.slice(0, 15).map((a) => (
            <li key={a.id} className={`rounded-lg border p-2.5 text-sm ${a.acknowledged ? 'border-navy-700 opacity-70' : a.level === 'critical' ? 'border-danger/60 bg-danger/10' : 'border-navy-600 bg-navy-900/60'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(a)}>{a.level === 'critical' ? 'Crítica' : a.level === 'warning' ? 'Aviso' : 'Info'}</Badge>
                <span className="text-ink">{a.title}</span>
                <span className="ml-auto text-[11px] text-dim">{timeAgo(a.ts)}</span>
                {!a.acknowledged && <Button tone="ghost" onClick={() => void run(async () => { await core.ackAlerts(a.id); })}>Revisada</Button>}
              </div>
              <p className="mt-1 text-xs text-muted">{a.detail}</p>
              {a.action && <p className="mt-1 text-xs text-amber-200">→ {a.action}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-dim">Sin actividad sospechosa. JARVIS vigila ráfagas de acciones, denegaciones repetidas, intentos de ampliar permisos, accesos fallidos, dispositivos nuevos y la integridad de la auditoría.</p>}
    </Panel>
  );
}
