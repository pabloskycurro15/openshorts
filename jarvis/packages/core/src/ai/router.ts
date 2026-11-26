import type { AiSettings } from '@jarvis/shared';

/**
 * Repartidor de tareas entre modelos. Clasifica cada mensaje con reglas locales
 * (instantáneo y gratis: no gasta una llamada a la IA para decidir) y propone una
 * cadena de modelos, del preferido al de respaldo.
 *
 *  sencilla → Gemini Flash-Lite (gratis) → Claude Haiku → GPT Terra
 *  media    → GPT Terra → Claude Sonnet → Claude Opus
 *  compleja → Claude Opus → Claude Sonnet → GPT Terra
 *
 * Reglas extra: las acciones sobre el equipo (archivos, apps, comandos) van a Claude,
 * que usa mejor las herramientas; lo sensible nunca va al nivel gratuito de Google
 * (Google puede usar esos datos).
 */
export type Tier = 'simple' | 'medium' | 'complex';
export interface RouteCandidate { provider: string; model: string }
export interface RouteDecision { tier: Tier; reason: string; sensitive: boolean; action: boolean; web: boolean; chain: RouteCandidate[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const COMPLEX = /\b(planifica|plan de|estrategia|programa(r|me)?|codigo|script|depura|bug|refactoriza|arquitectura|crea(r|me)? (una|la|un) (web|pagina|app|aplicacion)|disena|investiga|analiza|compara|informe|paso a paso|optimiza|razona|demuestra|calcula .{20,}|negocio|contrato|presupuesto detallado)\b/;
const ACTION = /\b(archivo|archivos|carpeta|fichero|documento|abre|abrir|cierra|cerrar|ejecuta|ejecutar|comando|borra|borrar|elimina|mueve|mover|renombra|crea (el|un) archivo|guarda|escribe en|ventana|aplicacion|programa (abierto|instalado)|proceso|navegador|pagina web de)\b/;
const SIMPLE = /^(hola|buenas|buenos dias|buenas (tardes|noches)|gracias|vale|ok|adios|hasta luego|que tal|como estas)\b|\b(que hora|que dia|fecha|chiste|traduce|resume (esto|en una frase)|define|que significa|sinonimo|cuanto es \d)/;
const WEB = /\b(busca(r|me)? (en )?(internet|la web|google|online)|en internet|noticias|actualidad|ultima hora|hoy en dia|precio actual|cotizacion|que tiempo hace|horario de|telefono de|direccion de|web de|negocios de|tiendas? de|bares? (de|en))\b/;
const SENSITIVE = /\b(contrasena|password|clave|pin|dni|nie|pasaporte|tarjeta|iban|cuenta bancaria|banco|nomina|salud|medico|diagnostico|enfermedad|medicacion|terapia|abogado|denuncia|direccion de casa|telefono personal|secreto)\b/;

/** ¿El texto contiene datos sensibles? (contraseñas, banco, salud, identidad…) */
export const isSensitive = (text: string) => SENSITIVE.test(norm(text));

export function classify(message: string): Omit<RouteDecision, 'chain'> {
  const m = norm(message);
  const sensitive = SENSITIVE.test(m);
  const action = ACTION.test(m);
  const web = WEB.test(m);
  if (COMPLEX.test(m) || m.length > 700) return { tier: 'complex', reason: m.length > 700 ? 'mensaje largo' : 'tarea compleja', sensitive, action, web };
  if (action) return { tier: 'medium', reason: 'acción sobre el equipo', sensitive, action, web };
  if (web) return { tier: 'medium', reason: 'necesita buscar en internet', sensitive, action, web };
  if (SIMPLE.test(m) || m.length < 90) return { tier: 'simple', reason: 'consulta sencilla', sensitive, action, web };
  return { tier: 'medium', reason: 'consulta normal', sensitive, action, web };
}

export const M = {
  opus: { provider: 'anthropic', model: 'claude-opus-5-5' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  haiku: { provider: 'anthropic', model: 'claude-haiku-5-5' },
  terra: { provider: 'openai', model: 'gpt-6.1-terra' },
} as const;

/** Cadena por nivel (la usan los agentes, que ya saben qué dificultad tiene su trabajo). */
export function chainForTier(tier: Tier, o: { settings: AiSettings; configured: Set<string>; freeModels: string[]; coolingDown: (c: RouteCandidate) => boolean; web?: boolean; action?: boolean }): RouteCandidate[] {
  const free = o.settings.allowFreeGoogle ? o.freeModels.map((model) => ({ provider: 'google', model })) : [];
  let chain: RouteCandidate[];
  // Gemini gratis también es el último respaldo en tareas medias y complejas (el modelo más capaz primero):
  // así JARVIS funciona aunque solo haya clave de Google.
  const freeStrong = [...free].reverse();
  if (o.web && o.settings.webSearch) chain = [...(tier === 'complex' ? [M.opus, M.sonnet] : [M.sonnet, M.opus]), ...freeStrong];
  else if (o.action) chain = [...(tier === 'complex' ? [M.opus, M.sonnet, M.terra] : [M.sonnet, M.opus, M.terra]), ...freeStrong];
  else if (tier === 'simple') chain = [...free, M.haiku, M.terra, M.sonnet];
  else if (tier === 'medium') chain = [M.terra, M.sonnet, M.opus, ...freeStrong];
  else chain = [M.opus, M.sonnet, M.terra, ...freeStrong];
  const usable = chain.filter((x) => o.configured.has(x.provider) && !o.coolingDown(x));
  return usable.length ? usable : chain.filter((x) => o.configured.has(x.provider));
}

/**
 * Cadena de candidatos para una tarea. `freeModels` son los modelos gratuitos de Google
 * (en orden). Se filtran los proveedores sin clave y los modelos en pausa.
 */
export function route(
  message: string,
  opts: { settings: AiSettings; configured: Set<string>; freeModels: string[]; coolingDown: (c: RouteCandidate) => boolean },
): RouteDecision {
  const c = classify(message);
  const free = opts.settings.allowFreeGoogle && !c.sensitive ? opts.freeModels.map((model) => ({ provider: 'google', model })) : [];
  let chain: RouteCandidate[];
  const freeStrong = [...free].reverse();
  if (c.web && opts.settings.webSearch) {
    // Solo Claude tiene la búsqueda web integrada; sin Claude, Gemini responde sin buscar.
    chain = [...(c.tier === 'complex' ? [M.opus, M.sonnet] : [M.sonnet, M.opus]), ...freeStrong];
  } else if (c.action) {
    // Las herramientas las maneja mejor Claude; Gemini gratis como último respaldo.
    chain = [...(c.tier === 'complex' ? [M.opus, M.sonnet, M.terra] : [M.sonnet, M.opus, M.terra]), ...freeStrong];
  } else if (c.tier === 'simple') chain = [...free, M.haiku, M.terra, M.sonnet];
  else if (c.tier === 'medium') chain = [M.terra, M.sonnet, M.opus, ...freeStrong];
  else chain = [M.opus, M.sonnet, M.terra, ...freeStrong];
  const usable = chain.filter((x) => opts.configured.has(x.provider) && !opts.coolingDown(x));
  // Si todo está en pausa, mejor intentarlo igualmente que no responder.
  const fallback = chain.filter((x) => opts.configured.has(x.provider));
  return { ...c, chain: usable.length ? usable : fallback };
}
