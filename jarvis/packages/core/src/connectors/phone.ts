import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SecurityAlert } from '@jarvis/shared';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';
import { normalizePhone } from './whatsapp';

const API = 'https://api.twilio.com/2010-04-01';
export const CALLS_PER_DAY = 6;
const VOICE = 'voice="Polly.Sergio-Neural" language="es-ES"';
const BYE = /\b(adi[oó]s|hasta luego|nada m[aá]s|eso es todo|cuelga|chao|ch[aá]o|gracias,? (eso es todo|nada m[aá]s))\b/i;
const MAX_CALL_MS = 20 * 60_000;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const say = (t: string) => `<Say ${VOICE}>${esc(t)}</Say>`;
const twiml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

/** Texto apto para ser hablado: sin Markdown, enlaces ni listas; longitud acotada. */
export function speakable(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'el enlace')
    .replace(/[*_#`>|]/g, '').replace(/^\s*[-•\d]+[.)]?\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

/** Mensaje de un solo sentido (sin conversación): la voz lo dice y se cuelga. */
export function buildTwiml(message: string, repeat: number): string {
  const parts = [say(message)];
  for (let i = 1; i < repeat; i++) parts.push('<Pause length="2"/>', say('Repito.'), say(message));
  return `<Response><Pause length="1"/>${parts.join('')}</Response>`;
}

/** Firma de Twilio (X-Twilio-Signature): HMAC-SHA1 de la URL + parámetros ordenados. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

interface Session { auth: boolean; pinTries: number; empty: number; started: number; pending: Promise<string> | null; result: string | null; needsApproval: boolean; greeting: string | null }

/**
 * Teléfono con Twilio. Dos modos:
 *  - Mensaje (sin dirección pública): JARVIS te llama y te dice algo.
 *  - Conversación (con dirección pública HTTPS, p. ej. Tailscale Funnel): hablas con JARVIS por
 *    teléfono; Twilio convierte tu voz en texto, JARVIS responde y Twilio lo dice. También puedes
 *    llamar tú a su número. Solo atiende a TU número (y, si lo pones, con PIN). Cada petición de
 *    Twilio se verifica con su firma.
 */
export class PhoneBridge {
  private today = { day: '', n: 0 };
  private lastCritical = 0;
  private sessions = new Map<string, Session>();
  private messages = new Map<string, { text: string; exp: number }>();
  private ctx: ConnectorCtx | null = null;

  private auth(ctx: ConnectorCtx) {
    return `Basic ${Buffer.from(`${ctx.get('accountSid')}:${ctx.get('authToken')}`).toString('base64')}`;
  }
  private owner(ctx: ConnectorCtx) { return `+${normalizePhone(ctx.get('to') ?? '')}`; }
  private publicUrl(ctx: ConnectorCtx) { return (ctx.get('publicUrl') ?? '').replace(/\/+$/, ''); }

  async call(ctx: ConnectorCtx, message: string, repeat = 1, conversation = true): Promise<{ sid: string; status: string; to: string; mode: string }> {
    const d = new Date().toISOString().slice(0, 10);
    if (this.today.day !== d) this.today = { day: d, n: 0 };
    if (this.today.n >= CALLS_PER_DAY) throw new Error(`Límite de ${CALLS_PER_DAY} llamadas al día alcanzado`);
    const to = this.owner(ctx);
    const from = ctx.get('from') ?? '';
    if (!/^\+\d{8,15}$/.test(from)) throw new Error('Falta el número de Twilio desde el que llamar (formato +1… o +34…)');
    const base = this.publicUrl(ctx);
    const params: Record<string, string> = { To: to, From: from, Timeout: '30' };
    let mode = 'mensaje';
    if (conversation && base) {
      const id = randomBytes(12).toString('hex');
      this.messages.set(id, { text: message.slice(0, 1500), exp: Date.now() + 15 * 60_000 });
      params.Url = `${base}/phone/voice?m=${id}`;
      params.Method = 'POST';
      mode = 'conversación';
    } else {
      params.Twiml = buildTwiml(message.slice(0, 1500), repeat);
    }
    const r = await jsonFetch<{ sid: string; status: string }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/Calls.json`, {
      method: 'POST', headers: { authorization: this.auth(ctx), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
    });
    this.today.n++;
    return { sid: r.sid, status: r.status, to: `${to.slice(0, 4)}•••${to.slice(-3)}`, mode };
  }

  // ───────────── webhooks de Twilio ─────────────

  /** Atiende una petición de Twilio. Devuelve el código HTTP y el TwiML. */
  async webhook(path: string, query: Record<string, string>, params: Record<string, string>, signature: string | undefined): Promise<{ status: number; body: string }> {
    const ctx = this.ctx;
    if (!ctx || !ctx.get('authToken')) return { status: 404, body: twiml(say('JARVIS no tiene el teléfono configurado.') + '<Hangup/>') };
    const base = this.publicUrl(ctx);
    const qs = new URLSearchParams(query).toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const expected = twilioSignature(ctx.get('authToken')!, url, params);
    const ok = !!signature && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok || params.AccountSid !== ctx.get('accountSid')) {
      ctx.log('llamada', 'error', 'Petición rechazada: firma de Twilio no válida');
      return { status: 403, body: twiml('<Reject/>') };
    }
    const callSid = params.CallSid ?? '';
    const now = Date.now();
    for (const [k, s] of this.sessions) if (now - s.started > MAX_CALL_MS) this.sessions.delete(k);
    for (const [k, m] of this.messages) if (m.exp < now) this.messages.delete(k);

    if (ctx.lockdown()) return { status: 200, body: twiml(say('JARVIS está en modo emergencia. No atiendo órdenes por teléfono.') + '<Hangup/>') };

    if (path === '/phone/voice') {
      const inbound = (params.Direction ?? '').startsWith('inbound');
      const caller = inbound ? params.From : params.To;
      if (caller !== this.owner(ctx)) {
        ctx.log('llamada', 'info', `Llamada de un número no autorizado rechazada (${(caller ?? '').slice(0, 4)}•••)`);
        return { status: 200, body: twiml('<Reject reason="rejected"/>') };
      }
      const msg = query.m ? this.messages.get(query.m) : undefined;
      if (query.m) this.messages.delete(query.m);
      const pin = ctx.get('pin');
      // Las llamadas que hace JARVIS no necesitan PIN; las que recibe, si hay PIN, sí (el número se puede falsificar).
      const s: Session = { auth: !inbound || !pin, pinTries: 0, empty: 0, started: now, pending: null, result: null, needsApproval: false, greeting: msg?.text ?? null };
      this.sessions.set(callSid, s);
      ctx.log('llamada', 'info', inbound ? 'Llamada entrante de tu número' : 'Llamada saliente atendida');
      if (!s.auth) return { status: 200, body: twiml(`<Gather input="dtmf" numDigits="${pin!.length}" timeout="10" action="${base}/phone/pin" method="POST">${say('Hola. Marca tu PIN.')}</Gather>${say('No he recibido el PIN. Adiós.')}<Hangup/>`) };
      return { status: 200, body: twiml(this.listen(base, s.greeting ?? 'Hola, soy JARVIS. ¿En qué te ayudo?')) };
    }

    const s = this.sessions.get(callSid);
    if (!s) return { status: 200, body: twiml(say('La llamada ha caducado. Adiós.') + '<Hangup/>') };

    if (path === '/phone/pin') {
      if (params.Digits && params.Digits === ctx.get('pin')) {
        s.auth = true;
        return { status: 200, body: twiml(this.listen(base, 'Correcto. Soy JARVIS, ¿en qué te ayudo?')) };
      }
      if (++s.pinTries >= 3) { this.sessions.delete(callSid); ctx.log('llamada', 'error', 'PIN incorrecto tres veces'); return { status: 200, body: twiml(say('PIN incorrecto. Adiós.') + '<Hangup/>') }; }
      return { status: 200, body: twiml(`<Gather input="dtmf" numDigits="${ctx.get('pin')!.length}" timeout="10" action="${base}/phone/pin" method="POST">${say('PIN incorrecto. Prueba otra vez.')}</Gather><Hangup/>`) };
    }
    if (!s.auth) return { status: 200, body: twiml('<Hangup/>') };

    if (path === '/phone/gather') {
      const heard = (params.SpeechResult ?? '').trim();
      if (!heard) {
        if (++s.empty >= 2) { this.sessions.delete(callSid); return { status: 200, body: twiml(say('No te oigo. Te dejo, hasta luego.') + '<Hangup/>') }; }
        return { status: 200, body: twiml(this.listen(base, '¿Sigues ahí?')) };
      }
      s.empty = 0;
      if (BYE.test(heard) && heard.split(/\s+/).length <= 6) { this.sessions.delete(callSid); return { status: 200, body: twiml(say('Hasta luego. Aquí estaré.') + '<Hangup/>') }; }
      if (s.pending) return { status: 200, body: twiml(say('Sigo con lo anterior, dame un momento.') + `<Redirect method="POST">${base}/phone/wait</Redirect>`) };
      ctx.log('llamada', 'info', `Oído: ${heard.slice(0, 100)}`);
      s.result = null;
      s.needsApproval = false;
      s.pending = ctx.converse(`(Llamada de voz: responde en una a tres frases habladas, naturales, sin listas, símbolos ni enlaces.) ${heard}`, 'phone', (e) => { if (e.type === 'approval_required') s.needsApproval = true; })
        .then((r) => { s.result = r; return r; })
        .catch((err: Error) => { s.result = `Ha habido un problema: ${err.message}`; return s.result; })
        .finally(() => { s.pending = null; });
      return this.waitReply(base, s, 6000);
    }

    if (path === '/phone/wait') return this.waitReply(base, s, 9000);
    return { status: 404, body: twiml('<Hangup/>') };
  }

  /** Espera la respuesta un tiempo prudente (Twilio corta a los 15 s); si no llega, vuelve a esperar. */
  private async waitReply(base: string, s: Session, ms: number) {
    if (s.pending && !s.result) {
      await Promise.race([s.pending.catch(() => undefined), new Promise((r) => { const t = setTimeout(r, ms); t.unref(); })]);
    }
    if (s.result !== null) {
      const r = s.result;
      s.result = null;
      return { status: 200, body: twiml(this.listen(base, speakable(r.replace(/\(Hubo \d+ acción\(es\)[^)]*\)/, 'Para una parte necesito tu confirmación en la app de JARVIS.')) || 'Hecho.')) };
    }
    if (s.needsApproval) {
      s.needsApproval = false;
      return { status: 200, body: twiml(this.listen(base, 'Para eso necesito tu confirmación en la app de JARVIS o en el móvil. Cuando la des, lo haré. ¿Algo más?')) };
    }
    return { status: 200, body: twiml(`${say('Un momento.')}<Pause length="1"/><Redirect method="POST">${base}/phone/wait</Redirect>`) };
  }

  /** Dice algo y escucha la respuesta (se le puede interrumpir hablando). */
  private listen(base: string, text: string): string {
    return `<Gather input="speech" language="es-ES" speechTimeout="auto" speechModel="phone_call" enhanced="true" actionOnEmptyResult="true" action="${base}/phone/gather" method="POST">${say(text)}</Gather>`;
  }

  // ───────────── definición del conector ─────────────

  def(): ConnectorDef {
    return {
      id: 'phone',
      name: 'Llamadas de teléfono',
      description: 'Habla con JARVIS por teléfono: te llama (buenos días, avisos si algo va mal) y conversáis, o le llamas tú a su número. Solo atiende a tu móvil.',
      official: true,
      warning: 'Usa Twilio (telefonía). Cuenta de prueba gratis (~15 $ de saldo); las llamadas de prueba empiezan con un aviso en inglés. Después: número ~1-3 $/mes + ~0,02-0,10 $/min y ~0,02 $ por cada 15 s de reconocimiento de voz. Para CONVERSAR hace falta una dirección pública HTTPS hacia JARVIS (gratis con Tailscale Funnel). JARVIS tiene que estar encendido en tu PC.',
      docsUrl: 'https://console.twilio.com/',
      fields: [
        { key: 'accountSid', label: 'Account SID', secret: false, required: true, placeholder: 'AC…', help: 'console.twilio.com → Account Info.' },
        { key: 'authToken', label: 'Auth Token', secret: true, required: true, placeholder: '32 caracteres' },
        { key: 'from', label: 'Número de Twilio (el de JARVIS)', secret: false, required: true, placeholder: '+1…', help: 'Phone Numbers → el número que te da Twilio. Llamándolo hablarás con JARVIS.' },
        { key: 'to', label: 'Tu móvil (el único al que llamará y atenderá)', secret: false, required: true, placeholder: '600 111 222', help: 'En la cuenta de prueba tiene que estar verificado en Twilio (Verified Caller IDs).' },
        { key: 'publicUrl', label: 'Dirección pública HTTPS (para conversar)', secret: false, required: false, placeholder: 'https://mi-pc.tailxxxx.ts.net:8443', help: 'En el PC (Tailscale gratis): tailscale funnel --bg --https=8443 --set-path /phone http://127.0.0.1:7777/phone  → pega aquí https://TU-PC.ts.net:8443. Solo queda pública la parte del teléfono (protegida por la firma de Twilio).' },
        { key: 'pin', label: 'PIN para cuando le llames tú (recomendado)', secret: true, required: false, placeholder: '4-8 cifras', help: 'El número de quien llama se puede falsificar: con PIN, nadie más podrá darle órdenes.' },
        { key: 'alerts', label: 'Llamarme ante alertas críticas de seguridad (sí/no)', secret: false, required: false, default: 'sí' },
      ],
      test: async (ctx) => {
        this.ctx = ctx;
        if (!/^AC[0-9a-f]{32}$/i.test(ctx.get('accountSid') ?? '')) return { ok: false, detail: 'El Account SID empieza por «AC» y tiene 34 caracteres' };
        normalizePhone(ctx.get('to') ?? '');
        const pin = ctx.get('pin');
        if (pin && !/^\d{4,8}$/.test(pin)) return { ok: false, detail: 'El PIN debe tener entre 4 y 8 cifras' };
        const pub = this.publicUrl(ctx);
        if (pub && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(pub)) return { ok: false, detail: 'La dirección pública debe ser https://nombre (sin ruta)' };
        const a = await jsonFetch<{ status: string; type: string }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}.json`, { headers: { authorization: this.auth(ctx) } });
        if (a.status !== 'active') return { ok: false, detail: `La cuenta de Twilio está «${a.status}»` };
        return { ok: true, detail: `Twilio conectado (${a.type === 'Trial' ? 'cuenta de prueba' : 'cuenta completa'}) · ${pub ? 'modo conversación' : 'solo mensajes: añade la dirección pública para conversar'}` };
      },
      start: async (ctx) => { this.ctx = ctx; },
      stop: async () => { this.sessions.clear(); },
      status: (ctx) => { this.ctx = ctx; return { callsToday: this.today.day === new Date().toISOString().slice(0, 10) ? this.today.n : 0, limit: CALLS_PER_DAY, conversation: !!this.publicUrl(ctx), activeCalls: this.sessions.size }; },
      actions: {
        test_call: async (ctx) => { this.ctx = ctx; return this.call(ctx, 'Hola, soy JARVIS. Esta es una llamada de prueba. Si quieres, pregúntame algo.', 1); },
        /** Apunta el número de Twilio a JARVIS para que puedas llamarle tú. */
        setup_inbound: async (ctx) => {
          this.ctx = ctx;
          const base = this.publicUrl(ctx);
          if (!base) throw new Error('Primero pon la dirección pública HTTPS');
          const list = await jsonFetch<{ incoming_phone_numbers: { sid: string; phone_number: string }[] }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(ctx.get('from') ?? '')}`, { headers: { authorization: this.auth(ctx) } });
          const n = list.incoming_phone_numbers[0];
          if (!n) throw new Error('No encuentro ese número en tu cuenta de Twilio');
          await jsonFetch(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/IncomingPhoneNumbers/${n.sid}.json`, {
            method: 'POST', headers: { authorization: this.auth(ctx), 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ VoiceUrl: `${base}/phone/voice`, VoiceMethod: 'POST' }).toString(),
          });
          return { ok: true, number: n.phone_number };
        },
      },
      onSecurityAlert: async (ctx, alert: SecurityAlert) => {
        if (alert.level !== 'critical' || !/^s[ií]/i.test(ctx.get('alerts') ?? 'sí')) return;
        if (Date.now() - this.lastCritical < 30 * 60_000) return; // como mucho una llamada de alerta cada 30 min
        this.lastCritical = Date.now();
        try {
          await this.call(ctx, `Atención. Soy JARVIS. Alerta de seguridad crítica: ${alert.title}. ${alert.action ? `${alert.action}.` : ''} Revisa la sección de Seguridad en cuanto puedas.`, 2, false);
          ctx.log('alerta', 'ok', `Llamada por alerta crítica: ${alert.title}`);
        } catch (err) {
          ctx.log('alerta', 'error', (err as Error).message);
        }
      },
      tools: (ctx) => [
        defineTool({
          name: 'phone.call',
          description: 'Llama al móvil del usuario (solo a él) y le dice un mensaje con voz; si está configurada la conversación, después puede hablar contigo. Mensaje breve y natural, para escuchar (sin listas ni símbolos).',
          parameters: z.object({ message: z.string().min(5).max(1500), repeat: z.number().int().min(1).max(3).default(1) }),
          permissions: ['connector.phone.call'], risk: 'medium', sideEffects: true,
          risks: [`Hace una llamada real a tu móvil (coste en Twilio; máximo ${CALLS_PER_DAY} al día)`],
          returns: 'Identificador, estado y modo de la llamada.',
          execute: ({ message, repeat }) => { this.ctx = ctx; return this.call(ctx, message, repeat); },
        }),
        defineTool({
          name: 'phone.calls', description: 'Últimas llamadas hechas por JARVIS (estado y duración).',
          parameters: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
          permissions: ['connector.phone.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Fecha, estado, duración y coste.',
          async execute({ limit }) {
            const r = await jsonFetch<{ calls: { status: string; start_time: string | null; duration: string | null; price: string | null; price_unit: string }[] }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/Calls.json?PageSize=${limit}`, { headers: { authorization: `Basic ${Buffer.from(`${ctx.get('accountSid')}:${ctx.get('authToken')}`).toString('base64')}` } });
            return r.calls.map((c) => ({ status: c.status, start: c.start_time, seconds: c.duration ? Number(c.duration) : null, cost: c.price ? `${Math.abs(Number(c.price)).toFixed(3)} ${c.price_unit}` : null }));
          },
        }),
      ],
    };
  }
}

/** Compatibilidad: conector de teléfono con su propio puente. */
export function phoneConnector(): ConnectorDef {
  return new PhoneBridge().def();
}
