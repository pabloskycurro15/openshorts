import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../tools/registry';
import type { ControlConfig } from './config';
import { powershellArgs, type Launched, type Platform } from './platform';

const MAX_OUTPUT = 20_000;

export interface ProcessInfo { pid: number; name: string; cpu: number | null; memoryBytes: number | null }
export interface WindowInfo { handle: string; pid: number; title: string }

/** Analiza la salida JSON de Get-Process (un objeto o una lista). */
export function parseWindowsProcesses(json: string): ProcessInfo[] {
  if (!json.trim()) return [];
  const raw = JSON.parse(json) as unknown;
  const list = (Array.isArray(raw) ? raw : [raw]) as { Id: number; ProcessName: string; CPU: number | null; WorkingSet64: number | null }[];
  return list.map((p) => ({ pid: p.Id, name: p.ProcessName, cpu: p.CPU === null || p.CPU === undefined ? null : Math.round(p.CPU * 10) / 10, memoryBytes: p.WorkingSet64 ?? null }));
}

/** Analiza `ps -o pid=,comm=,pcpu=,rss=`. */
export function parsePs(out: string): ProcessInfo[] {
  return out.split("\n").map((l) => l.trim()).filter(Boolean).map((l): ProcessInfo | null => {
    const m = /^(\d+)\s+(.+?)\s+([\d.]+)\s+(\d+)$/.exec(l);
    if (!m) return null;
    return { pid: Number(m[1]), name: path.basename(m[2]!), cpu: Number(m[3]), memoryBytes: Number(m[4]) * 1024 };
  }).filter((x): x is ProcessInfo => !!x);
}

/** Analiza la salida «handle<TAB>pid<TAB>título» del script de ventanas. */
export function parseWindows(out: string): WindowInfo[] {
  return out.split(/\r?\n/).map((l) => l.split('\t')).filter((p) => p.length >= 3 && /^\d+$/.test(p[0]!))
    .map((p) => ({ handle: p[0]!, pid: Number(p[1]), title: p.slice(2).join('\t') }));
}

const USER32 = `
$sig = @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class JW {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      r.Add(h.ToInt64() + "\\t" + pid + "\\t" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
Add-Type -TypeDefinition $sig
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`;

export function windowScript(action: 'list' | 'focus' | 'minimize', handle?: string): string {
  if (action !== 'list' && !/^\d{1,20}$/.test(handle ?? '')) throw new Error('Identificador de ventana no válido');
  const body = action === 'list'
    ? '[JW]::List() | ForEach-Object { $_ }'
    : action === 'focus'
      ? `[void][JW]::ShowWindow([IntPtr]${handle}, 9); [JW]::SetForegroundWindow([IntPtr]${handle})`
      : `[JW]::ShowWindow([IntPtr]${handle}, 6)`;
  return USER32 + body;
}

/** Uso real de CPU (%) midiendo los contadores de los núcleos durante un intervalo. Funciona también en Windows. */
export async function sampleCpuUsage(ms = 300): Promise<number> {
  const snap = () => os.cpus().reduce((acc, c) => {
    const t = c.times;
    acc.idle += t.idle;
    acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return acc;
  }, { idle: 0, total: 0 });
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10 : 0;
}

export function createOsTools(getConfig: () => ControlConfig, platform: Platform): ToolDefinition[] {
  const opened = new Map<string, Launched>();
  const app = (id: string) => {
    const a = getConfig().apps.find((x) => x.id === id);
    if (!a) throw new Error(`Aplicación no autorizada: ${id}. El usuario puede añadirla en Archivos y proyectos → Control del equipo.`);
    return a;
  };
  const isWin = platform.os === 'win32';

  const listApps = defineTool({
    name: 'app.list',
    description: 'Lista las aplicaciones que el usuario ha autorizado abrir y cuáles abrió JARVIS y siguen abiertas.',
    parameters: z.object({}).strict(),
    permissions: ['app.list'],
    risk: 'low', sideEffects: false, risks: [],
    returns: 'Aplicaciones autorizadas (id, nombre, abierta por JARVIS).',
    execute: () => getConfig().apps.map((a) => ({ id: a.id, name: a.name, openedByJarvis: !!opened.get(a.id) && !opened.get(a.id)!.exited() })),
  });

  const openApp = defineTool({
    name: 'app.open',
    description: 'Abre una aplicación de la lista autorizada por el usuario.',
    parameters: z.object({ appId: z.string().describe('Id de la aplicación autorizada') }).strict(),
    permissions: (a) => [`app.open:${app(a.appId).id}`],
    risk: 'medium', sideEffects: true,
    risks: ['Abre un programa en tu equipo'],
    returns: 'Confirmación y PID del proceso.',
    execute: ({ appId }) => {
      const a = app(appId);
      const l = platform.launch(a.command, a.args);
      if (!l.pid) throw new Error(`No se pudo abrir ${a.name}`);
      opened.set(a.id, l);
      return { opened: a.name, pid: l.pid };
    },
  });

  const closeApp = defineTool({
    name: 'app.close',
    description: 'Cierra una aplicación autorizada (las que abrió JARVIS o, en Windows, por su nombre de proceso). Puede perder trabajo sin guardar.',
    parameters: z.object({ appId: z.string() }).strict(),
    permissions: (a) => [`app.close:${app(a.appId).id}`],
    risk: 'high', sideEffects: true,
    risks: ['Puedes perder cambios no guardados en esa aplicación'],
    returns: 'Confirmación.',
    execute: async ({ appId }) => {
      const a = app(appId);
      const l = opened.get(a.id);
      if (l && !l.exited()) {
        l.kill();
        opened.delete(a.id);
        return { closed: a.name, method: 'proceso abierto por JARVIS' };
      }
      if (isWin && a.processName) {
        const r = await platform.run('taskkill', ['/IM', a.processName], { timeoutMs: 10_000, maxBytes: 2000 });
        if (r.exitCode !== 0) throw new Error(`No se pudo cerrar ${a.name}: ${(r.stderr || r.stdout).trim()}`);
        return { closed: a.name, method: 'nombre de proceso' };
      }
      throw new Error(`${a.name} no la abrió JARVIS y no tiene nombre de proceso configurado.`);
    },
  });

  const openUrl = defineTool({
    name: 'browser.open_url',
    description: 'Abre una página web (http/https) en el navegador predeterminado.',
    parameters: z.object({ url: z.string().url().max(2000) }).strict(),
    permissions: ['browser.open'],
    risk: 'medium', sideEffects: true,
    risks: ['Abre una página web en tu navegador'],
    returns: 'Confirmación.',
    execute: ({ url }) => {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Solo se abren direcciones http o https');
      const href = u.toString();
      const [cmd, args] = isWin ? ['rundll32', ['url.dll,FileProtocolHandler', href]] : platform.os === 'darwin' ? ['open', [href]] : ['xdg-open', [href]];
      platform.launch(cmd as string, args as string[]);
      return { opened: href };
    },
  });

  const runCommand = defineTool({
    name: 'command.run',
    description: 'Ejecuta uno de los comandos predefinidos que el usuario ha autorizado (con argumentos fijos). Nunca comandos arbitrarios.',
    parameters: z.object({ commandId: z.string() }).strict(),
    permissions: (a) => {
      if (!getConfig().commands.some((c) => c.id === a.commandId)) throw new Error(`Comando no autorizado: ${a.commandId}`);
      return [`command.run:${a.commandId}`];
    },
    risk: 'high', sideEffects: true,
    risks: ['Ejecuta un programa en tu equipo'],
    returns: 'Código de salida y salida (recortada) del comando.',
    execute: async ({ commandId }) => {
      const cfg = getConfig();
      const c = cfg.commands.find((x) => x.id === commandId)!;
      const cwd = c.cwdFolderId ? cfg.folders.find((f) => f.id === c.cwdFolderId)?.path : undefined;
      const r = await platform.run(c.command, c.args, { cwd, timeoutMs: c.timeoutSec * 1000, maxBytes: MAX_OUTPUT });
      return { command: c.name, ...r };
    },
  });

  const listCommands = defineTool({
    name: 'command.list',
    description: 'Lista los comandos predefinidos que el usuario ha autorizado.',
    parameters: z.object({}).strict(),
    permissions: ['command.list'],
    risk: 'low', sideEffects: false, risks: [],
    returns: 'Comandos (id, nombre, descripción).',
    execute: () => getConfig().commands.map((c) => ({ id: c.id, name: c.name, description: c.description })),
  });

  const processes = defineTool({
    name: 'system.processes',
    description: 'Lista los procesos que más CPU consumen en el equipo.',
    parameters: z.object({ limit: z.number().int().min(1).max(50).default(15) }).strict(),
    permissions: ['system.processes.read'],
    risk: 'low', sideEffects: false, risks: [],
    returns: 'Procesos con PID, nombre, CPU y memoria.',
    execute: async ({ limit }) => {
      if (isWin) {
        const r = await platform.run('powershell.exe', powershellArgs(`Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress`), { timeoutMs: 15_000, maxBytes: 200_000 });
        if (r.exitCode !== 0) throw new Error(r.stderr || 'No se pudieron leer los procesos');
        return parseWindowsProcesses(r.stdout);
      }
      const args = platform.os === 'darwin' ? ['-Ao', 'pid=,comm=,pcpu=,rss=', '-r'] : ['-eo', 'pid=,comm=,pcpu=,rss=', '--sort=-pcpu'];
      const r = await platform.run('ps', args, { timeoutMs: 10_000, maxBytes: 500_000 });
      return parsePs(r.stdout).slice(0, limit);
    },
  });

  const winOnly = () => { if (!isWin) throw new Error('El control de ventanas solo está disponible en Windows'); };
  const listWindows = defineTool({
    name: 'window.list',
    description: 'Lista las ventanas visibles (Windows).',
    parameters: z.object({}).strict(),
    permissions: ['window.list'],
    risk: 'low', sideEffects: false,
    risks: ['Muestra los títulos de tus ventanas al modelo de IA'],
    returns: 'Ventanas (identificador, PID, título).',
    execute: async () => {
      winOnly();
      const r = await platform.run('powershell.exe', powershellArgs(windowScript('list')), { timeoutMs: 20_000, maxBytes: 200_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr || 'No se pudieron leer las ventanas');
      return parseWindows(r.stdout);
    },
  });
  const windowAction = (action: 'focus' | 'minimize', label: string) => defineTool({
    name: `window.${action}`,
    description: `${label} una ventana por su identificador (obtenido con window.list). Solo Windows.`,
    parameters: z.object({ handle: z.string().regex(/^\d{1,20}$/) }).strict(),
    permissions: [`window.${action}`],
    risk: 'medium', sideEffects: true,
    risks: ['Cambia la ventana activa de tu escritorio'],
    returns: 'Confirmación.',
    execute: async ({ handle }) => {
      winOnly();
      const r = await platform.run('powershell.exe', powershellArgs(windowScript(action, handle)), { timeoutMs: 20_000, maxBytes: 10_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr || 'La operación sobre la ventana falló');
      return { ok: true, handle };
    },
  });

  return [listApps, openApp, closeApp, openUrl, listCommands, runCommand, processes, listWindows, windowAction('focus', 'Trae al frente'), windowAction('minimize', 'Minimiza')] as ToolDefinition[];
}
