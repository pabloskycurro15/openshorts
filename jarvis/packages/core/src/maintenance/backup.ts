import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BackupSettings, type BackupStatus, type BackupView, type Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import { Database as SqliteDb } from '../storage/sqlite';
import type { SecretVault, MasterKeyProvider } from '../security/vault';
import type { AuditLog } from '../security/audit';
import type { EventBus } from '../kernel/events';
import type { Logger } from '../kernel/logger';

const MAGIC = Buffer.from('JARVISBK');
const FORMAT = 1;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const BACKUP_EXT = '.jarvisbak';
const DEFAULTS: BackupSettings = { auto: false, time: '03:30', keep: 7, dir: '', includeWhatsapp: false, offsite: false, supabaseUrl: '', supabaseBucket: 'jarvis-backups' };

interface Entry { name: string; data: Buffer }
interface Manifest { format: number; createdAt: string; jarvisVersion: string; files: { name: string; size: number; sha256: string }[] }

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Cifra con la frase de copia (scrypt → AES-256-GCM). Cabecera:
 * MAGIC(8) · formato(1) · sal(16) · iv(12) · etiqueta(16) · datos(gzip(json-len(4) · json · archivos)).
 */
export function sealBackup(entries: Entry[], passphrase: string, jarvisVersion: string): Buffer {
  const manifest: Manifest = { format: FORMAT, createdAt: new Date().toISOString(), jarvisVersion, files: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha(e.data) })) };
  const json = Buffer.from(JSON.stringify(manifest));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  const plain = gzipSync(Buffer.concat([len, json, ...entries.map((e) => e.data)]));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, Buffer.from([FORMAT]), salt, iv, c.getAuthTag(), enc]);
}

export function openBackup(blob: Buffer, passphrase: string): { manifest: Manifest; entries: Entry[] } {
  if (blob.length < 53 || !blob.subarray(0, 8).equals(MAGIC)) throw new Error('No es una copia de seguridad de JARVIS');
  if (blob[8] !== FORMAT) throw new Error(`Formato de copia no compatible (${blob[8]})`);
  const salt = blob.subarray(9, 25);
  const iv = blob.subarray(25, 37);
  const tag = blob.subarray(37, 53);
  const key = scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = gunzipSync(Buffer.concat([d.update(blob.subarray(53)), d.final()]));
  } catch {
    throw new Error('Frase incorrecta o copia dañada');
  }
  const jlen = plain.readUInt32BE(0);
  const manifest = JSON.parse(plain.subarray(4, 4 + jlen).toString('utf8')) as Manifest;
  let off = 4 + jlen;
  const entries: Entry[] = [];
  for (const f of manifest.files) {
    const data = plain.subarray(off, off + f.size);
    off += f.size;
    if (sha(data) !== f.sha256) throw new Error(`Archivo dañado en la copia: ${f.name}`);
    entries.push({ name: f.name, data });
  }
  return { manifest, entries };
}

/** Restauración de prueba: abre la base de datos de la copia y comprueba su integridad. */
export function verifyEntries(entries: Entry[]): string {
  const db = entries.find((e) => e.name === 'jarvis.db');
  if (!db) throw new Error('La copia no contiene la base de datos');
  if (!entries.some((e) => e.name === 'master.key' && e.data.length === 32)) throw new Error('La copia no contiene la clave maestra');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-verify-'));
  try {
    const file = path.join(tmp, 'jarvis.db');
    fs.writeFileSync(file, db.data);
    const s = new SqliteDb(file);
    try {
      const ok = s.pragma('integrity_check', { simple: true });
      if (ok !== 'ok') throw new Error(`Integridad: ${String(ok)}`);
      const version = s.pragma('user_version', { simple: true }) as number;
      const n = (t: string) => { try { return (s.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n; } catch { return 0; } };
      return `Base de datos íntegra (esquema v${version}): ${n('conversations')} conversaciones, ${n('memories')} recuerdos, ${n('audit_log')} registros de auditoría, ${n('automations')} automatizaciones`;
    } finally {
      s.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Aplica una restauración preparada ANTES de abrir la base de datos (al arrancar).
 * Conserva la base de datos anterior como pre-restore-<fecha>.db.
 */
export function applyPendingRestore(dataDir: string, dbFile: string, keys: MasterKeyProvider, logger?: Logger): boolean {
  const dir = path.join(dataDir, 'restore-pending');
  const marker = path.join(dir, 'ready.json');
  if (!fs.existsSync(marker)) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, path.join(dataDir, `pre-restore-${stamp}.db`));
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
  }
  fs.copyFileSync(path.join(dir, 'jarvis.db'), dbFile);
  const key = fs.readFileSync(path.join(dir, 'master.key'));
  if (keys.setKey) keys.setKey(key);
  else logger?.warn('El proveedor de clave maestra no admite sustituirla: los secretos de la copia no se podrán leer');
  const wa = path.join(dir, 'whatsapp-session');
  if (fs.existsSync(wa)) {
    fs.rmSync(path.join(dataDir, 'whatsapp-session'), { recursive: true, force: true });
    fs.cpSync(wa, path.join(dataDir, 'whatsapp-session'), { recursive: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  logger?.info('Copia de seguridad restaurada');
  return true;
}

type Row = { id: string; file: string; location: 'local' | 'supabase'; created_at: string; size: number; verified: number; verify_detail: string | null; auto: number };
const toView = (r: Row): BackupView => ({ id: r.id, file: r.file, location: r.location, createdAt: r.created_at, size: r.size, verified: !!r.verified, verifyDetail: r.verify_detail, auto: !!r.auto });

/**
 * Copias de seguridad cifradas: base de datos (copia en caliente con VACUUM INTO) + clave
 * maestra (para poder restaurar en otro equipo) + opcionalmente la sesión de WhatsApp.
 * Todo se cifra con la frase del usuario antes de escribirse o subirse. Cada copia se
 * verifica con una restauración de prueba. Destino externo opcional: Supabase Storage.
 */
export class BackupManager {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private db: Database,
    private vault: SecretVault,
    private keys: MasterKeyProvider,
    private audit: AuditLog,
    private bus: EventBus,
    private logger: Logger,
    private dataDir: string,
    private version: string,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  settings(): BackupSettings {
    const raw = getSetting(this.db, 'backup.settings');
    return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<BackupSettings>) : {}) };
  }

  updateSettings(by: Principal, patch: Partial<BackupSettings>): BackupSettings {
    this.assertUser(by);
    const next = BackupSettings.parse({ ...this.settings(), ...patch });
    if (next.dir && !path.isAbsolute(next.dir)) throw new Error('La carpeta de copias debe ser una ruta absoluta');
    if (next.supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(next.supabaseUrl.replace(/\/$/, ''))) throw new Error('La URL de Supabase debe ser https://<proyecto>.supabase.co');
    next.supabaseUrl = next.supabaseUrl.replace(/\/$/, '');
    if (next.offsite && (!next.supabaseUrl || !this.vault.get('backup.supabase.key'))) throw new Error('Configura la URL y la clave de Supabase antes de activar la copia externa');
    setSetting(this.db, 'backup.settings', JSON.stringify(next));
    this.audit.append({ principal: by, action: 'backup.settings', outcome: 'success', details: { auto: next.auto, time: next.time, keep: next.keep, offsite: next.offsite, includeWhatsapp: next.includeWhatsapp } });
    return next;
  }

  setPassphrase(by: Principal, passphrase: string) {
    this.assertUser(by);
    if (passphrase.length < 12) throw new Error('La frase debe tener al menos 12 caracteres');
    this.vault.set('backup.passphrase', passphrase);
    this.audit.append({ principal: by, action: 'backup.passphrase_set', outcome: 'success' });
  }

  setSupabaseKey(by: Principal, key: string | null) {
    this.assertUser(by);
    if (key) this.vault.set('backup.supabase.key', key.trim());
    else {
      this.vault.delete('backup.supabase.key');
      const s = this.settings();
      if (s.offsite) setSetting(this.db, 'backup.settings', JSON.stringify({ ...s, offsite: false }));
    }
    this.audit.append({ principal: by, action: key ? 'backup.supabase_key_set' : 'backup.supabase_key_deleted', outcome: 'success' });
  }

  dir(): string {
    return this.settings().dir || path.join(this.dataDir, 'backups');
  }

  status(): BackupStatus {
    this.scanLocal();
    const backups = (this.db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 100').all() as Row[]).map(toView);
    const lastOk = backups.find((b) => b.verified)?.createdAt ?? null;
    return {
      settings: this.settings(), hasPassphrase: !!this.vault.get('backup.passphrase'), hasSupabaseKey: !!this.vault.get('backup.supabase.key'),
      dir: this.dir(), backups, lastOk, nextAuto: this.nextAuto()?.toISOString() ?? null, restorePending: fs.existsSync(path.join(this.dataDir, 'restore-pending', 'ready.json')),
    };
  }

  /** Añade a la lista las copias que el usuario haya dejado en la carpeta (p. ej. traídas de otro equipo). */
  private scanLocal() {
    const dir = this.dir();
    if (!fs.existsSync(dir)) return;
    const known = new Set((this.db.prepare("SELECT file FROM backups WHERE location = 'local'").all() as { file: string }[]).map((r) => r.file));
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(BACKUP_EXT) || known.has(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      this.db.prepare("INSERT INTO backups (id, file, location, created_at, size, verified, verify_detail) VALUES (?, ?, 'local', ?, ?, 0, 'Encontrada en la carpeta: sin verificar')").run(randomUUID(), f, st.mtime.toISOString(), st.size);
    }
    for (const f of known) if (!fs.existsSync(path.join(dir, f))) this.db.prepare("DELETE FROM backups WHERE location = 'local' AND file = ?").run(f);
  }

  /** Crea, verifica (restauración de prueba), sube si procede y aplica la retención. */
  async create(by: Principal, opts: { auto?: boolean } = {}): Promise<BackupView> {
    if (by.kind !== 'user' && by.kind !== 'core') throw new Error('Solo el usuario crea copias de seguridad');
    const passphrase = this.vault.get('backup.passphrase');
    if (!passphrase) throw new Error('Primero define la frase de las copias de seguridad');
    if (this.busy) throw new Error('Ya hay una copia en marcha');
    this.busy = true;
    try {
      const s = this.settings();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-backup-'));
      let blob: Buffer;
      try {
        const dbCopy = path.join(tmp, 'jarvis.db');
        this.db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
        const entries: Entry[] = [{ name: 'jarvis.db', data: fs.readFileSync(dbCopy) }, { name: 'master.key', data: Buffer.from(this.keys.getKey()) }];
        const wa = path.join(this.dataDir, 'whatsapp-session');
        if (s.includeWhatsapp && fs.existsSync(wa)) {
          for (const f of fs.readdirSync(wa)) {
            const full = path.join(wa, f);
            if (fs.statSync(full).isFile()) entries.push({ name: `whatsapp-session/${f}`, data: fs.readFileSync(full) });
          }
        }
        blob = sealBackup(entries, passphrase, this.version);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      // Verificación: se descifra lo que se va a guardar y se abre su base de datos.
      const detail = verifyEntries(openBackup(blob, passphrase).entries);
      const now = new Date();
      const name = `jarvis-${now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}${BACKUP_EXT}`;
      fs.mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(this.dir(), name), blob, { mode: 0o600 });
      const id = randomUUID();
      this.db.prepare("INSERT INTO backups (id, file, location, created_at, size, verified, verify_detail, auto) VALUES (?, ?, 'local', ?, ?, 1, ?, ?)").run(id, name, now.toISOString(), blob.length, detail, opts.auto ? 1 : 0);
      this.audit.append({ principal: by, action: 'backup.create', target: name, outcome: 'success', details: { size: blob.length, auto: !!opts.auto } });
      if (s.offsite) {
        try {
          await this.upload(name, blob);
          this.db.prepare("INSERT INTO backups (id, file, location, created_at, size, verified, verify_detail, auto) VALUES (?, ?, 'supabase', ?, ?, 1, ?, ?)").run(randomUUID(), name, now.toISOString(), blob.length, 'Copia externa cifrada (verificada antes de subir)', opts.auto ? 1 : 0);
        } catch (err) {
          this.bus.emit('notification', { title: 'La copia externa falló', body: (err as Error).message, source: 'backup' });
          this.logger.warn({ err }, 'No se pudo subir la copia a Supabase');
        }
      }
      await this.prune();
      return toView(this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as Row);
    } finally {
      this.busy = false;
    }
  }

  async verify(id: string): Promise<BackupView> {
    const r = this.mustRow(id);
    const passphrase = this.vault.get('backup.passphrase');
    if (!passphrase) throw new Error('Define la frase de las copias para verificarlas');
    let ok = 0;
    let detail: string;
    try {
      detail = verifyEntries(openBackup(await this.read(r), passphrase).entries);
      ok = 1;
    } catch (err) {
      detail = `Falló: ${(err as Error).message}`;
    }
    this.db.prepare('UPDATE backups SET verified = ?, verify_detail = ? WHERE id = ?').run(ok, detail, id);
    return toView(this.mustRow(id));
  }

  /** Prepara la restauración (se aplica al reiniciar JARVIS). La frase puede ser otra (copia de otro equipo). */
  async prepareRestore(by: Principal, id: string, passphrase?: string): Promise<{ detail: string; createdAt: string; jarvisVersion: string }> {
    this.assertUser(by);
    const r = this.mustRow(id);
    const pass = passphrase || this.vault.get('backup.passphrase');
    if (!pass) throw new Error('Escribe la frase de esa copia');
    const { manifest, entries } = openBackup(await this.read(r), pass);
    const detail = verifyEntries(entries);
    const dir = path.join(this.dataDir, 'restore-pending');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const e of entries) {
      const target = path.join(dir, e.name);
      if (!target.startsWith(dir + path.sep)) throw new Error('Nombre de archivo no válido en la copia');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.data, { mode: 0o600 });
    }
    fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ file: r.file, createdAt: manifest.createdAt }));
    this.audit.append({ principal: by, action: 'backup.restore_prepared', target: r.file, outcome: 'success' });
    return { detail, createdAt: manifest.createdAt, jarvisVersion: manifest.jarvisVersion };
  }

  cancelRestore(by: Principal) {
    this.assertUser(by);
    fs.rmSync(path.join(this.dataDir, 'restore-pending'), { recursive: true, force: true });
  }

  delete(by: Principal, id: string) {
    this.assertUser(by);
    const r = this.mustRow(id);
    if (r.location === 'local') fs.rmSync(path.join(this.dir(), r.file), { force: true });
    this.db.prepare('DELETE FROM backups WHERE id = ?').run(id);
    this.audit.append({ principal: by, action: 'backup.delete', target: r.file, outcome: 'success', details: { location: r.location } });
  }

  // ── Programación ──

  start(tickMs = 60_000) {
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  nextAuto(now = new Date()): Date | null {
    const s = this.settings();
    if (!s.auto) return null;
    const [h, m] = s.time.split(':').map(Number) as [number, number];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const doneToday = getSetting(this.db, 'backup.lastAutoDay') === localDay(now);
    return today > now && !doneToday ? today : new Date(today.getTime() + 86_400_000);
  }

  async tick(now = new Date()): Promise<void> {
    const s = this.settings();
    if (!s.auto || this.busy || !this.vault.get('backup.passphrase')) return;
    const [h, m] = s.time.split(':').map(Number) as [number, number];
    const due = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
    if (!due || getSetting(this.db, 'backup.lastAutoDay') === localDay(now)) return;
    setSetting(this.db, 'backup.lastAutoDay', localDay(now));
    try {
      await this.create({ kind: 'core', id: 'backup' }, { auto: true });
    } catch (err) {
      this.bus.emit('notification', { title: 'La copia de seguridad automática falló', body: (err as Error).message, source: 'backup' });
    }
  }

  // ── Supabase Storage (destino externo opcional) ──

  private sb(pathPart: string, init: RequestInit = {}) {
    const s = this.settings();
    const key = this.vault.get('backup.supabase.key');
    if (!s.supabaseUrl || !key) throw new Error('Supabase no está configurado');
    return this.fetchImpl(`${s.supabaseUrl}/storage/v1/${pathPart}`, { ...init, headers: { authorization: `Bearer ${key}`, apikey: key, ...(init.headers as Record<string, string> | undefined) } });
  }

  async testSupabase(): Promise<{ ok: boolean; detail: string }> {
    try {
      const bucket = this.settings().supabaseBucket;
      let res = await this.sb(`bucket/${bucket}`);
      if (res.status === 400 || res.status === 404) {
        // Crear el contenedor privado si no existe.
        res = await this.sb('bucket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
        if (!res.ok) return { ok: false, detail: `No se pudo crear el contenedor: HTTP ${res.status} ${(await res.text()).slice(0, 150)}` };
        return { ok: true, detail: `Contenedor privado «${bucket}» creado` };
      }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 150)}` };
      const b = (await res.json()) as { public?: boolean };
      if (b.public) return { ok: false, detail: `El contenedor «${bucket}» es público: hazlo privado en Supabase` };
      return { ok: true, detail: `Contenedor privado «${bucket}» accesible` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  private async upload(name: string, blob: Buffer) {
    const res = await this.sb(`object/${this.settings().supabaseBucket}/${name}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' }, body: new Uint8Array(blob) });
    if (!res.ok) throw new Error(`Supabase respondió HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }

  private async read(r: Row): Promise<Buffer> {
    if (r.location === 'local') {
      const f = path.join(this.dir(), r.file);
      if (!fs.existsSync(f)) throw new Error('El archivo de la copia ya no existe');
      return fs.readFileSync(f);
    }
    const res = await this.sb(`object/${this.settings().supabaseBucket}/${r.file}`);
    if (!res.ok) throw new Error(`No se pudo descargar de Supabase: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async prune() {
    const keep = this.settings().keep;
    for (const loc of ['local', 'supabase'] as const) {
      const rows = this.db.prepare('SELECT * FROM backups WHERE location = ? ORDER BY created_at DESC').all(loc) as Row[];
      for (const r of rows.slice(keep)) {
        try {
          if (loc === 'local') fs.rmSync(path.join(this.dir(), r.file), { force: true });
          else await this.sb(`object/${this.settings().supabaseBucket}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [r.file] }) });
          this.db.prepare('DELETE FROM backups WHERE id = ?').run(r.id);
        } catch (err) {
          this.logger.warn({ err }, 'No se pudo borrar una copia antigua');
        }
      }
    }
  }

  private mustRow(id: string): Row {
    const r = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new Error('Copia inexistente');
    return r;
  }

  private assertUser(by: Principal) {
    if (by.kind !== 'user') throw new Error('Solo el usuario gestiona las copias de seguridad');
  }
}
