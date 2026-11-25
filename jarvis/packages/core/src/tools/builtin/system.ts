import os from 'node:os';
import { z } from 'zod';
import { defineTool } from '../registry';
import type { JarvisModule } from '../../kernel/modules';

/** Información real del equipo donde corre el núcleo. Solo lectura. */
export const systemInfoTool = defineTool({
  name: 'system.info',
  description: 'Devuelve información del sistema: SO, CPU, memoria y tiempo encendido.',
  parameters: z.object({}).strict(),
  permissions: ['system.info.read'],
  risk: 'low',
  sideEffects: false,
  risks: [],
  returns: 'Objeto con plataforma, versión, CPU (modelo, núcleos, carga), memoria total/libre y uptime.',
  execute: () => {
    const cpus = os.cpus();
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpu: { model: cpus[0]?.model ?? 'desconocido', cores: cpus.length, loadAvg: os.loadavg() },
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      uptimeSec: Math.round(os.uptime()),
    };
  },
});

export const systemModule: JarvisModule = {
  manifest: {
    id: 'system',
    name: 'Sistema',
    version: '0.1.0',
    description: 'Información y supervisión básica del equipo anfitrión.',
  },
  start(ctx) {
    ctx.tools.register(systemInfoTool);
  },
};
