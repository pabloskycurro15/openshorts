import { useEffect, useState } from 'react';

/** Enrutado mínimo por hash (#/seccion): sin dependencias y compatible con file:// en Electron. */
export function useHashRoute(fallback: string): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || fallback;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [route, (id: string) => { window.location.hash = `/${id}`; }];
}
