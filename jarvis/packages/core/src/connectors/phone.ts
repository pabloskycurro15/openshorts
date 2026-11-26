import { z } from 'zod';
import type { SecurityAlert } from '@jarvis/shared';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';
import { normalizePhone } from './whatsapp';

const API = 'https://api.twilio.com/2010-04-01';
export const CALLS_PER_DAY = 6;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Instrucciones de la llamada (TwiML): voz masculina española, el mensaje se repite. */
export function buildTwiml(message: string, repeat: number): string {
  const say = `<Say language="es-ES" voice="Polly.Sergio-Neural">${esc(message)}</Say>`;
  const parts = [say];
  for (let i = 1; i < repeat; i++) parts.push('<Pause length="2"/>', `<Say language="es-ES" voice="Polly.Sergio-Neural">Repito.</Say>`, say);
  return `<Response><Pause length="1"/>${parts.join('')}</Response>`;
}

/**
 * Llamadas de voz a TU teléfono con Twilio (servicio de telefonía). JARVIS solo puede llamar al
 * número del propietario configurado aquí (nunca a terceros), con un máximo diario. Útil para
 * los buenos días y para avisos graves. Llamada de un sentido: JARVIS habla, tú escuchas.
 */
export function phoneConnector(): ConnectorDef {
  const today: { day: string; n: number } = { day: '', n: 0 };
  let lastCritical = 0;

  const auth = (ctx: ConnectorCtx) => `Basic ${Buffer.from(`${ctx.get('accountSid')}:${ctx.get('authToken')}`).toString('base64')}`;

  async function call(ctx: ConnectorCtx, message: string, repeat = 2): Promise<{ sid: string; status: string; to: string }> {
    const d = new Date().toISOString().slice(0, 10);
    if (today.day !== d) { today.day = d; today.n = 0; }
    if (today.n >= CALLS_PER_DAY) throw new Error(`Límite de ${CALLS_PER_DAY} llamadas al día alcanzado`);
    const to = `+${normalizePhone(ctx.get('to') ?? '')}`;
    const from = ctx.get('from') ?? '';
    if (!/^\+\d{8,15}$/.test(from)) throw new Error('Falta el número de Twilio desde el que llamar (formato +1… o +34…)');
    const r = await jsonFetch<{ sid: string; status: string }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/Calls.json`, {
      method: 'POST',
      headers: { authorization: auth(ctx), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Twiml: buildTwiml(message.slice(0, 1500), repeat), Timeout: '30' }).toString(),
    });
    today.n++;
    return { sid: r.sid, status: r.status, to: `${to.slice(0, 4)}•••${to.slice(-3)}` };
  }

  return {
    id: 'phone',
    name: 'Llamadas de teléfono',
    description: 'JARVIS te llama a tu móvil: buenos días, recordatorios y avisos si algo va mal. Solo puede llamarte a ti.',
    official: true,
    warning: 'Usa Twilio (servicio de telefonía). La cuenta de prueba es gratis (unos 15 $ de saldo) y puede llamar a tu número verificado; las llamadas de prueba empiezan con un aviso en inglés de Twilio. Después: número de Twilio ~1-3 $/mes + ~0,02-0,10 $ por minuto a móviles españoles. Para que llame, JARVIS tiene que estar encendido en tu PC.',
    docsUrl: 'https://console.twilio.com/',
    fields: [
      { key: 'accountSid', label: 'Account SID', secret: false, required: true, placeholder: 'AC…', help: 'console.twilio.com → Account Info.' },
      { key: 'authToken', label: 'Auth Token', secret: true, required: true, placeholder: '32 caracteres' },
      { key: 'from', label: 'Número de Twilio (desde el que llama)', secret: false, required: true, placeholder: '+1…', help: 'Phone Numbers → el número que te da Twilio.' },
      { key: 'to', label: 'Tu móvil (el único al que llamará)', secret: false, required: true, placeholder: '600 111 222', help: 'En la cuenta de prueba tiene que estar verificado en Twilio (Verified Caller IDs).' },
      { key: 'alerts', label: 'Llamarme ante alertas críticas de seguridad (sí/no)', secret: false, required: false, default: 'sí' },
    ],
    async test(ctx) {
      if (!/^AC[0-9a-f]{32}$/i.test(ctx.get('accountSid') ?? '')) return { ok: false, detail: 'El Account SID empieza por «AC» y tiene 34 caracteres' };
      normalizePhone(ctx.get('to') ?? '');
      const a = await jsonFetch<{ status: string; type: string; friendly_name: string }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}.json`, { headers: { authorization: auth(ctx) } });
      if (a.status !== 'active') return { ok: false, detail: `La cuenta de Twilio está «${a.status}»` };
      return { ok: true, detail: `Twilio conectado (${a.type === 'Trial' ? 'cuenta de prueba: solo puede llamar a números verificados' : 'cuenta completa'})` };
    },
    status: () => ({ callsToday: today.day === new Date().toISOString().slice(0, 10) ? today.n : 0, limit: CALLS_PER_DAY }),
    actions: {
      async test_call(ctx) {
        return call(ctx, 'Hola, soy JARVIS. Esta es una llamada de prueba. Si me oyes, las llamadas funcionan correctamente.', 1);
      },
    },
    async onSecurityAlert(ctx, alert: SecurityAlert) {
      if (alert.level !== 'critical' || !/^s[ií]/i.test(ctx.get('alerts') ?? 'sí')) return;
      if (Date.now() - lastCritical < 30 * 60_000) return; // como mucho una llamada de alerta cada 30 min
      lastCritical = Date.now();
      try {
        await call(ctx, `Atención. Soy JARVIS. Alerta de seguridad crítica: ${alert.title}. ${alert.action ? `${alert.action}.` : ''} Revisa la sección de Seguridad en cuanto puedas.`);
        ctx.log('alerta', 'ok', `Llamada por alerta crítica: ${alert.title}`);
      } catch (err) {
        ctx.log('alerta', 'error', (err as Error).message);
      }
    },
    tools: (ctx) => [
      defineTool({
        name: 'phone.call',
        description: 'Llama al móvil del usuario y le dice un mensaje con voz (buenos días, recordatorios, avisos). Solo puede llamar al propietario. Mensaje breve y natural, para escuchar (sin listas ni símbolos).',
        parameters: z.object({ message: z.string().min(5).max(1500), repeat: z.number().int().min(1).max(3).default(1) }),
        permissions: ['connector.phone.call'], risk: 'medium', sideEffects: true,
        risks: [`Hace una llamada real a tu móvil (coste por minuto en Twilio; máximo ${CALLS_PER_DAY} al día)`],
        returns: 'Identificador y estado de la llamada.',
        execute: ({ message, repeat }) => call(ctx, message, repeat),
      }),
      defineTool({
        name: 'phone.calls', description: 'Últimas llamadas hechas por JARVIS (estado y duración).',
        parameters: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
        permissions: ['connector.phone.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Fecha, estado, duración y coste.',
        async execute({ limit }) {
          const r = await jsonFetch<{ calls: { sid: string; status: string; start_time: string | null; duration: string | null; price: string | null; price_unit: string }[] }>(ctx.fetch, `${API}/Accounts/${ctx.get('accountSid')}/Calls.json?PageSize=${limit}`, { headers: { authorization: auth(ctx) } });
          return r.calls.map((c) => ({ status: c.status, start: c.start_time, seconds: c.duration ? Number(c.duration) : null, cost: c.price ? `${Math.abs(Number(c.price)).toFixed(3)} ${c.price_unit}` : null }));
        },
      }),
    ],
  };
}
