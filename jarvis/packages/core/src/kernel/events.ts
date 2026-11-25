import type { EventEnvelope, JarvisEventName, JarvisEvents } from '@jarvis/shared';

type Handler<K extends JarvisEventName> = (payload: JarvisEvents[K], env: EventEnvelope<K>) => void;
type AnyHandler = (env: EventEnvelope) => void;

/**
 * Bus de eventos tipado, en proceso. Es el mecanismo de comunicación desacoplado
 * entre módulos: un módulo emite, otros escuchan, sin conocerse entre sí.
 * Los errores de un suscriptor se aíslan para no romper al emisor.
 */
export class EventBus {
  private handlers = new Map<JarvisEventName, Set<Handler<JarvisEventName>>>();
  private wildcard = new Set<AnyHandler>();

  constructor(private onHandlerError: (err: unknown, event: string) => void = () => {}) {}

  on<K extends JarvisEventName>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<JarvisEventName>);
    return () => set.delete(handler as Handler<JarvisEventName>);
  }

  /** Suscripción a todos los eventos (p. ej. para retransmitir por WebSocket). */
  onAny(handler: AnyHandler): () => void {
    this.wildcard.add(handler);
    return () => this.wildcard.delete(handler);
  }

  emit<K extends JarvisEventName>(type: K, payload: JarvisEvents[K]): void {
    const env: EventEnvelope<K> = { type, ts: new Date().toISOString(), payload };
    for (const h of this.handlers.get(type) ?? []) {
      try {
        (h as Handler<K>)(payload, env);
      } catch (err) {
        this.onHandlerError(err, type);
      }
    }
    for (const h of this.wildcard) {
      try {
        h(env as unknown as EventEnvelope);
      } catch (err) {
        this.onHandlerError(err, type);
      }
    }
  }
}
