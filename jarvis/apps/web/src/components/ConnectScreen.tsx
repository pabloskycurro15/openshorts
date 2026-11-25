import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { useConnection } from '../lib/connection';
import { useSettings, ACCENTS } from '../lib/settings';
import { AICore } from './AICore';
import { Button, ErrorNote } from './ui';

/** Vinculación con el núcleo local mediante su token. */
export function ConnectScreen() {
  const { connect, status } = useConnection();
  const { appearance } = useSettings();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(status === 'unauthorized' ? 'El token guardado ya no es válido.' : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="panel w-full max-w-md p-6 sm:p-8">
        <div className="mx-auto aspect-square w-48">
          <AICore state="offline" accent={ACCENTS[appearance.accent].hex} motion={appearance.motion} className="h-full w-full" />
        </div>
        <h1 className="mt-2 text-center font-display text-2xl font-bold tracking-[0.35em] glow-text">JARVIS</h1>
        <p className="mt-2 text-center text-sm text-muted">Vincula esta interfaz con tu núcleo local.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-xs tracking-wider text-dim uppercase" htmlFor="token">Token de acceso</label>
          <div className="flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-900 px-3 focus-within:border-accent">
            <KeyRound size={16} className="text-accent" aria-hidden />
            <input id="token" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)}
              className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm text-ink outline-none placeholder:text-dim" placeholder="Pega aquí el token" />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" tone="accent" disabled={busy || !token.trim()}>{busy ? 'Comprobando…' : 'Vincular'}</Button>
        </form>
        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer text-accent-soft">¿Dónde está el token?</summary>
          <p className="mt-2">El núcleo lo crea al arrancar por primera vez en <code className="font-mono text-amber-200">jarvis/.data/auth-token</code>. Ábrelo y copia su contenido.</p>
          <p className="mt-2">En la aplicación de escritorio (Fase 5) este paso será automático.</p>
        </details>
      </div>
    </div>
  );
}
