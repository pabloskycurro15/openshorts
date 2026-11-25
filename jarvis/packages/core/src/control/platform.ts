import { execFile, spawn, type ChildProcess } from 'node:child_process';

/**
 * Acceso al sistema operativo aislado tras una interfaz, para poder probar las
 * herramientas sin lanzar procesos reales. Nunca se usa una shell: los argumentos
 * van separados, así que no hay inyección de comandos.
 */
export interface Launched {
  pid: number | undefined;
  exited: () => boolean;
  kill: () => void;
}

export interface Platform {
  readonly os: NodeJS.Platform;
  launch(command: string, args: string[], cwd?: string): Launched;
  run(command: string, args: string[], opts: { cwd?: string; timeoutMs: number; maxBytes: number }): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;
}

function trackExit(child: ChildProcess) {
  let done = false;
  child.on('exit', () => (done = true));
  child.on('error', () => (done = true));
  return () => done;
}

export const nodePlatform: Platform = {
  os: process.platform,

  launch(command, args, cwd) {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    const exited = trackExit(child);
    child.unref();
    return {
      pid: child.pid,
      exited,
      kill: () => {
        if (!child.pid || exited()) return;
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore', windowsHide: true });
        else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        }
      },
    };
  },

  run(command, args, { cwd, timeoutMs, maxBytes }) {
    return new Promise((resolve) => {
      execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: maxBytes * 4, windowsHide: true, shell: false, encoding: 'utf8' }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        if (e && typeof e.code === 'string' && e.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve({ exitCode: null, stdout: '', stderr: e.code === 'ENOENT' ? `Programa no encontrado: ${command}` : e.message, timedOut: false });
          return;
        }
        resolve({
          exitCode: e ? (typeof e.code === 'number' ? e.code : null) : 0,
          stdout: String(stdout).slice(0, maxBytes),
          stderr: String(stderr).slice(0, maxBytes),
          timedOut: !!e?.killed,
        });
      });
    });
  },
};

/** Ejecuta un script de PowerShell sin problemas de comillas (EncodedCommand = UTF-16LE en base64). */
export function powershellArgs(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}
