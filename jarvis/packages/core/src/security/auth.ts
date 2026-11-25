import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token local del núcleo. Se genera la primera vez y se guarda en el directorio de
 * datos con permisos 0600. Los clientes locales (escritorio) lo leen del disco;
 * los remotos (iOS/PWA) recibirán credenciales propias en la Fase 10.
 */
export function loadOrCreateToken(dataDir: string): string {
  const file = path.join(dataDir, 'auth-token');
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  }
  const token = randomBytes(32).toString('base64url');
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
