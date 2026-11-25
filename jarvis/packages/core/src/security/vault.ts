import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Database } from '../storage/db';

/**
 * Protección de la clave maestra. La implementación por defecto la guarda en un
 * archivo 0600 separado de la base de datos. En la app de escritorio (Fase 5) se
 * sustituirá por Electron safeStorage (DPAPI en Windows) sin cambiar el almacén.
 */
export interface MasterKeyProvider {
  getKey(): Buffer;
  /** Sustituir la clave (al restaurar una copia de seguridad en otro equipo). */
  setKey?(key: Buffer): void;
  readonly description: string;
}

export class FileMasterKey implements MasterKeyProvider {
  readonly description = 'archivo local con permisos 0600';
  private key: Buffer | null = null;
  constructor(private file: string) {}

  getKey(): Buffer {
    if (this.key) return this.key;
    if (fs.existsSync(this.file)) {
      const k = fs.readFileSync(this.file);
      if (k.length !== 32) throw new Error('Clave maestra corrupta');
      this.key = k;
    } else {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.key = randomBytes(32);
      fs.writeFileSync(this.file, this.key, { mode: 0o600 });
    }
    return this.key;
  }

  setKey(key: Buffer) {
    if (key.length !== 32) throw new Error('Clave maestra no válida');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, key, { mode: 0o600 });
    this.key = Buffer.from(key);
  }
}

/**
 * Almacén de secretos cifrado con AES-256-GCM (autenticado). El nombre del secreto
 * se usa como dato adicional autenticado, así que un cifrado no se puede mover a
 * otro nombre. La API nunca devuelve el valor: solo si existe.
 *
 * Protege frente a filtraciones de la base de datos o de copias de seguridad.
 * NO protege frente a alguien con acceso completo a la carpeta de datos del
 * usuario (para eso, la Fase 5 usará DPAPI).
 */
export class SecretVault {
  constructor(private db: Database, private keys: MasterKeyProvider) {}

  set(name: string, value: string): void {
    if (!value) throw new Error('Valor vacío');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.getKey(), iv);
    cipher.setAAD(Buffer.from(name));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    this.db
      .prepare(
        `INSERT INTO secrets (name, iv, tag, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(name, iv, cipher.getAuthTag(), ciphertext, new Date().toISOString());
  }

  get(name: string): string | null {
    const row = this.db.prepare('SELECT iv, tag, ciphertext FROM secrets WHERE name = ?').get(name) as
      | { iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }
      | undefined;
    if (!row) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.keys.getKey(), Buffer.from(row.iv));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(row.tag));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]).toString('utf8');
  }

  has(name: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM secrets WHERE name = ?').get(name);
  }

  updatedAt(name: string): string | null {
    const r = this.db.prepare('SELECT updated_at FROM secrets WHERE name = ?').get(name) as { updated_at: string } | undefined;
    return r?.updated_at ?? null;
  }

  delete(name: string): boolean {
    return this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name).changes > 0;
  }
}
