import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/db';
import { FileMasterKey, SecretVault } from '../src/security/vault';
import { Budget, DEFAULT_AI_SETTINGS, monthStart } from '../src/ai/budget';
import { tmpDir } from './helpers';

describe('SecretVault', () => {
  const setup = () => {
    const dir = tmpDir();
    const db = openDatabase(path.join(dir, 'j.db'));
    return { dir, db, vault: new SecretVault(db, new FileMasterKey(path.join(dir, 'vault.key'))) };
  };

  it('cifra, descifra, informa de existencia y borra', () => {
    const { vault } = setup();
    expect(vault.has('k')).toBe(false);
    vault.set('k', 'sk-ant-secreto-123');
    expect(vault.has('k')).toBe(true);
    expect(vault.get('k')).toBe('sk-ant-secreto-123');
    expect(vault.delete('k')).toBe(true);
    expect(vault.get('k')).toBeNull();
  });

  it('el valor no aparece en claro en la base de datos', () => {
    const { vault, db, dir } = setup();
    vault.set('k', 'sk-ant-MUY-SECRETO-VALOR');
    db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = Buffer.concat(fs.readdirSync(dir).filter((f) => f.startsWith('j.db')).map((f) => fs.readFileSync(path.join(dir, f))));
    expect(bytes.includes(Buffer.from('MUY-SECRETO'))).toBe(false);
  });

  it('la clave maestra es privada (0600) y otra clave no puede descifrar', () => {
    const { vault, db, dir } = setup();
    vault.set('k', 'valor');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'vault.key')).mode & 0o777).toBe(0o600);
    const other = new SecretVault(db, new FileMasterKey(path.join(tmpDir(), 'otra.key')));
    expect(() => other.get('k')).toThrow();
  });

  it('un cifrado no se puede trasladar a otro nombre (dato autenticado)', () => {
    const { vault, db } = setup();
    vault.set('a', 'valor-a');
    db.prepare("INSERT INTO secrets SELECT 'b', iv, tag, ciphertext, updated_at FROM secrets WHERE name = 'a'").run();
    expect(() => vault.get('b')).toThrow();
  });
});

describe('Budget', () => {
  const budget = () => new Budget(openDatabase(':memory:'));
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it('valores por defecto: repartidor automático, Gemini gratis permitido, esfuerzo medio, 5 $', () => {
    expect(budget().getSettings()).toEqual(DEFAULT_AI_SETTINGS);
    expect(DEFAULT_AI_SETTINGS).toEqual({ model: 'auto', allowFreeGoogle: true, webSearch: false, webSearchMaxUses: 5, effort: 'medium', monthlyLimitUsd: 5 });
  });

  it('valida los ajustes', () => {
    const b = budget();
    expect(b.updateSettings({ monthlyLimitUsd: 10 }).monthlyLimitUsd).toBe(10);
    expect(() => b.updateSettings({ monthlyLimitUsd: -1 })).toThrow();
    expect(() => b.updateSettings({ effort: 'extremo' as never })).toThrow();
  });

  it('acumula el gasto del mes y avisa al 80 % y bloquea al 100 %', () => {
    const b = budget();
    b.updateSettings({ monthlyLimitUsd: 1 });
    b.record({ conversationId: null, provider: 'anthropic', model: 'm', usage, costUsd: 0.5 });
    expect(b.state()).toMatchObject({ spent: 0.5, warn: false, blocked: false });
    b.record({ conversationId: null, provider: 'anthropic', model: 'm', usage, costUsd: 0.31 });
    expect(b.state()).toMatchObject({ warn: true, blocked: false });
    b.record({ conversationId: null, provider: 'anthropic', model: 'm', usage, costUsd: 0.2 });
    expect(b.state().blocked).toBe(true);
  });

  it('el gasto se reinicia cada mes natural', () => {
    const b = budget();
    b.record({ conversationId: null, provider: 'anthropic', model: 'm', usage, costUsd: 3 });
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    expect(b.monthSpend(nextMonth)).toBe(0);
    expect(new Date(monthStart(new Date(2026, 10, 25))).getDate()).toBe(1);
  });
});
