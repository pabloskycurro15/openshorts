import { loadConfig } from './kernel/config';
import { startJarvis } from './server/start';

const config = loadConfig();
const running = await startJarvis(config);
running.jarvis.logger.info({ dataDir: config.dataDir }, `JARVIS ${running.jarvis.version} en línea en ${running.url} — token en ${config.dataDir}/auth-token`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  running.jarvis.logger.info({ signal }, 'Apagando JARVIS');
  await running.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
