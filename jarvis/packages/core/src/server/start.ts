import { randomBytes } from 'node:crypto';
import type { JarvisConfig } from '../kernel/config';
import { createJarvis, type Jarvis } from '../app';
import { buildServer } from './http';
import { loadOrCreateToken } from '../security/auth';
import type { MasterKeyProvider } from '../security/vault';

export interface RunningJarvis {
  jarvis: Jarvis;
  url: string;
  token: string;
  close(): Promise<void>;
}

/**
 * Arranca el núcleo completo (servicios + API + interfaz si hay webDir).
 * Lo usan el punto de entrada independiente (main.ts) y la app de escritorio.
 */
export async function startJarvis(config: JarvisConfig, opts: { masterKey?: MasterKeyProvider; ephemeralToken?: boolean } = {}): Promise<RunningJarvis> {
  const jarvis = createJarvis(config, { masterKey: opts.masterKey });
  // Escritorio: token nuevo en cada arranque, solo en memoria (se entrega a la ventana por el preload).
  const token = opts.ephemeralToken ? randomBytes(32).toString('base64url') : loadOrCreateToken(config.dataDir);
  await jarvis.start();
  const server = await buildServer(jarvis, token);
  await server.listen({ host: config.host, port: config.port });
  const addr = server.server.address() as { port: number };
  let closed = false;
  return {
    jarvis,
    token,
    url: `http://${config.host}:${addr.port}`,
    async close() {
      if (closed) return;
      closed = true;
      jarvis.ai.engine.stopAll();
      await server.close();
      await jarvis.stop();
    },
  };
}
