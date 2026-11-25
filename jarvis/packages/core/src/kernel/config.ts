import path from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().min(0).max(65535).default(7777),
  dataDir: z.string().default('./.data'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type JarvisConfig = z.infer<typeof ConfigSchema>;

/** Carga la configuración desde variables de entorno (JARVIS_*) con validación. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  const parsed = ConfigSchema.parse({
    host: env.JARVIS_HOST,
    port: env.JARVIS_PORT,
    dataDir: env.JARVIS_DATA_DIR,
    logLevel: env.JARVIS_LOG_LEVEL,
    ...overrides,
  });
  return { ...parsed, dataDir: path.resolve(parsed.dataDir) };
}
