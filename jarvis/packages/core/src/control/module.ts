import path from 'node:path';
import type { JarvisModule } from '../kernel/modules';
import type { ControlConfigStore } from './config';
import { createFsTools } from './fs-tools';
import { createOsTools } from './os-tools';
import { nodePlatform, type Platform } from './platform';

/** Módulo de control del equipo: archivos, aplicaciones, navegador, comandos, procesos y ventanas. */
export function controlModule(store: ControlConfigStore, dataDir: string, platform: Platform = nodePlatform): JarvisModule {
  return {
    manifest: {
      id: 'control',
      name: 'Control del equipo',
      version: '0.5.0',
      description: 'Archivos en carpetas autorizadas, aplicaciones, navegador, comandos permitidos, procesos y ventanas.',
      dependsOn: ['system'],
    },
    start(ctx) {
      const get = () => store.get();
      for (const t of [...createFsTools(get, path.join(dataDir, 'papelera')), ...createOsTools(get, platform)]) ctx.tools.register(t);
    },
  };
}
