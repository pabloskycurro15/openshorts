import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssistantState, EventEnvelope } from '@jarvis/shared';
import { ApiError, core } from './api';

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'unauthorized' | 'no-token';

export interface FeedItem {
  id: number;
  type: string;
  ts: string;
  payload: unknown;
}

interface ConnectionState {
  status: LinkStatus;
  assistant: AssistantState;
  lockdown: boolean;
  internet: boolean;
  feed: FeedItem[];
  /** Incrementa con cada evento relevante: los paneles lo usan para refrescar datos. */
  revision: number;
  connect: (token: string) => Promise<void>;
  disconnect: () => void;
  setLockdownLocal: (v: boolean) => void;
}

const Ctx = createContext<ConnectionState | null>(null);
const FEED_MAX = 200;

/**
 * Mantiene la conexión en tiempo real con el núcleo (WebSocket) con reconexión
 * exponencial, y expone el estado global: enlace, estado del asistente, emergencia,
 * conectividad a Internet y flujo de eventos.
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LinkStatus>(core.hasToken ? 'connecting' : 'no-token');
  const [assistant, setAssistant] = useState<AssistantState>('offline');
  const [lockdown, setLockdown] = useState(false);
  const [internet, setInternet] = useState(() => navigator.onLine);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const on = () => setInternet(true);
    const off = () => setInternet(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!core.hasToken) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let failures = 0;

    const open = async () => {
      // Comprobar credenciales por HTTP primero: el WebSocket no informa del 401.
      try {
        const h = await core.health();
        if (cancelled) return;
        setLockdown(h.lockdown);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setStatus('unauthorized');
          setAssistant('offline');
          return;
        }
        schedule();
        return;
      }
      ws = new WebSocket(core.eventsUrl());
      ws.onopen = () => {
        failures = 0;
        setStatus('online');
        setAssistant((s) => (s === 'offline' ? 'idle' : s));
      };
      ws.onmessage = (msg) => {
        let env: EventEnvelope;
        try {
          env = JSON.parse(String(msg.data)) as EventEnvelope;
        } catch {
          return;
        }
        if (env.type === 'assistant.state') setAssistant((env.payload as { state: AssistantState }).state);
        if (env.type === 'emergency.changed') setLockdown((env.payload as { lockdown: boolean }).lockdown);
        if ((env.type as string) !== 'hello') {
          setFeed((f) => [{ id: ++seq.current, type: env.type, ts: env.ts, payload: env.payload }, ...f].slice(0, FEED_MAX));
          setRevision((r) => r + 1);
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus('offline');
        setAssistant('offline');
        schedule();
      };
    };
    const schedule = () => {
      setStatus('offline');
      setAssistant('offline');
      failures++;
      retry = setTimeout(open, Math.min(1000 * 2 ** Math.min(failures, 5), 30_000));
    };

    setStatus('connecting');
    void open();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [attempt]);

  const connect = useCallback(async (token: string) => {
    core.setToken(token.trim());
    try {
      await core.health();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        core.setToken(null);
        setStatus('no-token');
        throw new Error('Token incorrecto', { cause: err });
      }
      // Núcleo apagado: guardamos el token y seguimos reintentando.
    }
    setAttempt((a) => a + 1);
  }, []);

  const disconnect = useCallback(() => {
    core.setToken(null);
    setStatus('no-token');
    setAssistant('offline');
    setAttempt((a) => a + 1);
  }, []);

  const value = useMemo(
    () => ({ status, assistant, lockdown, internet, feed, revision, connect, disconnect, setLockdownLocal: setLockdown }),
    [status, assistant, lockdown, internet, feed, revision, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): ConnectionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConnection fuera de ConnectionProvider');
  return v;
}

/** Carga datos del núcleo y los refresca con cada evento o cada `intervalMs`. */
export function useCoreData<T>(load: () => Promise<T>, deps: unknown[] = [], intervalMs?: number) {
  const { status, revision } = useConnection();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (status !== 'online') return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, revision, refresh, ...deps]);

  useEffect(() => {
    if (status !== 'online' || !intervalMs) return;
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [status, intervalMs, refresh]);

  return { data, error, refresh };
}
