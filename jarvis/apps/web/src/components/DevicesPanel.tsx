import { useEffect, useState } from 'react';
import { BellRing, Globe, Laptop, Smartphone, Wifi } from 'lucide-react';
import { Badge, Button, Panel } from './ui';
import { core, type RemoteStatus } from '../lib/api';
import { useCoreData } from '../lib/connection';
import { timeAgo } from '../lib/labels';
import { currentPushSubscription, disablePush, enablePush, pushAvailability } from '../lib/push';

/** Dispositivos vinculados (iPhone, PWA, otros navegadores), notificaciones push y acceso remoto. */
export function DevicesPanel() {
  const { data: devices, refresh } = useCoreData(() => core.devices(), [], 10_000);
  const { data: me } = useCoreData(() => core.me(), []);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; qr: string | null; link: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setPairing(null);
    }, 1000);
    return () => clearInterval(t);
  }, [pairing]);
  // Cuando aparece un dispositivo nuevo, el código ya se ha usado.
  const count = devices?.length ?? 0;
  const [prevCount, setPrevCount] = useState(count);
  if (count !== prevCount) {
    setPrevCount(count);
    if (pairing && count > prevCount) { setPairing(null); setMsg({ ok: true, text: 'Dispositivo vinculado.' }); }
  }

  const run = async (fn: () => Promise<string | void>) => {
    setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    void refresh();
  };

  return (
    <Panel title="Dispositivos" icon={Smartphone} className="lg:col-span-2">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs text-muted">Usa JARVIS desde el iPhone u otro navegador. Cada dispositivo tiene su propia llave y puedes retirarla cuando quieras.</p>
          {pairing ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-start">
              {pairing.qr && <img src={pairing.qr} alt="Código QR para vincular un dispositivo" className="h-40 w-40 rounded-lg bg-white p-1" />}
              <div className="space-y-2 text-center sm:text-left">
                <div className="text-xs text-muted">Código de vinculación</div>
                <div className="font-mono text-3xl tracking-[0.25em] text-accent glow-text" aria-live="polite">{pairing.code.slice(0, 4)}-{pairing.code.slice(4)}</div>
                <div className="text-xs text-dim">Caduca en {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · un solo uso</div>
                <p className="text-xs text-muted">{pairing.qr ? 'Escanéalo con la cámara del iPhone, o abre JARVIS en el móvil y escribe el código.' : 'Abre JARVIS en el otro dispositivo y escribe el código. Activa el acceso remoto para obtener también un QR.'}</p>
                <Button tone="ghost" onClick={() => void run(async () => { await core.pairCancel(); setPairing(null); })}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button tone="accent" onClick={() => void run(async () => { setPairing(await core.pairStart()); })}><Smartphone size={14} aria-hidden /> Vincular un dispositivo</Button>
          )}
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm"><Laptop size={14} className="text-accent" aria-hidden /><span className="flex-1">Este equipo (acceso local)</span>{me?.kind === 'local' && <Badge tone="ok">Estás aquí</Badge>}</li>
            {devices?.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <Smartphone size={14} className="text-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{d.name} {me?.device?.id === d.id && <Badge tone="ok">Estás aquí</Badge>} {d.push && <Badge tone="muted">Push</Badge>}</div>
                  <div className="text-[11px] text-dim">{d.platform} · vinculado {timeAgo(d.createdAt)}{d.lastSeenAt ? ` · visto ${timeAgo(d.lastSeenAt)}` : ''}{d.lastIp ? ` · ${d.lastIp}` : ''}</div>
                </div>
                <Button tone="ghost" onClick={() => { if (window.confirm(`¿Retirar el acceso de «${d.name}»? Tendrá que vincularse de nuevo.`)) void run(async () => { await core.revokeDevice(d.id); return `Acceso de «${d.name}» retirado.`; }); }}>Retirar</Button>
              </li>
            ))}
          </ul>
          <PushToggle />
          {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
        </div>
        <RemoteAccess />
      </div>
    </Panel>
  );
}

function PushToggle() {
  const avail = pushAvailability();
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void currentPushSubscription().then((s) => setOn(!!s)); }, []);
  const note = { 'needs-install': 'En iPhone, las notificaciones funcionan con JARVIS añadido a la pantalla de inicio (Compartir → «Añadir a pantalla de inicio»).', insecure: 'Las notificaciones necesitan HTTPS (p. ej. con Tailscale).', unsupported: 'Este dispositivo usa las notificaciones del sistema de la app.' } as const;
  return (
    <div className="rounded-lg border border-navy-700 p-3 text-xs">
      <div className="flex items-center gap-2"><BellRing size={14} className="text-accent" aria-hidden /><span className="flex-1 text-sm">Notificaciones en este dispositivo</span>
        {avail === 'ok' && on !== null && (
          <Button tone={on ? 'ghost' : 'accent'} onClick={() => void (async () => {
            setMsg(null);
            try {
              if (on) { await disablePush(); setOn(false); }
              else { await enablePush(); setOn(true); const r = await core.pushTest(); setMsg(r.sent ? 'Te hemos enviado una notificación de prueba.' : 'Suscrito, pero la prueba no llegó a enviarse.'); }
            } catch (err) { setMsg((err as Error).message); }
          })()}>{on ? 'Desactivar' : 'Activar'}</Button>
        )}
      </div>
      <p className="mt-1 text-dim">{avail === 'ok' ? 'Avisos de automatizaciones y confirmaciones pendientes, aunque la app esté cerrada.' : note[avail]}</p>
      {msg && <p role="status" className="mt-1 text-accent-soft">{msg}</p>}
    </div>
  );
}

function RemoteAccess() {
  const { data, refresh, error } = useCoreData(() => core.remote(), []);
  const [publicUrl, setPublicUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="text-xs text-dim">Acceso remoto no disponible en este modo.</p>;
  if (!data) return null;
  const save = (patch: Partial<Pick<RemoteStatus, 'mode' | 'port' | 'publicUrl'>>) => void (async () => {
    setMsg(null);
    try { await core.setRemote(patch); setMsg({ ok: true, text: 'Guardado.' }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    void refresh();
  })();
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2 text-sm"><Wifi size={14} className="text-accent" aria-hidden />Acceso desde la red local (Wi-Fi de casa)</div>
      <label className="flex cursor-pointer items-start gap-2 text-muted">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={data.mode === 'lan'} onChange={(e) => { if (!e.target.checked || window.confirm('El tráfico en la red local irá sin cifrar (HTTP). Úsalo solo en tu Wi-Fi de confianza; para fuera de casa usa Tailscale. ¿Activar?')) save({ mode: e.target.checked ? 'lan' : 'off' }); }} />
        <span>Permitir que el iPhone se conecte por Wi-Fi (puerto {data.port}). Sigue haciendo falta vincular cada dispositivo.</span>
      </label>
      {data.mode === 'lan' && (data.listening
        ? <div className="rounded bg-navy-950/60 p-2 font-mono text-[11px] text-accent-soft">{data.urls.map((u) => <div key={u}>{u}</div>)}</div>
        : <p className="text-red-300">{data.error ?? 'No está escuchando'}</p>)}
      <div className="flex items-center gap-2 pt-2 text-sm"><Globe size={14} className="text-accent" aria-hidden />Fuera de casa, con HTTPS (recomendado)</div>
      <ol className="list-decimal space-y-0.5 pl-4 text-muted">
        <li>Instala <b>Tailscale</b> (gratis) en el PC y en el iPhone con la misma cuenta.</li>
        <li>En el PC: <code className="font-mono text-amber-200">tailscale serve --bg {data.port - 1}</code></li>
        <li>Pega aquí la dirección https que te da (…ts.net). El QR de vinculación la usará.</li>
      </ol>
      <div className="flex gap-2">
        <label htmlFor="publicUrl" className="sr-only">Dirección pública HTTPS</label>
        <input id="publicUrl" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder={data.publicUrl ?? 'https://mi-pc.tailxxxx.ts.net'}
          className="min-w-0 flex-1 rounded-lg border border-navy-600 bg-navy-950/60 px-2 py-1.5 font-mono outline-none focus:border-accent" />
        <Button disabled={!publicUrl.trim()} onClick={() => { save({ publicUrl: publicUrl.trim() }); setPublicUrl(''); }}>Guardar</Button>
        {data.publicUrl && <Button tone="ghost" onClick={() => save({ publicUrl: null })}>Quitar</Button>}
      </div>
      {data.publicUrl && <p className="text-dim">Actual: <span className="font-mono">{data.publicUrl}</span></p>}
      {msg && <p role="status" className={msg.ok ? 'text-emerald-300' : 'text-red-300'}>{msg.text}</p>}
    </div>
  );
}
