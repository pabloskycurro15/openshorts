import { useState, type FormEvent } from 'react';
import { KeyRound, Link2, Smartphone } from 'lucide-react';
import { useConnection } from '../lib/connection';
import { useSettings, ACCENTS } from '../lib/settings';
import { core } from '../lib/api';
import { guessDeviceName, isNative } from '../lib/platform';
import { AICore } from './AICore';
import { Button, ErrorNote } from './ui';

/** Código que llega en el enlace del QR: #/pair?code=XXXX */
function codeFromLink(): string {
  const m = /[#&?]code=([A-Za-z0-9-]{4,20})/.exec(window.location.hash);
  return m ? m[1]!.toUpperCase() : '';
}

const field = 'flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent';
const inputCls = 'min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm text-ink outline-none placeholder:text-dim';

/** Vinculación con el núcleo: código de un solo uso (móviles y otros navegadores) o token local. */
export function ConnectScreen() {
  const { connect, status } = useConnection();
  const { appearance } = useSettings();
  const native = isNative();
  const [mode, setMode] = useState<'code' | 'token'>('code');
  const [token, setToken] = useState('');
  const [code, setCode] = useState(codeFromLink());
  const [coreUrl, setCoreUrl] = useState(core.baseUrl || '');
  const [name, setName] = useState(guessDeviceName().name);
  const [error, setError] = useState<string | null>(status === 'unauthorized' ? 'El acceso de este dispositivo ya no es válido (revocado o caducado). Vuelve a vincularlo.' : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'token') {
        await connect(token);
      } else {
        if (native) {
          if (!/^https?:\/\/[^\s/]+/.test(coreUrl.trim())) throw new Error('Escribe la dirección del núcleo, p. ej. http://192.168.1.20:7778');
          core.setBase(coreUrl.trim());
        }
        const r = await core.pairComplete(code, name, guessDeviceName().platform);
        if (window.location.hash.includes('pair')) window.location.hash = '/inicio';
        await connect(r.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="panel w-full max-w-md p-6 sm:p-8">
        <div className="mx-auto aspect-square w-40 sm:w-48">
          <AICore state="offline" accent={ACCENTS[appearance.accent].hex} motion={appearance.motion} className="h-full w-full" />
        </div>
        <h1 className="mt-2 text-center font-display text-2xl font-bold tracking-[0.35em] glow-text">JARVIS</h1>
        <p className="mt-2 text-center text-sm text-muted">Vincula este dispositivo con tu núcleo.</p>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-navy-700 p-1 text-xs" role="tablist">
          {([['code', 'Con código', Smartphone], ['token', 'Con token', KeyRound]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 ${mode === k ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink'}`}>
              <Icon size={13} aria-hidden />{label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === 'code' ? (
            <>
              {native && (
                <>
                  <label className="block text-xs tracking-wider text-dim uppercase" htmlFor="coreUrl">Dirección del núcleo</label>
                  <div className={field}>
                    <Link2 size={16} className="text-accent" aria-hidden />
                    <input id="coreUrl" inputMode="url" autoCapitalize="off" autoCorrect="off" required value={coreUrl} onChange={(e) => setCoreUrl(e.target.value)} className={inputCls} placeholder="http://192.168.1.20:7778" />
                  </div>
                </>
              )}
              <label className="block text-xs tracking-wider text-dim uppercase" htmlFor="code">Código de vinculación</label>
              <div className={field}>
                <Smartphone size={16} className="text-accent" aria-hidden />
                <input id="code" autoCapitalize="characters" autoCorrect="off" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className={`${inputCls} tracking-[0.3em]`} placeholder="ABCD-EFGH" maxLength={12} />
              </div>
              <label className="block text-xs tracking-wider text-dim uppercase" htmlFor="devname">Nombre de este dispositivo</label>
              <div className={field}>
                <input id="devname" value={name} onChange={(e) => setName(e.target.value)} className={inputCls.replace('font-mono ', '')} maxLength={60} />
              </div>
            </>
          ) : (
            <>
              <label className="block text-xs tracking-wider text-dim uppercase" htmlFor="token">Token de acceso</label>
              <div className={field}>
                <KeyRound size={16} className="text-accent" aria-hidden />
                <input id="token" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} placeholder="Pega aquí el token" />
              </div>
            </>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" tone="accent" disabled={busy || (mode === 'token' ? !token.trim() : code.replace(/[^A-Z0-9]/g, '').length < 8)}>{busy ? 'Comprobando…' : 'Vincular'}</Button>
        </form>

        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer text-accent-soft">¿De dónde saco el código?</summary>
          <p className="mt-2">En tu PC, abre JARVIS → <b>Seguridad y permisos</b> → <b>Dispositivos</b> → «Vincular un dispositivo». Verás un código de 8 caracteres (válido 10 minutos) y un QR que abre esta pantalla ya rellenada.</p>
          <p className="mt-2">El token local está en <code className="font-mono text-amber-200">auth-token</code>, dentro de la carpeta de datos de JARVIS (en la app de escritorio no hace falta).</p>
        </details>
      </div>
    </div>
  );
}
