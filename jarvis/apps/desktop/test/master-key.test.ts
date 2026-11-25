import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SafeStorageMasterKey, type SafeStorageLike } from '../src/master-key';

/** Doble de safeStorage: «cifra» con XOR y una marca, para comprobar que nunca se guarda en claro. */
const fake: SafeStorageLike = {
  encryptString: (s) => Buffer.concat([Buffer.from('DPAPI'), Buffer.from(s).map((b) => b ^ 0x5a)]),
  decryptString: (b) => {
    if (!b.subarray(0, 5).equals(Buffer.from('DPAPI'))) throw new Error('no cifrado por el sistema');
    return Buffer.from(b.subarray(5).map((x) => x ^ 0x5a)).toString();
  },
};

describe('Clave maestra protegida por el sistema', () => {
  it('genera una clave de 32 bytes, la guarda cifrada y la recupera igual', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-')), 'vault.key.enc');
    const k1 = new SafeStorageMasterKey(file, fake).getKey();
    expect(k1).toHaveLength(32);
    const onDisk = fs.readFileSync(file);
    expect(onDisk.includes(Buffer.from(k1.toString('base64')))).toBe(false);
    expect(new SafeStorageMasterKey(file, fake).getKey().equals(k1)).toBe(true);
  });

  it('falla si el archivo no lo cifró el sistema (p. ej. copiado de otro usuario)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-')), 'vault.key.enc');
    fs.writeFileSync(file, 'texto plano');
    expect(() => new SafeStorageMasterKey(file, fake).getKey()).toThrow();
  });
});
