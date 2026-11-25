import { loadConfig } from './kernel/config';
import { createJarvis } from './app';
import { buildServer } from './server/http';
import { loadOrCreateToken } from './security/auth';

const config = loadConfig();
const jarvis = createJarvis(config);
const token = loadOrCreateToken(config.dataDir);

await jarvis.start();
const server = await buildServer(jarvis, token);
await server.listen({ host: config.host, port: config.port });
jarvis.logger.info({ dataDir: config.dataDir }, `JARVIS ${jarvis.version} en línea — token en ${config.dataDir}/auth-token`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  jarvis.logger.info({ signal }, 'Apagando JARVIS');
  await server.close();
  await jarvis.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
