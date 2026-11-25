import fs from 'node:fs';
import path from 'node:path';
import type { AuthorizedFolder } from './config';

export class PathDenied extends Error {}

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p);

function isInside(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resuelve la ruta real (siguiendo enlaces) del elemento o, si no existe, de su carpeta padre más cercana. */
function realOrNearest(p: string): string {
  let cur = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

export interface ResolvedPath {
  folder: AuthorizedFolder;
  abs: string;
  /** Ruta relativa a la carpeta autorizada, para mostrar. */
  rel: string;
}

/**
 * Valida que una ruta (relativa a una carpeta autorizada o absoluta) cae dentro de
 * alguna carpeta autorizada, incluso tras resolver «..» y enlaces simbólicos.
 * Es la única puerta de entrada al sistema de archivos para las herramientas.
 */
export function resolveAuthorized(folders: AuthorizedFolder[], input: string, folderId?: string): ResolvedPath {
  if (!folders.length) throw new PathDenied('No hay carpetas autorizadas. Añádelas en Archivos y proyectos.');
  if (input.includes('\0')) throw new PathDenied('Ruta no válida');
  const candidates = folderId ? folders.filter((f) => f.id === folderId) : folders;
  if (folderId && !candidates.length) throw new PathDenied(`Carpeta autorizada desconocida: ${folderId}`);
  for (const folder of candidates) {
    const joined = path.isAbsolute(input) ? path.resolve(input) : path.resolve(folder.path, input);
    if (!isInside(folder.path, joined)) continue;
    const real = realOrNearest(joined);
    if (!isInside(folder.path, real)) throw new PathDenied('La ruta sale de la carpeta autorizada a través de un enlace');
    return { folder, abs: real, rel: path.relative(folder.path, real) || '.' };
  }
  throw new PathDenied('Ruta fuera de las carpetas autorizadas');
}
