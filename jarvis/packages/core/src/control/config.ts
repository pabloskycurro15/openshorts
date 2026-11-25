import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Principal } from '@jarvis/shared';
import type { Database } from '../storage/db';
import { getSetting, setSetting } from '../storage/db';
import type { AuditLog } from '../security/audit';

/**
 * Configuración del control del equipo: qué carpetas, aplicaciones y comandos ha
 * autorizado el usuario. Es la lista blanca de la que dependen todas las herramientas
 * de control: lo que no está aquí, no existe para JARVIS. Solo el usuario la modifica.
 */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Id: minúsculas, números y guiones');
// Argumentos fijos: sin metacaracteres de shell (los procesos se lanzan sin shell, pero por si acaso).
const Arg = z.string().max(400).refine((a) => !/[\n\r\0]/.test(a), 'Argumento no válido');

export const AuthorizedFolder = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  path: z.string().min(1).max(500),
  access: z.enum(['read', 'readwrite']),
});
export const AuthorizedApp = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  /** Ruta absoluta al ejecutable o nombre de un programa del sistema (p. ej. "notepad.exe"). */
  command: z.string().min(1).max(500),
  args: z.array(Arg).max(20).default([]),
  /** Nombre del proceso en Windows (p. ej. "notepad.exe") para poder cerrarlo. Opcional. */
  processName: z.string().max(100).optional(),
});
export const AllowedCommand = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(''),
  command: z.string().min(1).max(500),
  args: z.array(Arg).max(30).default([]),
  cwdFolderId: Id.optional(),
  timeoutSec: z.number().int().min(1).max(600).default(60),
});
export const ControlConfig = z.object({
  folders: z.array(AuthorizedFolder).max(50).default([]),
  apps: z.array(AuthorizedApp).max(100).default([]),
  commands: z.array(AllowedCommand).max(100).default([]),
});
export type AuthorizedFolder = z.infer<typeof AuthorizedFolder>;
export type AuthorizedApp = z.infer<typeof AuthorizedApp>;
export type AllowedCommand = z.infer<typeof AllowedCommand>;
export type ControlConfig = z.infer<typeof ControlConfig>;

const KEY = 'control.config';

export class ControlConfigError extends Error {}

function isFilesystemRoot(p: string): boolean {
  return path.parse(p).root === p;
}

export class ControlConfigStore {
  constructor(private db: Database, private audit: AuditLog) {}

  get(): ControlConfig {
    const raw = getSetting(this.db, KEY);
    const parsed = ControlConfig.safeParse(raw ? JSON.parse(raw) : {});
    return parsed.success ? parsed.data : { folders: [], apps: [], commands: [] };
  }

  set(by: Principal, input: unknown): ControlConfig {
    if (by.kind !== 'user') {
      this.audit.append({ principal: by, action: 'permission.escalation_attempt', outcome: 'denied', details: { what: 'control.config' } });
      throw new Error('Solo el usuario puede autorizar carpetas, aplicaciones o comandos');
    }
    const cfg = ControlConfig.parse(input);
    const ids = new Set<string>();
    for (const list of [cfg.folders, cfg.apps, cfg.commands]) {
      ids.clear();
      for (const x of list) {
        if (ids.has(x.id)) throw new ControlConfigError(`Id repetido: ${x.id}`);
        ids.add(x.id);
      }
    }
    cfg.folders = cfg.folders.map((f) => {
      if (!path.isAbsolute(f.path)) throw new ControlConfigError(`La carpeta «${f.label}» debe ser una ruta absoluta`);
      let real: string;
      try {
        real = fs.realpathSync(f.path);
      } catch {
        throw new ControlConfigError(`La carpeta «${f.label}» no existe: ${f.path}`);
      }
      if (!fs.statSync(real).isDirectory()) throw new ControlConfigError(`«${f.label}» no es una carpeta`);
      if (isFilesystemRoot(real)) throw new ControlConfigError('Por seguridad no se puede autorizar la raíz de un disco completo');
      return { ...f, path: real };
    });
    for (const c of cfg.commands) {
      if (c.cwdFolderId && !cfg.folders.some((f) => f.id === c.cwdFolderId)) throw new ControlConfigError(`El comando «${c.name}» usa una carpeta no autorizada`);
    }
    setSetting(this.db, KEY, JSON.stringify(cfg));
    this.audit.append({
      principal: by, action: 'control.config', outcome: 'success',
      details: { folders: cfg.folders.map((f) => `${f.path} (${f.access})`), apps: cfg.apps.map((a) => a.name), commands: cfg.commands.map((c) => c.name) },
    });
    return cfg;
  }
}
