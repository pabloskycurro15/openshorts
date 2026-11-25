import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { SecretVault } from '../security/vault';
import type { Logger } from '../kernel/logger';

export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushSender = (sub: PushSubscriptionInput, payload: string, opts: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency: 'normal' | 'high' }) => Promise<unknown>;

/** Servicios push de los navegadores. Evita que se use el núcleo para hacer peticiones a cualquier sitio. */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/**
 * Notificaciones push web (estándar Web Push con claves VAPID propias, sin coste).
 * Llegan al iPhone (PWA instalada en la pantalla de inicio, iOS 16.4+) y a navegadores
 * aunque la app esté cerrada. Solo título y texto breve: nunca datos sensibles.
 */
export class PushService {
  constructor(
    private db: Database,
    private vault: SecretVault,
    private logger: Logger,
    private sender: PushSender = (s, p, o) => webpush.sendNotification(s, p, o),
    private allowAnyHost = false,
  ) {}

  private keys(): { publicKey: string; privateKey: string } {
    let publicKey = getSetting(this.db, 'push.vapid.public');
    let privateKey = this.vault.get('push.vapid.private');
    if (!publicKey || !privateKey) {
      const k = webpush.generateVAPIDKeys();
      publicKey = k.publicKey;
      privateKey = k.privateKey;
      this.vault.set('push.vapid.private', privateKey);
      setSetting(this.db, 'push.vapid.public', publicKey);
    }
    return { publicKey, privateKey };
  }

  publicKey(): string {
    return this.keys().publicKey;
  }

  subscribe(deviceId: string | null, sub: PushSubscriptionInput) {
    const u = new URL(sub.endpoint);
    if (!this.allowAnyHost && (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname)))) throw new Error(`Servicio push no admitido: ${u.hostname}`);
    this.db.prepare(`INSERT INTO push_subscriptions (id, device_id, endpoint, keys, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET device_id = excluded.device_id, keys = excluded.keys`)
      .run(randomUUID(), deviceId, sub.endpoint, JSON.stringify(sub.keys), new Date().toISOString());
  }

  unsubscribe(endpoint: string): boolean {
    return this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes > 0;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
  }

  /** Envía a todas las suscripciones; borra las que el servicio da por caducadas (404/410). */
  async sendAll(msg: { title: string; body: string; url?: string; tag?: string }): Promise<{ sent: number; removed: number; failed: number }> {
    const subs = this.db.prepare('SELECT endpoint, keys FROM push_subscriptions').all() as { endpoint: string; keys: string }[];
    if (!subs.length) return { sent: 0, removed: 0, failed: 0 };
    const k = this.keys();
    const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 300), url: msg.url ?? '/', tag: msg.tag });
    let sent = 0;
    let removed = 0;
    let failed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await this.sender({ endpoint: s.endpoint, keys: JSON.parse(s.keys) as PushSubscriptionInput['keys'] }, payload,
          { vapidDetails: { subject: getSetting(this.db, 'push.subject') ?? 'mailto:jarvis-push@example.com', ...k }, TTL: 3600, urgency: 'high' });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          this.unsubscribe(s.endpoint);
          removed++;
        } else {
          failed++;
          this.logger.warn({ code, host: new URL(s.endpoint).hostname }, 'Fallo al enviar notificación push');
        }
      }
    }));
    return { sent, removed, failed };
  }
}
