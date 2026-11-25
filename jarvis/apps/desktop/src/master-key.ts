import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { MasterKeyProvider } from '@jarvis/core';

/** Subconjunto de `electron.safeStorage` que se usa (inyectable para pruebas). */
export interface SafeStorageLike {
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
}

/**
 * Clave maestra del almacén cifrado protegida por el sistema operativo:
 * DPAPI en Windows (ligada a tu usuario de Windows), Llavero en macOS.
 * En disco solo queda la clave cifrada por el sistema.
 */
export class SafeStorageMasterKey implements MasterKeyProvider {
  readonly description = 'protegida por el sistema operativo (DPAPI)';
  private key: Buffer | null = null;
  constructor(private file: string, private storage: SafeStorageLike) {}

  getKey(): Buffer {
    if (this.key) return this.key;
    if (fs.existsSync(this.file)) {
      this.key = Buffer.from(this.storage.decryptString(fs.readFileSync(this.file)), 'base64');
    } else {
      this.key = randomBytes(32);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, this.storage.encryptString(this.key.toString('base64')), { mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error('Clave maestra corrupta');
    return this.key;
  }
}
