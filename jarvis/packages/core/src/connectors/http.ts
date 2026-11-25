/** Petición JSON a una API externa con errores legibles (sin filtrar credenciales). */
export async function jsonFetch<T = unknown>(f: typeof fetch, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  const signal = init.signal ? AbortSignal.any([init.signal, ctrl.signal]) : ctrl.signal;
  let res: Response;
  try {
    res = await f(url, { ...init, signal });
  } catch (err) {
    throw new Error(ctrl.signal.aborted ? 'El servicio no respondió a tiempo' : `No se pudo conectar: ${(err as Error).message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* texto plano */ }
  if (!res.ok) {
    const msg = typeof body === 'object' && body !== null
      ? ((body as { message?: string; description?: string; detail?: unknown; error?: unknown }).message ?? (body as { description?: string }).description ?? JSON.stringify((body as { detail?: unknown; error?: unknown }).detail ?? (body as { error?: unknown }).error ?? body))
      : String(body).slice(0, 200);
    const hint = res.status === 401 || res.status === 403 ? ' (credencial no válida o sin permisos)' : res.status === 429 ? ' (límite de uso del servicio)' : '';
    throw new Error(`HTTP ${res.status}${hint}: ${String(msg).slice(0, 300)}`);
  }
  return body as T;
}
