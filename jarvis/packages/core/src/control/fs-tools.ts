import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../tools/registry';
import type { ControlConfig } from './config';
import { PathDenied, resolveAuthorized, type ResolvedPath } from './paths';

const MAX_READ = 256 * 1024;
const MAX_WRITE = 1024 * 1024;
const MAX_LIST = 500;

const PathArgs = { path: z.string().min(1).max(1000).describe('Ruta relativa a la carpeta autorizada (o absoluta dentro de ella)'), folder: z.string().optional().describe('Id de la carpeta autorizada; opcional') };

/** Ámbito de una carpeta entera, para «Aprobar siempre». */
const folderScopes = (action: string, r: ResolvedPath) => [`${action}:${r.folder.path}`, `${action}:${r.folder.path}${path.sep}*`];

export function createFsTools(getConfig: () => ControlConfig, trashDir: string): ToolDefinition[] {
  const resolve = (p: string, folder?: string) => resolveAuthorized(getConfig().folders, p, folder);
  const writable = (p: string, folder?: string) => {
    const r = resolve(p, folder);
    if (r.folder.access !== 'readwrite') throw new PathDenied(`La carpeta «${r.folder.label}» es de solo lectura`);
    return r;
  };
  // Si la ruta no es válida, lanzar aquí hace que ToolRegistry la rechace sin pedir confirmación.
  const scopeOf = (action: string, fn: () => ResolvedPath) => [`${action}:${fn().abs}`];
  const grantOf = (action: string, fn: () => ResolvedPath) => {
    try { return folderScopes(action, fn()); } catch { return []; }
  };

  const listFolders = defineTool({
    name: 'fs.folders',
    description: 'Lista las carpetas que el usuario ha autorizado (id, nombre, ruta y si se puede escribir).',
    parameters: z.object({}).strict(),
    permissions: ['fs.folders.read'],
    risk: 'low', sideEffects: false, risks: [],
    returns: 'Lista de carpetas autorizadas.',
    execute: () => getConfig().folders.map((f) => ({ id: f.id, label: f.label, path: f.path, access: f.access })),
  });

  const list = defineTool({
    name: 'fs.list',
    description: 'Lista el contenido de una carpeta dentro de las carpetas autorizadas.',
    parameters: z.object({ path: PathArgs.path.default('.'), folder: PathArgs.folder }).strict(),
    permissions: (a) => scopeOf('fs.read', () => resolve(a.path, a.folder)),
    grantScopes: (a) => grantOf('fs.read', () => resolve(a.path, a.folder)),
    risk: 'low', sideEffects: false,
    risks: ['Muestra nombres de archivos al modelo de IA'],
    returns: 'Entradas (nombre, tipo, tamaño, fecha de modificación).',
    execute: ({ path: p, folder }) => {
      const r = resolve(p, folder);
      const entries = fs.readdirSync(r.abs, { withFileTypes: true }).slice(0, MAX_LIST);
      return {
        folder: r.folder.label,
        path: r.rel,
        entries: entries.map((e) => {
          let size: number | null = null;
          let modified: string | null = null;
          try {
            const st = fs.statSync(path.join(r.abs, e.name));
            size = e.isFile() ? st.size : null;
            modified = st.mtime.toISOString();
          } catch { /* sin acceso */ }
          return { name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size, modified };
        }),
      };
    },
  });

  const read = defineTool({
    name: 'fs.read_text',
    description: 'Lee un archivo de texto (máx. 256 KB) dentro de las carpetas autorizadas.',
    parameters: z.object(PathArgs).strict(),
    permissions: (a) => scopeOf('fs.read', () => resolve(a.path, a.folder)),
    grantScopes: (a) => grantOf('fs.read', () => resolve(a.path, a.folder)),
    risk: 'low', sideEffects: false,
    risks: ['Envía el contenido del archivo al modelo de IA'],
    returns: 'El contenido del archivo como texto.',
    execute: ({ path: p, folder }) => {
      const r = resolve(p, folder);
      const st = fs.statSync(r.abs);
      if (!st.isFile()) throw new Error('No es un archivo');
      if (st.size > MAX_READ) throw new Error(`Archivo demasiado grande (${st.size} bytes; máx. ${MAX_READ})`);
      const buf = fs.readFileSync(r.abs);
      if (buf.subarray(0, 8192).includes(0)) throw new Error('Parece un archivo binario, no de texto');
      return { path: r.rel, content: buf.toString('utf8') };
    },
  });

  const create = defineTool({
    name: 'fs.create_file',
    description: 'Crea un archivo de texto nuevo (falla si ya existe) en una carpeta autorizada con escritura.',
    parameters: z.object({ ...PathArgs, content: z.string().max(MAX_WRITE) }).strict(),
    permissions: (a) => scopeOf('fs.write', () => writable(a.path, a.folder)),
    grantScopes: (a) => grantOf('fs.write', () => writable(a.path, a.folder)),
    risk: 'medium', sideEffects: true,
    risks: ['Crea un archivo nuevo en tu equipo'],
    returns: 'Ruta del archivo creado.',
    execute: ({ path: p, folder, content }) => {
      const r = writable(p, folder);
      fs.mkdirSync(path.dirname(r.abs), { recursive: true });
      fs.writeFileSync(r.abs, content, { flag: 'wx' });
      return { created: r.rel, folder: r.folder.label };
    },
  });

  const overwrite = defineTool({
    name: 'fs.overwrite_file',
    description: 'Sustituye el contenido de un archivo de texto existente. Se guarda una copia del original en la papelera de JARVIS.',
    parameters: z.object({ ...PathArgs, content: z.string().max(MAX_WRITE) }).strict(),
    permissions: (a) => scopeOf('fs.write', () => writable(a.path, a.folder)),
    grantScopes: (a) => grantOf('fs.write', () => writable(a.path, a.folder)),
    risk: 'high', sideEffects: true,
    risks: ['Modifica un archivo existente (se conserva copia del original)'],
    returns: 'Ruta modificada y ubicación de la copia de seguridad.',
    execute: ({ path: p, folder, content }) => {
      const r = writable(p, folder);
      if (!fs.statSync(r.abs).isFile()) throw new Error('No es un archivo');
      const backup = toTrash(trashDir, r.abs, true);
      fs.writeFileSync(r.abs, content);
      return { modified: r.rel, backup };
    },
  });

  const mkdir = defineTool({
    name: 'fs.make_dir',
    description: 'Crea una carpeta dentro de una carpeta autorizada con escritura.',
    parameters: z.object(PathArgs).strict(),
    permissions: (a) => scopeOf('fs.write', () => writable(a.path, a.folder)),
    grantScopes: (a) => grantOf('fs.write', () => writable(a.path, a.folder)),
    risk: 'medium', sideEffects: true,
    risks: ['Crea una carpeta en tu equipo'],
    returns: 'Ruta creada.',
    execute: ({ path: p, folder }) => {
      const r = writable(p, folder);
      fs.mkdirSync(r.abs, { recursive: true });
      return { created: r.rel };
    },
  });

  const move = defineTool({
    name: 'fs.move',
    description: 'Mueve o renombra un archivo o carpeta entre carpetas autorizadas con escritura (no sobrescribe).',
    parameters: z.object({ from: PathArgs.path, to: PathArgs.path, folder: PathArgs.folder }).strict(),
    permissions: (a) => [...scopeOf('fs.write', () => writable(a.from, a.folder)), ...scopeOf('fs.write', () => writable(a.to, a.folder))],
    risk: 'high', sideEffects: true,
    risks: ['Cambia de sitio o de nombre archivos de tu equipo'],
    returns: 'Origen y destino.',
    execute: ({ from, to, folder }) => {
      const a = writable(from, folder);
      const b = writable(to, folder);
      if (!fs.existsSync(a.abs)) throw new Error('El origen no existe');
      if (fs.existsSync(b.abs)) throw new Error('El destino ya existe; no se sobrescribe');
      fs.mkdirSync(path.dirname(b.abs), { recursive: true });
      fs.renameSync(a.abs, b.abs);
      return { from: a.rel, to: b.rel };
    },
  });

  const del = defineTool({
    name: 'fs.delete',
    description: 'Elimina un archivo o carpeta moviéndolo a la papelera de JARVIS (recuperable).',
    parameters: z.object(PathArgs).strict(),
    permissions: (a) => scopeOf('fs.delete', () => writable(a.path, a.folder)),
    risk: 'high', sideEffects: true,
    risks: ['Quita archivos de su ubicación (quedan en la papelera de JARVIS)'],
    returns: 'Ubicación en la papelera.',
    execute: ({ path: p, folder }) => {
      const r = writable(p, folder);
      if (r.abs === r.folder.path) throw new Error('No se puede eliminar la carpeta autorizada completa');
      if (!fs.existsSync(r.abs)) throw new Error('No existe');
      return { deleted: r.rel, trash: toTrash(trashDir, r.abs, false) };
    },
  });

  return [listFolders, list, read, create, overwrite, mkdir, move, del] as ToolDefinition[];
}

/** Mueve (o copia) a la papelera de JARVIS con marca de tiempo. Funciona entre discos distintos. */
export function toTrash(trashDir: string, abs: string, copy: boolean): string {
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(abs)}`);
  if (copy) {
    fs.cpSync(abs, dest, { recursive: true });
  } else {
    try {
      fs.renameSync(abs, dest);
    } catch {
      fs.cpSync(abs, dest, { recursive: true });
      fs.rmSync(abs, { recursive: true, force: true });
    }
  }
  return dest;
}
