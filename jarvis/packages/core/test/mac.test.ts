import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import type { Platform } from '../src/control/platform';
import { MAC_FOCUS, MAC_QUIT, osascriptArgs, parseMacWindows } from '../src/control/os-tools';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

/** Mac simulado: responde a osascript, brew y ffmpeg como lo haría macOS. */
function fakeMac(opts: { accessibility?: boolean; brew?: boolean } = {}) {
  const calls: string[][] = [];
  const launched: string[][] = [];
  const platform: Platform = {
    os: 'darwin',
    launch(cmd, args) { launched.push([cmd, ...args]); return { pid: 4321, exited: () => false, kill: () => undefined }; },
    async run(cmd, args) {
      calls.push([cmd, ...args]);
      if (cmd === 'osascript') {
        if (opts.accessibility === false) return { exitCode: 1, stdout: '', stderr: 'execution error: System Events got an error: osascript is not allowed assistive access. (-1719)', timedOut: false };
        const script = args.filter((_, i) => args[i - 1] === '-e').join('\n');
        if (script.includes('every process whose background only is false')) return { exitCode: 0, stdout: '812\t812\tSafari — Inicio\n812\t812\tSafari — Otra pestaña\n930\t930\tNotas — Lista de la compra\n', stderr: '', timedOut: false };
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }
      if (cmd.endsWith('/brew')) {
        if (!opts.brew || cmd !== '/opt/homebrew/bin/brew') return { exitCode: null, stdout: '', stderr: `Programa no encontrado: ${cmd}`, timedOut: false };
        return { exitCode: 0, stdout: args[0] === '--version' ? 'Homebrew 4.6.0' : '==> Installing', stderr: '', timedOut: false };
      }
      if (cmd === '/opt/homebrew/bin/ffmpeg' && opts.brew) return { exitCode: 0, stdout: 'ffmpeg version 7.1', stderr: '', timedOut: false };
      return { exitCode: null, stdout: '', stderr: `Programa no encontrado: ${cmd}`, timedOut: false };
    },
  };
  return { platform, calls, launched };
}

async function setup(p: Platform) {
  const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent' }), { dbFile: ':memory:', embedder: null, connectors: [], platform: p });
  await j.start();
  running.push(j);
  return j;
}

describe('macOS (sistema simulado)', () => {
  it('AppleScript recibe los datos como argumentos, nunca dentro del script', () => {
    const a = osascriptArgs(MAC_QUIT, ['Safari"; do shell script "rm -rf ~']);
    expect(a.at(-1)).toBe('Safari"; do shell script "rm -rf ~');
    expect(a.filter((x) => x !== '-e').slice(0, -1).join('\n')).not.toContain('rm -rf');
    expect(parseMacWindows('812\t812\tSafari — A\n812\t812\tSafari — B\n930\t930\tNotas — C\n')).toEqual([{ handle: '812', pid: 812, title: 'Safari — A' }, { handle: '930', pid: 930, title: 'Notas — C' }]);
  });

  it('ventanas: listar, traer al frente y minimizar; sin permiso de Accesibilidad, lo explica', async () => {
    const m = fakeMac();
    const j = await setup(m.platform);
    expect(await j.tools.invoke(USER, 'window.list', {})).toMatchObject({ status: 'ok', output: [{ handle: '812', title: 'Safari — Inicio' }, { handle: '930', title: 'Notas — Lista de la compra' }] });
    expect(await j.tools.invoke(USER, 'window.focus', { handle: '930' })).toMatchObject({ status: 'ok' });
    expect(m.calls.at(-1)).toEqual(['osascript', ...osascriptArgs(MAC_FOCUS, ['930'])]);
    expect(await j.tools.invoke(USER, 'window.minimize', { handle: '812' })).toMatchObject({ status: 'ok' });
    const denied = await setup(fakeMac({ accessibility: false }).platform);
    expect(await denied.tools.invoke(USER, 'window.list', {})).toMatchObject({ status: 'error', error: expect.stringContaining('Accesibilidad') });
  });

  it('apps: abrir con «open -a» y cerrar de forma ordenada con AppleScript', async () => {
    const m = fakeMac();
    const j = await setup(m.platform);
    const dir = tmpDir();
    j.control.set(USER, { folders: [{ id: 'docs', label: 'Docs', path: dir, access: 'read' }], apps: [{ id: 'safari', name: 'Safari', command: 'open', args: ['-a', 'Safari'], processName: 'Safari' }], commands: [] });
    expect(await j.tools.invoke(USER, 'app.open', { appId: 'safari' })).toMatchObject({ status: 'ok' });
    expect(m.launched[0]).toEqual(['open', '-a', 'Safari']);
    const r = await j.tools.invoke(USER, 'app.close', { appId: 'safari' });
    expect(r.status).toBe('pending_approval');
    // (lo abrió JARVIS: se cierra su proceso; si no, por nombre con AppleScript)
    j.control.set(USER, { folders: [{ id: 'docs', label: 'Docs', path: dir, access: 'read' }], apps: [{ id: 'notas', name: 'Notas', command: 'open', args: ['-a', 'Notes'], processName: 'Notes.app' }], commands: [] });
    const c = await j.tools.invoke(USER, 'app.close', { appId: 'notas' });
    expect(await j.tools.resolveApproval(USER, (c as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'ok', output: { method: 'cierre ordenado (macOS)' } });
    expect(m.calls.at(-1)).toEqual(['osascript', ...osascriptArgs(MAC_QUIT, ['Notes'])]);
  });

  it('programas con Homebrew y FFmpeg en /opt/homebrew; sin Homebrew lo explica', async () => {
    const m = fakeMac({ brew: true });
    const j = await setup(m.platform);
    expect(await j.tools.invoke(USER, 'programs.list', {})).toMatchObject({ status: 'ok', output: expect.arrayContaining([expect.objectContaining({ id: 'ffmpeg', installed: true, detail: '/opt/homebrew/bin/ffmpeg' })]) });
    const r = await j.tools.invoke(USER, 'programs.install', { id: 'vlc' });
    expect(await j.tools.resolveApproval(USER, (r as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'ok' });
    expect(m.calls.at(-1)).toEqual(['/opt/homebrew/bin/brew', 'install', '--cask', 'vlc']);
    const sinBrew = await setup(fakeMac({ brew: false }).platform);
    const r2 = await sinBrew.tools.invoke(USER, 'programs.install', { id: 'ffmpeg' });
    expect(await sinBrew.tools.resolveApproval(USER, (r2 as { approvalId: string }).approvalId, 'approved')).toMatchObject({ status: 'error', error: expect.stringContaining('Homebrew') });
  });
});
