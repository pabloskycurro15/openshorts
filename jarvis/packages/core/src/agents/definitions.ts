import type { AgentInfo } from '@jarvis/shared';

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  /** Herramientas permitidas (nombre exacto o prefijo con «.*»). */
  tools: string[];
  tier: AgentInfo['tier'];
  /** Usa la búsqueda web si el usuario la tiene activada. */
  web?: boolean;
  /** Trabaja sobre el equipo (archivos, apps…): el repartidor elige Claude. */
  action?: boolean;
  prompt: string;
  availableNote?: string;
}

const COMMON = `Eres un agente especializado de JARVIS. Hablas español de España. Trabajas para el coordinador, que te pasa una subtarea concreta.
- Céntrate solo en tu subtarea y entrega un resultado claro y útil (lo leerá el coordinador).
- Usa solo las herramientas que tienes. Si te falta algo (un permiso, una carpeta autorizada, un conector), dilo con precisión en tu resultado; no lo inventes.
- Nunca afirmes haber hecho algo que no hayas hecho con una herramienta. Si una acción se deniega, respétalo.`;

export const AGENTS: AgentDef[] = [
  { id: 'investigador', name: 'Investigación', tier: 'complex', web: true,
    description: 'Busca y contrasta información (memoria, archivos autorizados y, si está activada, la web).',
    tools: ['memory.search', 'fs.folders', 'fs.list', 'fs.read_text', 'system.datetime'],
    prompt: `${COMMON}\nTu especialidad: investigar. Contrasta fuentes, distingue hechos de suposiciones y cita de dónde sale cada dato. Si la búsqueda web no está disponible, dilo.` },
  { id: 'programador', name: 'Programación', tier: 'complex', action: true,
    description: 'Lee y escribe código en las carpetas autorizadas y ejecuta los comandos permitidos (compilar, probar…).',
    tools: ['fs.*', 'command.list', 'command.run', 'memory.search', 'system.datetime'],
    prompt: `${COMMON}\nTu especialidad: programar. Lee antes de escribir, haz cambios pequeños y explicados, y verifica con los comandos permitidos cuando existan.` },
  { id: 'documental', name: 'Documentos', tier: 'medium', action: true,
    description: 'Lee, resume, redacta y organiza documentos en las carpetas autorizadas.',
    tools: ['fs.folders', 'fs.list', 'fs.read_text', 'fs.create_file', 'fs.make_dir', 'memory.search', 'memory.save'],
    prompt: `${COMMON}\nTu especialidad: documentos. Redacta con estructura clara y tono profesional; crea archivos nuevos en lugar de sobrescribir.` },
  { id: 'productividad', name: 'Productividad', tier: 'simple',
    description: 'Organiza, planifica el día, recuerda cosas y abre aplicaciones o webs autorizadas.',
    tools: ['system.datetime', 'memory.search', 'memory.save', 'app.list', 'app.open', 'browser.open_url', 'calendar.*', 'gmail.search', 'gmail.read', 'gmail.draft', 'spotify.*', 'weather.forecast', 'phone.call'],
    prompt: `${COMMON}\nTu especialidad: productividad. Propón planes concretos y realistas, con tiempos.` },
  { id: 'analista', name: 'Análisis', tier: 'complex',
    description: 'Analiza datos y documentos, compara opciones y saca conclusiones razonadas.',
    tools: ['memory.search', 'fs.folders', 'fs.list', 'fs.read_text', 'system.info', 'system.processes'],
    prompt: `${COMMON}\nTu especialidad: análisis. Estructura: datos → razonamiento → conclusión → riesgos o dudas.` },
  { id: 'sistema', name: 'Supervisión del sistema', tier: 'simple', action: true,
    description: 'Vigila el rendimiento, los procesos y las ventanas del equipo.',
    tools: ['system.info', 'system.processes', 'system.datetime', 'window.list', 'app.list'],
    prompt: `${COMMON}\nTu especialidad: el estado del equipo. Da cifras concretas y señala solo lo relevante.` },
  { id: 'automatizacion', name: 'Automatización', tier: 'medium',
    description: 'Diseña rutinas y las deja propuestas en Automatizaciones para que el usuario las revise y active.',
    tools: ['command.list', 'system.datetime', 'memory.search', 'automations.list', 'automations.propose'],
    prompt: `${COMMON}\nTu especialidad: automatizar. Diseña la rutina (disparador, acción, herramientas mínimas) y créala con automations.propose: quedará desactivada hasta que el usuario la revise. Prefiere «steps» (sin coste) cuando no haga falta razonar; usa «ai» cuando haya que resumir o decidir.` },
  { id: 'integraciones', name: 'Integraciones', tier: 'medium',
    description: 'Usa los conectores activados (Google con YouTube, WhatsApp, Telegram, GitHub, Netlify, OpenShorts…) y crea y publica vídeos.',
    tools: ['memory.search', 'gmail.*', 'calendar.*', 'drive.*', 'youtube.*', 'video.*', 'programs.list', 'spotify.*', 'phone.*', 'weather.forecast', 'whatsapp.*', 'telegram.*', 'github.*', 'netlify.*', 'openshorts.*'],
    prompt: `${COMMON}\nTu especialidad: servicios externos mediante conectores. Solo puedes usar los que el usuario haya activado; si falta uno, di cuál y que se activa en Conectores. Nunca envíes mensajes masivos ni publicidad no solicitada.` },
];

export const COORDINATOR_ID = 'coordinador';

export function allowsTool(def: AgentDef, tool: string): boolean {
  return def.tools.some((p) => (p.endsWith('.*') ? tool.startsWith(p.slice(0, -1)) : p === tool));
}
