import { core } from './api';
import { desktop } from './desktop';
import { isNative, isStandalone } from './platform';

/** Registra el service worker (interfaz sin conexión y push). No en escritorio ni en la app nativa. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || desktop() || isNative()) return;
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

export type PushAvailability = 'ok' | 'needs-install' | 'insecure' | 'unsupported';

export function pushAvailability(): PushAvailability {
  if (desktop() || isNative()) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  if (ios && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushAvailability() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Has denegado las notificaciones. Actívalas en los ajustes del navegador.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await core.pushKey();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await core.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await core.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
