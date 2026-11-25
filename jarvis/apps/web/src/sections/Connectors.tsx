import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, Globe, Mail, KeyRound, MessageCircle, Send, Smartphone, Clapperboard, Cable } from 'lucide-react';
import type { ConnectorInfo } from '@jarvis/shared';
import { Badge, Button, Dot, Empty, ErrorNote, Panel } from '../components/ui';
import { core } from '../lib/api';
import { useCoreData } from '../lib/connection';
import { timeAgo } from '../lib/labels';

const ICON: Record<string, typeof Cable> = { google: Mail, whatsapp: MessageCircle, telegram: Send, github: GitBranch, netlify: Globe, openshorts: Clapperboard };
const RISK: Record<string, { label: string; tone: 'ok' | 'muted' | 'warn' | 'danger' }> = {
  low: { label: 'Lectura', tone: 'ok' }, medium: { label: 'Pide permiso', tone: 'muted' }, high: { label: 'Confirma', tone: 'warn' }, critical: { label: 'Confirma siempre', tone: 'danger' },
};

export function ConnectorsSection() {
  const { data, error, refresh } = useCoreData(() => core.connectors(), [], 3000);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Empty>Cargando…</Empty>;
  const active = data.filter((c) => c.enabled).length;
  return (
    <div className="mx-auto max-w-6xl">
      <p className="mb-4 rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs text-muted">
        Cada conector está apagado hasta que tú lo actives. Sus credenciales se guardan cifradas en este equipo, sus herramientas solo existen mientras está activo,
        y enviar mensajes o publicar siempre pasa por tu confirmación. {active ? `${active} activo(s).` : 'Ninguno activo.'}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((c) => <ConnectorCard key={c.id} c={c} refresh={refresh} />)}
      </div>
    </div>
  );
}

function ConnectorCard({ c, refresh }: { c: ConnectorInfo; refresh: () => Promise<void> | void }) {
  const Icon = ICON[c.id] ?? Cable;
  const [values, setValues] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(c.official);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
    if (!Object.keys(changed).length) return;
    void run(async () => { await core.configureConnector(c.id, changed); setValues({}); return 'Guardado.'; });
  };
  const enable = () => run(async () => {
    const r = await core.enableConnector(c.id);
    if (!r.ok) throw new Error(r.detail);
    return r.detail;
  });

  return (
    <Panel className={c.enabled ? '' : 'opacity-90'}>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${c.enabled ? 'border-accent bg-accent/15 shadow-[0_0_18px_var(--accent)]' : 'border-navy-600 bg-navy-900'}`}>
          <Icon size={18} className="text-accent" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-ink">{c.name}</h3>
            {c.enabled ? <Badge tone="ok">Activo</Badge> : <Badge>Apagado</Badge>}
            {c.official ? <Badge tone="muted">API oficial</Badge> : <Badge tone="danger">No oficial</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted">{c.description}</p>
        </div>
        <a href={c.docsUrl} target="_blank" rel="noreferrer" className="text-dim hover:text-accent" title="Cómo obtener las credenciales"><ExternalLink size={14} aria-label="Ayuda" /></a>
      </div>

      {c.warning && (
        <div className={`mt-3 flex gap-2 rounded-lg border p-2.5 text-xs ${c.official ? 'border-navy-600 bg-navy-900/60 text-muted' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>{c.warning}</span>
        </div>
      )}

      {c.fields.length > 0 && (
        <form onSubmit={save} className="mt-3 space-y-2">
          {c.fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={`${c.id}-${f.key}`} className="mb-1 flex items-center gap-2 text-xs text-muted">
                {f.label}{f.required && <span className="text-accent">*</span>}
                {f.configured && <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 size={11} aria-hidden />{f.secret ? 'guardado y cifrado' : ''}</span>}
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-950/60 px-2.5 focus-within:border-accent">
                {f.secret && <KeyRound size={13} className="text-dim" aria-hidden />}
                <input id={`${c.id}-${f.key}`} type={f.secret ? 'password' : 'text'} autoComplete="off" value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder={f.secret && f.configured ? 'Pega otro para sustituirlo' : (f.value || f.placeholder || '')}
                  className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-sm outline-none placeholder:text-dim" />
              </div>
              {f.help && <p className="mt-0.5 text-[11px] text-dim">{f.help}</p>}
            </div>
          ))}
          <Button type="submit" disabled={busy || !Object.values(values).some((v) => v.trim())}>Guardar</Button>
        </form>
      )}

      {!c.official && !c.enabled && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          Entiendo los riesgos y quiero activarlo con mi cuenta.
        </label>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {c.enabled
          ? <Button onClick={() => run(async () => { await core.disableConnector(c.id); return 'Desactivado.'; })} disabled={busy}>Desactivar</Button>
          : <Button tone="accent" onClick={enable} disabled={busy || !accepted || (c.id === 'google' && !c.status.authorized)}>Activar</Button>}
        {c.enabled && <Button tone="ghost" onClick={() => run(async () => { const r = await core.testConnector(c.id); if (!r.ok) throw new Error(r.detail); return r.detail; })} disabled={busy}>Probar</Button>}
        {c.fields.some((f) => f.secret && f.configured) && (
          <Button tone="ghost" onClick={() => { if (confirm(`¿Borrar las credenciales de ${c.name}? Se desactivará.`)) void run(async () => { await core.deleteConnectorCredentials(c.id); return 'Credenciales borradas.'; }); }} disabled={busy}>Borrar credenciales</Button>
        )}
      </div>
      {msg && <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}

      {c.id === 'google' && <GoogleStatus c={c} run={run} busy={busy} />}
      {c.enabled && c.id === 'whatsapp' && <WhatsAppStatus c={c} run={run} busy={busy} />}
      {c.enabled && c.id === 'telegram' && <TelegramStatus c={c} run={run} busy={busy} />}

      <div className="mt-3 flex flex-wrap gap-1 border-t border-navy-700 pt-2">
        {c.operations.map((o) => (
          <span key={o.name} title={o.description} className="flex items-center gap-1 rounded bg-navy-800 px-1.5 py-0.5 font-mono text-[10px] text-dim">
            {o.name}<span className={`h-1.5 w-1.5 rounded-full ${o.risk === 'low' ? 'bg-emerald-400' : o.risk === 'medium' ? 'bg-sky-400' : o.risk === 'high' ? 'bg-amber-400' : 'bg-red-400'}`} aria-label={RISK[o.risk]?.label} />
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-dim">
        <span>{c.stats.calls} uso(s)</span><span className={c.stats.errors ? 'text-red-300' : ''}>{c.stats.errors} error(es)</span>
        {c.stats.lastUsed && <span>Último: {timeAgo(c.stats.lastUsed)}</span>}
      </div>
      {c.recent.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-dim hover:text-ink">Actividad reciente</summary>
          <ul className="mt-1 space-y-0.5">
            {c.recent.map((r, i) => (
              <li key={i} className="flex gap-2 text-[11px]">
                <Dot tone={r.outcome === 'error' ? 'danger' : r.outcome === 'ok' ? 'ok' : 'muted'} />
                <span className="shrink-0 font-mono text-dim">{timeAgo(r.ts)}</span>
                <span className="shrink-0 text-muted">{r.operation}</span>
                <span className="truncate text-dim" title={r.detail}>{r.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

type RunFn = (fn: () => Promise<string | void>) => Promise<void>;

function WhatsAppStatus({ c, run, busy }: { c: ConnectorInfo; run: RunFn; busy: boolean }) {
  const s = c.status as { state?: string; qr?: string | null; pairingCode?: string | null; lastError?: string | null; me?: { name: string | null; number: string } | null; chats?: number; sendsLastHour?: number; sendLimit?: number };
  const [phone, setPhone] = useState('');
  return (
    <div className="mt-3 rounded-lg border border-navy-600 bg-navy-950/50 p-3 text-xs">
      {s.state === 'open' && s.me ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-300"><Dot tone="ok" pulse />Vinculado como {s.me.name ?? 'tu cuenta'} (···{s.me.number.slice(-3)})</div>
          <p className="text-muted">Escribe a JARVIS en tu chat «Mensaje a ti mismo» de WhatsApp. Responderá con el prefijo 🤖.</p>
          <p className="text-dim">{s.chats ?? 0} chat(s) vistos desde la conexión · {s.sendsLastHour ?? 0}/{s.sendLimit ?? 15} envíos esta hora</p>
          <Button tone="ghost" disabled={busy} onClick={() => { if (confirm('¿Desvincular WhatsApp de JARVIS? Se borrará la sesión.')) void run(async () => { await core.connectorAction(c.id, 'logout'); return 'Desvinculado.'; }); }}>Desvincular</Button>
        </div>
      ) : s.state === 'qr' ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {s.qr ? <img src={s.qr} alt="Código QR para vincular WhatsApp" className="h-44 w-44 rounded-lg bg-white p-1" /> : <div className="h-44 w-44 animate-pulse rounded-lg bg-navy-800" />}
          <div className="space-y-2">
            <p className="text-ink">En tu teléfono: WhatsApp → Ajustes → <b>Dispositivos vinculados</b> → Vincular un dispositivo, y escanea el código.</p>
            <p className="text-dim">¿No puedes escanear? Vincula con tu número:</p>
            <div className="flex gap-2">
              <label htmlFor="wa-phone" className="sr-only">Tu número de teléfono</label>
              <input id="wa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="600 111 222" inputMode="tel"
                className="w-36 rounded-lg border border-navy-600 bg-navy-950/60 px-2 py-1 font-mono outline-none focus:border-accent" />
              <Button disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={() => run(async () => { await core.connectorAction(c.id, 'pair', { phone }); return 'Código generado: introdúcelo en el teléfono.'; })}>Pedir código</Button>
            </div>
            {s.pairingCode && <p className="font-mono text-lg tracking-[0.3em] text-accent"><Smartphone size={14} className="mr-1 inline" aria-hidden />{s.pairingCode.replace(/(.{4})/, '$1-')}</p>}
            {s.pairingCode && <p className="text-dim">Teléfono → Dispositivos vinculados → Vincular → «Vincular con número de teléfono».</p>}
          </div>
        </div>
      ) : s.state === 'logged_out' || s.state === 'off' ? (
        <div className="space-y-2">
          <p className="text-muted">{s.state === 'logged_out' ? 'La sesión se cerró (desde el teléfono o al desvincular).' : 'Desconectado.'}</p>
          <Button tone="accent" disabled={busy} onClick={() => run(async () => { await core.connectorAction(c.id, 'restart'); return 'Generando un QR nuevo…'; })}>Vincular de nuevo</Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-muted"><Dot tone="warn" pulse />Conectando con WhatsApp…{s.lastError ? ` (${s.lastError})` : ''}</p>
      )}
    </div>
  );
}

function TelegramStatus({ c, run, busy }: { c: ConnectorInfo; run: RunFn; busy: boolean }) {
  const s = c.status as { bot?: string | null; listening?: boolean; pendingChats?: { chatId: string; name: string; text: string; ts: string }[]; lastError?: string | null };
  const owner = c.fields.find((f) => f.key === 'ownerChatId')?.value;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-navy-600 bg-navy-950/50 p-3 text-xs">
      <div className="flex items-center gap-2"><Dot tone={s.listening && !s.lastError ? 'ok' : 'warn'} pulse={s.listening} />
        {s.bot ? <span>Bot <span className="font-mono">@{s.bot}</span> escuchando</span> : 'Conectando…'}{s.lastError && <span className="text-red-300"> · {s.lastError}</span>}</div>
      {owner ? <p className="text-muted">Chat autorizado: <span className="font-mono">{owner}</span>. Solo ese chat puede darle órdenes.</p>
        : <p className="text-amber-200">Escribe cualquier cosa a tu bot en Telegram y autoriza tu chat aquí.</p>}
      {(s.pendingChats ?? []).map((p) => (
        <div key={p.chatId} className="flex items-center justify-between gap-2 rounded border border-navy-700 p-2">
          <span className="min-w-0 truncate">{p.name} <span className="font-mono text-dim">({p.chatId})</span>: «{p.text}»</span>
          <Button tone="accent" disabled={busy} onClick={() => run(async () => { await core.connectorAction(c.id, 'authorize', { chatId: p.chatId }); return 'Chat autorizado.'; })}>Autorizar</Button>
        </div>
      ))}
    </div>
  );
}

function GoogleStatus({ c, run, busy }: { c: ConnectorInfo; run: RunFn; busy: boolean }) {
  const s = c.status as { authorized?: boolean; account?: string | null; redirectUri?: string; sendsLastHour?: number; sendLimit?: number };
  const ready = c.fields.every((f) => !f.required || f.configured);
  const connect = () => run(async () => {
    const r = await core.connectorAction(c.id, 'authorize');
    window.open(String(r.url), '_blank', 'noopener');
    return 'Se ha abierto Google en el navegador. Autoriza y vuelve aquí.';
  });
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-navy-600 bg-navy-950/50 p-3 text-xs">
      {s.authorized ? (
        <>
          <div className="flex items-center gap-2 text-emerald-300"><Dot tone="ok" pulse={c.enabled} />Autorizado{s.account ? ` como ${s.account}` : ''}{!c.enabled && ' · pulsa «Activar»'}</div>
          {c.enabled && <p className="text-dim">{s.sendsLastHour ?? 0}/{s.sendLimit ?? 20} correos enviados esta hora · JARVIS prepara borradores salvo que le pidas enviar.</p>}
          <Button tone="ghost" disabled={busy} onClick={() => { if (confirm('¿Quitar el acceso de JARVIS a tu cuenta de Google?')) void run(async () => { await core.connectorAction(c.id, 'disconnect'); return 'Acceso retirado.'; }); }}>Desconectar Google</Button>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-0.5 pl-4 text-muted">
            <li>En Google Cloud crea un proyecto y activa las API de Gmail, Calendar y Drive.</li>
            <li>Pantalla de consentimiento: tipo «Externo», modo prueba, y añádete como usuario de prueba.</li>
            <li>Credenciales → ID de cliente OAuth → <b>App de escritorio</b>. Copia aquí el ID y el secreto.</li>
          </ol>
          <Button tone="accent" disabled={busy || !ready} onClick={connect}>Conectar con Google</Button>
          {s.redirectUri && <p className="text-dim">Google te devolverá a <span className="font-mono">{s.redirectUri}</span> (este equipo).</p>}
        </>
      )}
    </div>
  );
}
