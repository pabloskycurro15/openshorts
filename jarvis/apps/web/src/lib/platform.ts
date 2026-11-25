import { desktop } from './desktop';

/** ¿Se ejecuta dentro de la app nativa de iPhone (Capacitor)? */
export function isNative(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

/** ¿Instalada como app (PWA en la pantalla de inicio)? */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Nombre sugerido para este dispositivo al vincularlo. */
export function guessDeviceName(): { name: string; platform: string } {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return { name: 'iPhone', platform: isNative() ? 'ios-app' : 'ios-pwa' };
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return { name: 'iPad', platform: 'ios-pwa' };
  if (/Android/.test(ua)) return { name: 'Android', platform: 'android' };
  if (desktop()) return { name: 'Escritorio', platform: 'desktop' };
  return { name: /Windows/.test(ua) ? 'Navegador (Windows)' : /Mac/.test(ua) ? 'Navegador (Mac)' : 'Navegador', platform: 'web' };
}
