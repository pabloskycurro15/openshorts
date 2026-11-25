import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import type { JarvisModule } from '../src/kernel/modules';

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
}

export async function makeJarvis(extraModules: JarvisModule[] = []): Promise<Jarvis> {
  const config = loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' });
  const j = createJarvis(config, { dbFile: ':memory:', extraModules });
  await j.start();
  return j;
}
