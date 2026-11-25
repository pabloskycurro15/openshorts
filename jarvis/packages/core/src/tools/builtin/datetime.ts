import { z } from 'zod';
import { defineTool } from '../registry';

/** Fecha y hora reales del equipo, en la zona horaria del sistema. */
export const datetimeTool = defineTool({
  name: 'system.datetime',
  description: 'Devuelve la fecha y hora actuales del equipo y su zona horaria.',
  parameters: z.object({}).strict(),
  permissions: ['system.time.read'],
  risk: 'low',
  sideEffects: false,
  risks: [],
  returns: 'Fecha y hora ISO, texto legible en español y zona horaria.',
  execute: () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }),
      timeZone: tz,
    };
  },
});
